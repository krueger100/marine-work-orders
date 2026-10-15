-- =============================================================================
-- Admin RPCs: users, roles, vessels and vessel assignments.
-- Every function re-checks that the caller is an active Admin.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Assignment primitives (shared by the public RPCs below)
-- -----------------------------------------------------------------------------
create function private.assign_member(p_member public.members, p_vessel_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.vessel_assignments
    where member_id = p_member.id and vessel_id = p_vessel_id
  ) then
    return;  -- already assigned: nothing to validate or change
  end if;

  if p_member.role = 'Admin' then
    raise exception 'Admins are fleet-wide and are not assigned to vessels.' using errcode = 'P0001';
  end if;
  if not p_member.is_active then
    raise exception 'Reactivate % before assigning them to a vessel.', p_member.full_name using errcode = 'P0001';
  end if;

  perform 1 from public.vessels where id = p_vessel_id and is_active for share;
  if not found then
    raise exception 'Vessel not found or inactive.' using errcode = 'P0001';
  end if;

  insert into public.vessel_assignments (vessel_id, member_id)
  values (p_vessel_id, p_member.id)
  on conflict do nothing;
end;
$$;

create function private.unassign_member(p_member public.members, p_vessel_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_can_release_member(p_member, p_vessel_id, 'remove %s from this vessel');

  delete from public.vessel_assignments
  where member_id = p_member.id and vessel_id = p_vessel_id;
end;
$$;

-- Makes the member's vessel list exactly p_vessel_ids (assign + update + remove).
create function private.set_member_vessels(p_member public.members, p_vessel_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vessel_id uuid;
  v_wanted    uuid[] := coalesce(p_vessel_ids, '{}');
begin
  for v_vessel_id in
    select vessel_id from public.vessel_assignments
    where member_id = p_member.id and not (vessel_id = any (v_wanted))
  loop
    perform private.unassign_member(p_member, v_vessel_id);
  end loop;

  foreach v_vessel_id in array v_wanted loop
    perform private.assign_member(p_member, v_vessel_id);
  end loop;
end;
$$;

-- Locks and returns a member row, or raises.
create function private.lock_member(p_member_id uuid)
returns public.members
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.members;
begin
  select * into v_member from public.members where id = p_member_id for update;
  if not found then
    raise exception 'User not found.' using errcode = 'P0001';
  end if;
  return v_member;
end;
$$;

-- -----------------------------------------------------------------------------
-- Users
-- -----------------------------------------------------------------------------
create function public.create_member(
  p_full_name  text,
  p_email      text,
  p_role       public.app_role,
  p_vessel_ids uuid[] default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member     public.members;
  v_constraint text;
  v_column     text;
begin
  perform private.require_member('{Admin}');

  insert into public.members (full_name, email, role)
  values (btrim(p_full_name), lower(btrim(p_email)), p_role)
  returning * into v_member;

  if v_member.role <> 'Admin' then
    perform private.set_member_vessels(v_member, p_vessel_ids);
  end if;

  return v_member.id;
exception
  when unique_violation or check_violation then
    get stacked diagnostics v_constraint = constraint_name;
    raise exception '%', private.constraint_message(v_constraint) using errcode = '22023';
  when not_null_violation then
    get stacked diagnostics v_column = column_name;
    raise exception '% is required.', initcap(replace(v_column, '_', ' ')) using errcode = '22023';
end;
$$;

-- Updates name, email, role and (optionally) vessel assignments in one
-- transaction. Role changes run the same guards as deactivation, because the
-- member stops being crew/captain of their vessels.
create function public.update_member(
  p_member_id  uuid,
  p_full_name  text,
  p_email      text,
  p_role       public.app_role,
  p_vessel_ids uuid[] default null  -- null = leave assignments unchanged
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member     public.members;
  v_constraint text;
  v_column     text;
begin
  perform private.require_member('{Admin}');
  v_member := private.lock_member(p_member_id);

  if p_role is distinct from v_member.role then
    if v_member.role = 'Admin' and v_member.is_active then
      perform private.assert_not_last_admin(v_member.id);
    end if;
    perform private.assert_can_release_member(v_member, null, 'change the role of %s');

    -- Admins are fleet-wide: drop vessel assignments when promoting.
    if p_role = 'Admin' then
      delete from public.vessel_assignments where member_id = v_member.id;
    end if;
  end if;

  update public.members
  set full_name = btrim(p_full_name),
      email     = lower(btrim(p_email)),
      role      = p_role
  where id = v_member.id
  returning * into v_member;

  if p_vessel_ids is not null and v_member.role <> 'Admin' then
    perform private.set_member_vessels(v_member, p_vessel_ids);
  end if;
exception
  when unique_violation or check_violation then
    get stacked diagnostics v_constraint = constraint_name;
    raise exception '%', private.constraint_message(v_constraint) using errcode = '22023';
  when not_null_violation then
    get stacked diagnostics v_column = column_name;
    raise exception '% is required.', initcap(replace(v_column, '_', ' ')) using errcode = '22023';
end;
$$;

-- Deactivate / reactivate. Users are never hard-deleted, so history survives.
-- Vessel assignments are kept (and ignored while inactive) so reactivation
-- restores the member to their vessels.
create function public.set_member_active(p_member_id uuid, p_is_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin  public.members;
  v_member public.members;
begin
  v_admin := private.require_member('{Admin}');
  v_member := private.lock_member(p_member_id);

  if p_is_active is null or p_is_active = v_member.is_active then
    return;
  end if;

  if not p_is_active then
    if v_member.id = v_admin.id then
      raise exception 'You cannot deactivate yourself. Switch to another Admin first.' using errcode = 'P0001';
    end if;
    perform private.assert_can_release_member(v_member, null, 'deactivate %s');
  end if;

  update public.members set is_active = p_is_active where id = v_member.id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Vessel assignments
-- -----------------------------------------------------------------------------
create function public.assign_member_to_vessel(p_member_id uuid, p_vessel_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_member('{Admin}');
  perform private.assign_member(private.lock_member(p_member_id), p_vessel_id);
end;
$$;

create function public.remove_member_from_vessel(p_member_id uuid, p_vessel_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_member('{Admin}');
  perform private.unassign_member(private.lock_member(p_member_id), p_vessel_id);
end;
$$;

-- Replace a member's vessel list in one transaction.
create function public.set_member_vessels(p_member_id uuid, p_vessel_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_member('{Admin}');
  perform private.set_member_vessels(private.lock_member(p_member_id), p_vessel_ids);
end;
$$;

-- -----------------------------------------------------------------------------
-- Vessels
-- -----------------------------------------------------------------------------
create function public.create_vessel(p_name text, p_imo_number text, p_vessel_type text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id         uuid;
  v_constraint text;
  v_column     text;
begin
  perform private.require_member('{Admin}');

  insert into public.vessels (name, imo_number, vessel_type)
  values (btrim(p_name), btrim(p_imo_number), btrim(p_vessel_type))
  returning id into v_id;

  return v_id;
exception
  when unique_violation or check_violation then
    get stacked diagnostics v_constraint = constraint_name;
    raise exception '%', private.constraint_message(v_constraint) using errcode = '22023';
  when not_null_violation then
    get stacked diagnostics v_column = column_name;
    raise exception '% is required.', initcap(replace(v_column, '_', ' ')) using errcode = '22023';
end;
$$;

create function public.update_vessel(
  p_vessel_id   uuid,
  p_name        text,
  p_imo_number  text,
  p_vessel_type text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_constraint text;
  v_column     text;
begin
  perform private.require_member('{Admin}');

  update public.vessels
  set name        = btrim(p_name),
      imo_number  = btrim(p_imo_number),
      vessel_type = btrim(p_vessel_type)
  where id = p_vessel_id;

  if not found then
    raise exception 'Vessel not found.' using errcode = 'P0001';
  end if;
exception
  when unique_violation or check_violation then
    get stacked diagnostics v_constraint = constraint_name;
    raise exception '%', private.constraint_message(v_constraint) using errcode = '22023';
  when not_null_violation then
    get stacked diagnostics v_column = column_name;
    raise exception '% is required.', initcap(replace(v_column, '_', ' ')) using errcode = '22023';
end;
$$;

-- A vessel with unattested work orders cannot be taken out of service.
create function public.set_vessel_active(p_vessel_id uuid, p_is_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vessel public.vessels;
  v_count  integer;
begin
  perform private.require_member('{Admin}');

  select * into v_vessel from public.vessels where id = p_vessel_id for no key update;
  if not found then
    raise exception 'Vessel not found.' using errcode = 'P0001';
  end if;

  if p_is_active is null or p_is_active = v_vessel.is_active then
    return;
  end if;

  if not p_is_active then
    select count(*) into v_count
    from public.work_orders
    where vessel_id = p_vessel_id and attested_at is null;

    if v_count > 0 then
      raise exception 'Cannot deactivate %: it still has % active work % that must be attested first.',
        v_vessel.name, v_count, case when v_count = 1 then 'order' else 'orders' end
        using errcode = '23503';
    end if;
  end if;

  update public.vessels set is_active = p_is_active where id = p_vessel_id;
end;
$$;

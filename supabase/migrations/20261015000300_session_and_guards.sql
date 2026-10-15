-- =============================================================================
-- Mock-auth session RPCs and the guard helpers shared by every write RPC.
-- =============================================================================

-- Maps a violated constraint (or unique index) to a message the UI can show.
-- Constraints stay the single source of truth for data rules; RPCs translate.
create function private.constraint_message(p_constraint text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_constraint
    when 'members_full_name_length'                then 'Full name must be 2 to 100 characters.'
    when 'members_email_format'                    then 'Enter a valid email address.'
    when 'members_email_key'                       then 'A user with this email already exists.'
    when 'vessels_name_length'                     then 'Vessel name must be 2 to 80 characters.'
    when 'vessels_name_key'                        then 'A vessel with this name already exists.'
    when 'vessels_imo_valid'                       then 'IMO number must be 7 digits with a valid check digit.'
    when 'vessels_imo_number_key'                  then 'A vessel with this IMO number already exists.'
    when 'vessels_type_length'                     then 'Vessel type must be 2 to 40 characters.'
    when 'work_orders_title_length'                then 'Title must be 3 to 120 characters.'
    when 'work_orders_issue_length'                then 'Issue description must be 3 to 4000 characters.'
    when 'work_orders_solution_length'             then 'Solution must be at most 4000 characters.'
    when 'work_orders_done_requires_solution'      then 'Document the solution before marking the work order Done.'
    when 'work_order_events_comment_length'        then 'Comment must be at most 2000 characters.'
    when 'work_order_events_rejection_needs_reason' then 'A rejection reason of at least 5 characters is required.'
    else 'The data failed validation (' || coalesce(p_constraint, 'unknown rule') || ').'
  end
$$;

-- Returns the acting member, or raises if there is none or the role is wrong.
create function private.require_member(p_allowed public.app_role[] default null)
returns public.members
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_member public.members;
begin
  select m.* into v_member
  from private.acting_sessions s
  join public.members m on m.id = s.member_id
  where s.user_id = auth.uid()
    and m.is_active;

  if not found then
    raise exception 'No active member selected. Choose a member in the top bar.'
      using errcode = '28000';
  end if;

  if p_allowed is not null and not (v_member.role = any (p_allowed)) then
    raise exception 'This action requires the % role.', array_to_string(p_allowed, ' or ')
      using errcode = '42501';
  end if;

  return v_member;
end;
$$;

-- True when the member serves on the vessel and the vessel is active.
create function private.is_assigned(p_member_id uuid, p_vessel_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.vessel_assignments a
    join public.vessels v on v.id = a.vessel_id and v.is_active
    where a.member_id = p_member_id
      and a.vessel_id = p_vessel_id
  )
$$;

-- Raises unless the member can stop serving on p_vessel_id (or on every vessel
-- when p_vessel_id is NULL) without leaving an active work order without an
-- authorized owner:
--   * Crew must not hold active (unattested) work orders there.
--   * A captain must not be the last active captain of a vessel that still has
--     active work orders (someone has to review them).
-- p_action is a format string for the message, e.g. 'deactivate %s'.
-- The caller must already hold a FOR UPDATE lock on the member row.
create function private.assert_can_release_member(
  p_member public.members,
  p_vessel_id uuid,
  p_action text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count   integer;
  v_vessels text;
  v_what    text := format(p_action, p_member.full_name);
begin
  -- Lock the affected vessels so a concurrent create_work_order (which takes a
  -- FOR SHARE lock on its vessel) cannot slip in between check and change.
  perform 1
  from public.vessels v
  where v.id in (
    select a.vessel_id
    from public.vessel_assignments a
    where a.member_id = p_member.id
      and (p_vessel_id is null or a.vessel_id = p_vessel_id)
  )
  order by v.id
  for no key update;

  if p_member.role = 'Crew' then
    select count(*) into v_count
    from public.work_orders w
    where w.assigned_to = p_member.id
      and w.attested_at is null
      and (p_vessel_id is null or w.vessel_id = p_vessel_id);

    if v_count > 0 then
      raise exception 'Cannot %: they still hold % active work %. A captain must reassign them, or they must be attested first.',
        v_what, v_count, case when v_count = 1 then 'order' else 'orders' end
        using errcode = '23503';
    end if;

  elsif p_member.role = 'Captain' then
    select string_agg(v.name, ', ' order by v.name) into v_vessels
    from public.vessel_assignments a
    join public.vessels v on v.id = a.vessel_id
    where a.member_id = p_member.id
      and (p_vessel_id is null or a.vessel_id = p_vessel_id)
      and exists (
        select 1 from public.work_orders w
        where w.vessel_id = a.vessel_id and w.attested_at is null
      )
      and not exists (
        select 1
        from public.vessel_assignments a2
        join public.members m2 on m2.id = a2.member_id
        where a2.vessel_id = a.vessel_id
          and a2.member_id <> p_member.id
          and m2.role = 'Captain'
          and m2.is_active
      );

    if v_vessels is not null then
      raise exception 'Cannot %: they are the only active captain of %, which still has work orders to review. Assign another captain first.',
        v_what, v_vessels
        using errcode = '23503';
    end if;
  end if;
end;
$$;

-- Raises if removing p_member_id from the Admin role would leave no active Admin.
create function private.assert_not_last_admin(p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Serialize concurrent demotions/deactivations of admins.
  perform 1 from public.members
  where role = 'Admin' and is_active
  order by id
  for update;

  if not exists (
    select 1 from public.members
    where role = 'Admin' and is_active and id <> p_member_id
  ) then
    raise exception 'At least one active Admin must remain.'
      using errcode = '23503';
  end if;
end;
$$;

-- =============================================================================
-- Session RPCs (callable by any signed-in browser, before choosing a member)
-- =============================================================================

-- What the utility bar needs to build its three dropdowns: active vessels and
-- active members with their active vessel assignments. Deliberately minimal:
-- no emails or other personal data before a member is selected.
create function public.list_directory()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'vessels', coalesce((
      select jsonb_agg(jsonb_build_object('id', v.id, 'name', v.name) order by v.name)
      from public.vessels v
      where v.is_active
    ), '[]'::jsonb),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id,
        'full_name', m.full_name,
        'role', m.role,
        'vessel_ids', coalesce((
          select jsonb_agg(a.vessel_id)
          from public.vessel_assignments a
          join public.vessels v on v.id = a.vessel_id and v.is_active
          where a.member_id = m.id
        ), '[]'::jsonb)
      ) order by m.full_name)
      from public.members m
      where m.is_active
    ), '[]'::jsonb)
  )
$$;

-- The acting member (with their active vessel ids), or NULL.
create function public.whoami()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', m.id,
    'full_name', m.full_name,
    'email', m.email,
    'role', m.role,
    'vessel_ids', coalesce((
      select jsonb_agg(a.vessel_id)
      from public.vessel_assignments a
      join public.vessels v on v.id = a.vessel_id and v.is_active
      where a.member_id = m.id
    ), '[]'::jsonb)
  )
  from private.acting_sessions s
  join public.members m on m.id = s.member_id
  where s.user_id = auth.uid()
    and m.is_active
$$;

-- Switch the caller's session to act as an active member.
create function public.act_as(p_member_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in.' using errcode = '28000';
  end if;

  if not exists (select 1 from public.members where id = p_member_id and is_active) then
    raise exception 'That member does not exist or is inactive.' using errcode = 'P0001';
  end if;

  insert into private.acting_sessions (user_id, member_id)
  values (auth.uid(), p_member_id)
  on conflict (user_id)
  do update set member_id = excluded.member_id, updated_at = now();

  return public.whoami();
end;
$$;

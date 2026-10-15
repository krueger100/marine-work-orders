-- =============================================================================
-- Work order lifecycle
--
--   Captain creates            -> Open
--   Assigned crew starts       Open        -> In Progress
--   Assigned crew completes    In Progress -> Done   (solution required)
--   Captain attests            Done        -> Done + attested (final, locked)
--   Captain rejects            Done        -> In Progress (reason required)
--   Captain reassigns          Open / In Progress, to active crew on the vessel
--
-- Each transition locks the row (FOR UPDATE) and checks the current status, so
-- double clicks, stale screens and two open tabs cannot corrupt a record.
-- =============================================================================

create function private.wo_label(p_id bigint)
returns text
language sql
immutable
set search_path = ''
as $$
  select 'WO-' || lpad(p_id::text, 6, '0')
$$;

create function private.lock_work_order(p_id bigint)
returns public.work_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wo public.work_orders;
begin
  select * into v_wo from public.work_orders where id = p_id for update;
  if not found then
    raise exception 'Work order not found.' using errcode = 'P0001';
  end if;
  return v_wo;
end;
$$;

create function private.assert_status(
  p_wo       public.work_orders,
  p_expected public.work_order_status[],
  p_action   text
)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_wo.attested_at is not null then
    raise exception '% is attested and closed. It can no longer change.', private.wo_label(p_wo.id)
      using errcode = 'P0001';
  end if;
  if not (p_wo.status = any (p_expected)) then
    raise exception 'Cannot % %: it is currently %. Refresh to see the latest state.',
      p_action, private.wo_label(p_wo.id), p_wo.status
      using errcode = 'P0001';
  end if;
end;
$$;

create function private.assert_assigned_crew(p_actor public.members, p_wo public.work_orders)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_wo.assigned_to <> p_actor.id or not private.is_assigned(p_actor.id, p_wo.vessel_id) then
    raise exception 'Only the crew member assigned to % can update it.', private.wo_label(p_wo.id)
      using errcode = '42501';
  end if;
end;
$$;

create function private.assert_vessel_captain(p_actor public.members, p_wo public.work_orders)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_assigned(p_actor.id, p_wo.vessel_id) then
    raise exception 'Only a captain of this vessel can manage %.', private.wo_label(p_wo.id)
      using errcode = '42501';
  end if;
end;
$$;

-- Locks the assignee and checks they are active crew on the vessel.
create function private.assert_assignable_crew(p_member_id uuid, p_vessel_id uuid)
returns public.members
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.members;
begin
  -- FOR SHARE blocks a concurrent deactivation/role change of this member.
  select * into v_member from public.members where id = p_member_id for share;

  if not found
     or not v_member.is_active
     or v_member.role <> 'Crew'
     or not private.is_assigned(v_member.id, p_vessel_id) then
    raise exception 'Work orders can only be assigned to active crew serving on this vessel.'
      using errcode = 'P0001';
  end if;

  return v_member;
end;
$$;

-- -----------------------------------------------------------------------------
-- Captain: create
-- -----------------------------------------------------------------------------
create function public.create_work_order(
  p_vessel_id   uuid,
  p_title       text,
  p_issue       text,
  p_assigned_to uuid
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor      public.members;
  v_id         bigint;
  v_constraint text;
  v_column     text;
begin
  v_actor := private.require_member('{Captain}');

  -- FOR SHARE on the vessel serializes with guards that remove its captains.
  perform 1 from public.vessels where id = p_vessel_id and is_active for share;
  if not found or not private.is_assigned(v_actor.id, p_vessel_id) then
    raise exception 'You can only create work orders for vessels you command.' using errcode = '42501';
  end if;

  perform private.assert_assignable_crew(p_assigned_to, p_vessel_id);

  insert into public.work_orders (vessel_id, title, issue, assigned_to, created_by)
  values (p_vessel_id, btrim(p_title), btrim(p_issue), p_assigned_to, v_actor.id)
  returning id into v_id;

  insert into public.work_order_events (work_order_id, actor_id, event_type, to_status)
  values (v_id, v_actor.id, 'created', 'Open');

  return v_id;
exception
  when check_violation then
    get stacked diagnostics v_constraint = constraint_name;
    raise exception '%', private.constraint_message(v_constraint) using errcode = '22023';
  when not_null_violation then
    get stacked diagnostics v_column = column_name;
    raise exception '% is required.', initcap(replace(v_column, '_', ' ')) using errcode = '22023';
end;
$$;

-- -----------------------------------------------------------------------------
-- Captain: reassign (also how a captain frees crew for deactivation/removal)
-- -----------------------------------------------------------------------------
create function public.reassign_work_order(p_work_order_id bigint, p_assigned_to uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.members;
  v_wo    public.work_orders;
  v_from  text;
  v_to    public.members;
begin
  v_actor := private.require_member('{Captain}');
  v_wo := private.lock_work_order(p_work_order_id);
  perform private.assert_vessel_captain(v_actor, v_wo);
  perform private.assert_status(v_wo, '{Open,In Progress}', 'reassign');

  if p_assigned_to = v_wo.assigned_to then
    return;
  end if;

  v_to := private.assert_assignable_crew(p_assigned_to, v_wo.vessel_id);
  select full_name into v_from from public.members where id = v_wo.assigned_to;

  update public.work_orders set assigned_to = v_to.id where id = v_wo.id;

  insert into public.work_order_events (work_order_id, actor_id, event_type, from_status, to_status, comment)
  values (v_wo.id, v_actor.id, 'reassigned', v_wo.status, v_wo.status,
          'Reassigned from ' || v_from || ' to ' || v_to.full_name);
end;
$$;

-- -----------------------------------------------------------------------------
-- Crew: start, save solution draft, complete
-- -----------------------------------------------------------------------------
create function public.start_work_order(p_work_order_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.members;
  v_wo    public.work_orders;
begin
  v_actor := private.require_member('{Crew}');
  v_wo := private.lock_work_order(p_work_order_id);
  perform private.assert_assigned_crew(v_actor, v_wo);
  perform private.assert_status(v_wo, '{Open}', 'start');

  update public.work_orders set status = 'In Progress' where id = v_wo.id;

  insert into public.work_order_events (work_order_id, actor_id, event_type, from_status, to_status)
  values (v_wo.id, v_actor.id, 'started', 'Open', 'In Progress');
end;
$$;

create function public.save_work_order_solution(p_work_order_id bigint, p_solution text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor      public.members;
  v_wo         public.work_orders;
  v_constraint text;
begin
  v_actor := private.require_member('{Crew}');
  v_wo := private.lock_work_order(p_work_order_id);
  perform private.assert_assigned_crew(v_actor, v_wo);
  perform private.assert_status(v_wo, '{In Progress}', 'edit the solution of');

  update public.work_orders
  set solution = nullif(btrim(p_solution), '')
  where id = v_wo.id;
exception
  when check_violation then
    get stacked diagnostics v_constraint = constraint_name;
    raise exception '%', private.constraint_message(v_constraint) using errcode = '22023';
end;
$$;

create function public.complete_work_order(p_work_order_id bigint, p_solution text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor      public.members;
  v_wo         public.work_orders;
  v_constraint text;
begin
  v_actor := private.require_member('{Crew}');
  v_wo := private.lock_work_order(p_work_order_id);
  perform private.assert_assigned_crew(v_actor, v_wo);
  perform private.assert_status(v_wo, '{In Progress}', 'complete');

  update public.work_orders
  set solution = nullif(btrim(p_solution), ''),
      status   = 'Done'
  where id = v_wo.id;

  insert into public.work_order_events (work_order_id, actor_id, event_type, from_status, to_status)
  values (v_wo.id, v_actor.id, 'completed', 'In Progress', 'Done');
exception
  when check_violation then
    get stacked diagnostics v_constraint = constraint_name;
    raise exception '%', private.constraint_message(v_constraint) using errcode = '22023';
end;
$$;

-- -----------------------------------------------------------------------------
-- Captain: review (attest or reject)
-- -----------------------------------------------------------------------------
create function public.attest_work_order(p_work_order_id bigint, p_comment text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor      public.members;
  v_wo         public.work_orders;
  v_constraint text;
begin
  v_actor := private.require_member('{Captain}');
  v_wo := private.lock_work_order(p_work_order_id);
  perform private.assert_vessel_captain(v_actor, v_wo);
  perform private.assert_status(v_wo, '{Done}', 'attest');

  update public.work_orders
  set attested_by = v_actor.id,
      attested_at = now()
  where id = v_wo.id;

  insert into public.work_order_events (work_order_id, actor_id, event_type, from_status, to_status, comment)
  values (v_wo.id, v_actor.id, 'attested', 'Done', 'Done', nullif(btrim(p_comment), ''));
exception
  when check_violation then
    get stacked diagnostics v_constraint = constraint_name;
    raise exception '%', private.constraint_message(v_constraint) using errcode = '22023';
end;
$$;

create function public.reject_work_order(p_work_order_id bigint, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor      public.members;
  v_wo         public.work_orders;
  v_reason     text := btrim(coalesce(p_reason, ''));
  v_constraint text;
begin
  v_actor := private.require_member('{Captain}');
  v_wo := private.lock_work_order(p_work_order_id);
  perform private.assert_vessel_captain(v_actor, v_wo);
  perform private.assert_status(v_wo, '{Done}', 'reject');

  update public.work_orders
  set status                = 'In Progress',
      rejection_count       = rejection_count + 1,
      last_rejection_reason = v_reason
  where id = v_wo.id;

  -- The event's CHECK constraint enforces the required reason.
  insert into public.work_order_events (work_order_id, actor_id, event_type, from_status, to_status, comment)
  values (v_wo.id, v_actor.id, 'rejected', 'Done', 'In Progress', v_reason);
exception
  when check_violation then
    get stacked diagnostics v_constraint = constraint_name;
    raise exception '%', private.constraint_message(v_constraint) using errcode = '22023';
end;
$$;

-- =============================================================================
-- Read helpers (SECURITY INVOKER: RLS decides what is counted)
-- =============================================================================

-- Dashboard counters for one vessel, or for everything visible when NULL.
create function public.work_order_stats(p_vessel_id uuid default null)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'open',            count(*) filter (where status = 'Open'),
    'in_progress',     count(*) filter (where status = 'In Progress'),
    'awaiting_review', count(*) filter (where status = 'Done' and attested_at is null),
    'attested',        count(*) filter (where attested_at is not null),
    'total',           count(*)
  )
  from public.work_orders
  where p_vessel_id is null or vessel_id = p_vessel_id
$$;

-- Vessel list with headcounts for the admin screen.
create view public.vessel_summaries
with (security_invoker = true)
as
select
  v.id,
  v.name,
  v.imo_number,
  v.vessel_type,
  v.is_active,
  v.created_at,
  v.updated_at,
  (select count(*)::int
     from public.vessel_assignments a
     join public.members m on m.id = a.member_id
    where a.vessel_id = v.id and m.is_active and m.role = 'Captain') as captain_count,
  (select count(*)::int
     from public.vessel_assignments a
     join public.members m on m.id = a.member_id
    where a.vessel_id = v.id and m.is_active and m.role = 'Crew') as crew_count,
  (select count(*)::int
     from public.work_orders w
    where w.vessel_id = v.id and w.attested_at is null) as active_work_order_count
from public.vessels v;

revoke all on public.vessel_summaries from anon, authenticated;
grant select on public.vessel_summaries to authenticated;

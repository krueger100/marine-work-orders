-- =============================================================================
-- Access control
--
-- Model:
--   * The browser talks to Supabase directly with the public key, so every rule
--     must hold inside Postgres. The UI only mirrors these rules.
--   * Identity = the member the caller's anonymous session is acting as
--     (private.acting_sessions). Swapping the mock for real auth would only
--     change the three helper functions below.
--   * Reads: Row Level Security on every table.
--   * Writes: no direct INSERT/UPDATE/DELETE for API roles at all. Every change
--     goes through a SECURITY DEFINER function that checks role, vessel
--     membership and workflow state in one transaction.
-- =============================================================================

grant usage on schema private to authenticated;

-- The acting member's id, or NULL when no active member is selected.
create function private.current_member_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.member_id
  from private.acting_sessions s
  join public.members m on m.id = s.member_id
  where s.user_id = auth.uid()
    and m.is_active
$$;

-- The acting member's role, or NULL.
create function private.current_member_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select m.role
  from private.acting_sessions s
  join public.members m on m.id = s.member_id
  where s.user_id = auth.uid()
    and m.is_active
$$;

-- Active vessels the acting member is assigned to.
create function private.current_vessel_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select a.vessel_id
  from private.acting_sessions s
  join public.members m on m.id = s.member_id and m.is_active
  join public.vessel_assignments a on a.member_id = m.id
  join public.vessels v on v.id = a.vessel_id and v.is_active
  where s.user_id = auth.uid()
$$;

-- -----------------------------------------------------------------------------
-- Table privileges: API roles may only SELECT, and only what RLS allows.
-- -----------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant select on all tables in schema public to authenticated;

revoke all on all tables in schema private from anon, authenticated;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- Helper calls are wrapped in (select ...) so Postgres evaluates them once per
-- query instead of once per row.
-- -----------------------------------------------------------------------------
alter table public.vessels            enable row level security;
alter table public.members            enable row level security;
alter table public.vessel_assignments enable row level security;
alter table public.work_orders        enable row level security;
alter table public.work_order_events  enable row level security;
alter table private.acting_sessions   enable row level security;

-- Admins see the whole fleet; everyone else sees the vessels they serve on.
create policy vessels_select on public.vessels
  for select to authenticated
  using (
    (select private.current_member_role()) = 'Admin'
    or id in (select private.current_vessel_ids())
  );

-- Admins see everyone; others see themselves and their shipmates.
create policy members_select on public.members
  for select to authenticated
  using (
    (select private.current_member_role()) = 'Admin'
    or id = (select private.current_member_id())
    or id in (
      select a.member_id
      from public.vessel_assignments a
      where a.vessel_id in (select private.current_vessel_ids())
    )
  );

create policy vessel_assignments_select on public.vessel_assignments
  for select to authenticated
  using (
    (select private.current_member_role()) = 'Admin'
    or vessel_id in (select private.current_vessel_ids())
  );

-- Captains: every work order on their vessels.
-- Crew: only work orders assigned to them, on vessels they still serve on.
create policy work_orders_select on public.work_orders
  for select to authenticated
  using (
    (select private.current_member_role()) = 'Admin'
    or (
      (select private.current_member_role()) = 'Captain'
      and vessel_id in (select private.current_vessel_ids())
    )
    or (
      (select private.current_member_role()) = 'Crew'
      and assigned_to = (select private.current_member_id())
      and vessel_id in (select private.current_vessel_ids())
    )
  );

-- History is visible exactly when its work order is.
create policy work_order_events_select on public.work_order_events
  for select to authenticated
  using (
    exists (select 1 from public.work_orders w where w.id = work_order_id)
  );

-- private.acting_sessions has RLS enabled and no policies: only the
-- SECURITY DEFINER functions (owned by postgres) can touch it.

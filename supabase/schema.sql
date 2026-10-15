-- =============================================================================
-- schema.sql: the complete database schema, generated from supabase/migrations
-- (npm run db:schema). Apply the migrations, not this file, to a live project.
-- =============================================================================

-- >>> supabase/migrations/20261015000100_schema.sql

-- =============================================================================
-- Marine Work Orders: core schema
-- Tables, constraints and indexes. Access control lives in the next migration.
-- =============================================================================

create schema if not exists private;  -- not exposed through the Data API

create type public.app_role as enum ('Admin', 'Captain', 'Crew');
create type public.work_order_status as enum ('Open', 'In Progress', 'Done');
create type public.work_order_event_type as enum (
  'created', 'started', 'completed', 'attested', 'rejected', 'reassigned'
);

-- IMO numbers are 7 digits; the last digit is a checksum of the first six
-- (weights 7..2). Validating it catches most typos at the database level.
create function private.is_valid_imo(p_imo text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_imo ~ '^[0-9]{7}$' then
      (  substr(p_imo, 1, 1)::int * 7 + substr(p_imo, 2, 1)::int * 6
       + substr(p_imo, 3, 1)::int * 5 + substr(p_imo, 4, 1)::int * 4
       + substr(p_imo, 5, 1)::int * 3 + substr(p_imo, 6, 1)::int * 2) % 10
      = substr(p_imo, 7, 1)::int
    else false
  end
$$;

-- -----------------------------------------------------------------------------
-- Vessels
-- -----------------------------------------------------------------------------
create table public.vessels (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  imo_number  text not null,
  vessel_type text not null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint vessels_name_length
    check (name = btrim(name) and char_length(name) between 2 and 80),
  constraint vessels_imo_valid
    check (private.is_valid_imo(imo_number)),
  constraint vessels_type_length
    check (vessel_type = btrim(vessel_type) and char_length(vessel_type) between 2 and 40)
);

-- IMO is the real-world identity of a ship; names are also kept unique so the
-- vessel selector is never ambiguous.
create unique index vessels_imo_number_key on public.vessels (imo_number);
create unique index vessels_name_key on public.vessels (lower(name));

-- -----------------------------------------------------------------------------
-- Members (application users)
-- -----------------------------------------------------------------------------
create table public.members (
  id         uuid primary key default gen_random_uuid(),
  full_name  text not null,
  email      text not null,
  role       public.app_role not null,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint members_full_name_length
    check (full_name = btrim(full_name) and char_length(full_name) between 2 and 100),
  -- Stored lower-cased so the unique index below is case-insensitive.
  constraint members_email_format
    check (email = lower(btrim(email))
           and char_length(email) <= 254
           and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

create unique index members_email_key on public.members (email);
create index members_role_idx on public.members (role) where is_active;

-- -----------------------------------------------------------------------------
-- Vessel assignments (many-to-many: a member can serve on several vessels)
-- Admins are fleet-wide and never assigned; enforced by the admin RPCs.
-- -----------------------------------------------------------------------------
create table public.vessel_assignments (
  vessel_id   uuid not null references public.vessels (id) on delete restrict,
  member_id   uuid not null references public.members (id) on delete restrict,
  assigned_at timestamptz not null default now(),
  primary key (vessel_id, member_id)
);

create index vessel_assignments_member_idx on public.vessel_assignments (member_id);

-- -----------------------------------------------------------------------------
-- Work orders
-- Status is strictly Open / In Progress / Done. Attestation is a separate,
-- final fact recorded on a Done work order (attested_at / attested_by).
-- "Active" work order == not yet attested.
-- -----------------------------------------------------------------------------
create table public.work_orders (
  id                    bigint generated always as identity primary key,
  vessel_id             uuid not null references public.vessels (id) on delete restrict,
  title                 text not null,
  issue                 text not null,
  solution              text,
  status                public.work_order_status not null default 'Open',
  assigned_to           uuid not null references public.members (id) on delete restrict,
  created_by            uuid not null references public.members (id) on delete restrict,
  attested_by           uuid references public.members (id) on delete restrict,
  attested_at           timestamptz,
  rejection_count       integer not null default 0,
  last_rejection_reason text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint work_orders_title_length
    check (title = btrim(title) and char_length(title) between 3 and 120),
  constraint work_orders_issue_length
    check (issue = btrim(issue) and char_length(issue) between 3 and 4000),
  constraint work_orders_solution_length
    check (solution is null or char_length(solution) <= 4000),
  constraint work_orders_done_requires_solution
    check (status <> 'Done' or char_length(btrim(coalesce(solution, ''))) > 0),
  constraint work_orders_attestation_consistent
    check ((attested_at is null) = (attested_by is null)
           and (attested_at is null or status = 'Done')),
  constraint work_orders_rejection_count_positive
    check (rejection_count >= 0)
);

-- Captain/Admin lists: one vessel, optional status filter, newest first.
create index work_orders_vessel_status_idx on public.work_orders (vessel_id, status, id desc);
-- Crew lists and the "has active work" guards.
create index work_orders_assignee_status_idx on public.work_orders (assigned_to, status, id desc);
create index work_orders_created_by_idx on public.work_orders (created_by);
create index work_orders_attested_by_idx on public.work_orders (attested_by) where attested_by is not null;

-- -----------------------------------------------------------------------------
-- Work order events: append-only audit trail (who did what, and why).
-- Rejection reasons live here, so the history survives repeated rejections.
-- -----------------------------------------------------------------------------
create table public.work_order_events (
  id            bigint generated always as identity primary key,
  work_order_id bigint not null references public.work_orders (id) on delete cascade,
  actor_id      uuid not null references public.members (id) on delete restrict,
  event_type    public.work_order_event_type not null,
  from_status   public.work_order_status,
  to_status     public.work_order_status,
  comment       text,
  created_at    timestamptz not null default now(),
  constraint work_order_events_comment_length
    check (comment is null or char_length(comment) <= 2000),
  constraint work_order_events_rejection_needs_reason
    check (event_type <> 'rejected' or char_length(btrim(coalesce(comment, ''))) >= 5)
);

create index work_order_events_work_order_idx on public.work_order_events (work_order_id, id);
create index work_order_events_actor_idx on public.work_order_events (actor_id);

-- -----------------------------------------------------------------------------
-- Acting sessions (the mock-auth bridge)
-- Each browser tab signs in as an anonymous Supabase user; this table records
-- which member that anonymous user is currently acting as. Kept in the private
-- schema: only SECURITY DEFINER functions read or write it.
-- -----------------------------------------------------------------------------
create table private.acting_sessions (
  user_id    uuid primary key,  -- auth.uid() of the anonymous session
  member_id  uuid not null references public.members (id) on delete cascade,
  updated_at timestamptz not null default now()
);

create index acting_sessions_member_idx on private.acting_sessions (member_id);

-- -----------------------------------------------------------------------------
-- updated_at maintenance
-- -----------------------------------------------------------------------------
create function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger vessels_touch_updated_at
  before update on public.vessels
  for each row execute function private.touch_updated_at();

create trigger members_touch_updated_at
  before update on public.members
  for each row execute function private.touch_updated_at();

create trigger work_orders_touch_updated_at
  before update on public.work_orders
  for each row execute function private.touch_updated_at();

-- >>> supabase/migrations/20261015000200_access_control.sql

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

-- >>> supabase/migrations/20261015000300_session_and_guards.sql

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

-- >>> supabase/migrations/20261015000400_admin_rpcs.sql

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

-- >>> supabase/migrations/20261015000500_work_order_rpcs.sql

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

-- >>> supabase/migrations/20261015000600_demo_data.sql

-- =============================================================================
-- Demo data
--
-- private.seed_demo_data() rebuilds a realistic fleet with fixed ids, plus one
-- load-test vessel holding p_load_test_orders generated work orders. Fixed ids
-- mean anyone acting as a seeded member stays signed in across a reset.
-- All names, emails (.test domain) and IMO numbers are fictional.
-- =============================================================================

create function private.seed_demo_data(p_load_test_orders integer default 50000)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- vessels
  v_coral    constant uuid := 'a0000000-0000-4000-8000-000000000001';
  v_biscayne constant uuid := 'a0000000-0000-4000-8000-000000000002';
  v_atlantic constant uuid := 'a0000000-0000-4000-8000-000000000003';
  v_keys     constant uuid := 'a0000000-0000-4000-8000-000000000004';
  v_atlas    constant uuid := 'a0000000-0000-4000-8000-000000000005';
  v_harbor   constant uuid := 'a0000000-0000-4000-8000-000000000006';
  -- admins
  m_morgan   constant uuid := 'b0000000-0000-4000-8000-000000000001';
  m_priya    constant uuid := 'b0000000-0000-4000-8000-000000000002';
  -- captains
  m_elena    constant uuid := 'b0000000-0000-4000-8000-000000000011';
  m_tomas    constant uuid := 'b0000000-0000-4000-8000-000000000012';
  m_james    constant uuid := 'b0000000-0000-4000-8000-000000000013';
  m_sofia    constant uuid := 'b0000000-0000-4000-8000-000000000014';
  m_daniel   constant uuid := 'b0000000-0000-4000-8000-000000000015';
  m_hannah   constant uuid := 'b0000000-0000-4000-8000-000000000016';
  -- crew
  m_liam     constant uuid := 'b0000000-0000-4000-8000-000000000101';
  m_ava      constant uuid := 'b0000000-0000-4000-8000-000000000102';
  m_noah     constant uuid := 'b0000000-0000-4000-8000-000000000103';
  m_mia      constant uuid := 'b0000000-0000-4000-8000-000000000104';
  m_ethan    constant uuid := 'b0000000-0000-4000-8000-000000000105';
  m_olivia   constant uuid := 'b0000000-0000-4000-8000-000000000106';
  m_lucas    constant uuid := 'b0000000-0000-4000-8000-000000000107';
  m_isabella constant uuid := 'b0000000-0000-4000-8000-000000000108';
  m_mateo    constant uuid := 'b0000000-0000-4000-8000-000000000109';
  m_grace    constant uuid := 'b0000000-0000-4000-8000-000000000110';

  v_sessions private.acting_sessions[];
begin
  v_sessions := array(select s from private.acting_sessions s);

  truncate public.work_order_events,
           public.work_orders,
           public.vessel_assignments,
           private.acting_sessions,
           public.members,
           public.vessels
    restart identity;

  insert into public.vessels (id, name, imo_number, vessel_type, is_active) values
    (v_coral,    'MV Coral Meridian',              '9387425', 'Cruise ship',      true),
    (v_biscayne, 'MV Biscayne Star',               '9412634', 'Expedition yacht', true),
    (v_atlantic, 'MV Atlantic Serenade',           '9520780', 'Cruise ship',      true),
    (v_keys,     'MV Keys Voyager',                '9603154', 'Tender',           true),
    (v_atlas,    'MV Atlas Endurance (load test)', '9735842', 'Cruise ship',      true),
    (v_harbor,   'MV Harbor Pilot',                '9851268', 'Tender',           false);

  insert into public.members (id, full_name, email, role, is_active) values
    (m_morgan,   'Morgan Hale',     'morgan.hale@fleet.test',     'Admin',   true),
    (m_priya,    'Priya Raman',     'priya.raman@fleet.test',     'Admin',   true),
    (m_elena,    'Elena Vasquez',   'elena.vasquez@fleet.test',   'Captain', true),
    (m_tomas,    'Tomás Rivera',    'tomas.rivera@fleet.test',    'Captain', true),
    (m_james,    'James Okafor',    'james.okafor@fleet.test',    'Captain', true),
    (m_sofia,    'Sofia Lindqvist', 'sofia.lindqvist@fleet.test', 'Captain', true),
    (m_daniel,   'Daniel Mercer',   'daniel.mercer@fleet.test',   'Captain', true),
    (m_hannah,   'Hannah Brooks',   'hannah.brooks@fleet.test',   'Captain', true),
    (m_liam,     'Liam Chen',       'liam.chen@fleet.test',       'Crew',    true),
    (m_ava,      'Ava Patel',       'ava.patel@fleet.test',       'Crew',    true),
    (m_noah,     'Noah Williams',   'noah.williams@fleet.test',   'Crew',    true),
    (m_mia,      'Mia Santos',      'mia.santos@fleet.test',      'Crew',    true),
    (m_ethan,    'Ethan Kim',       'ethan.kim@fleet.test',       'Crew',    true),
    (m_olivia,   'Olivia Nguyen',   'olivia.nguyen@fleet.test',   'Crew',    true),
    (m_lucas,    'Lucas Martin',    'lucas.martin@fleet.test',    'Crew',    true),
    (m_isabella, 'Isabella Rossi',  'isabella.rossi@fleet.test',  'Crew',    true),
    (m_mateo,    'Mateo Garcia',    'mateo.garcia@fleet.test',    'Crew',    true),
    (m_grace,    'Grace Turner',    'grace.turner@fleet.test',    'Crew',    false);

  insert into public.vessel_assignments (vessel_id, member_id) values
    -- Coral Meridian has two captains; Liam also serves on Biscayne Star.
    (v_coral, m_elena), (v_coral, m_tomas), (v_coral, m_liam), (v_coral, m_ava), (v_coral, m_noah),
    (v_biscayne, m_james), (v_biscayne, m_liam), (v_biscayne, m_mia), (v_biscayne, m_ethan),
    (v_atlantic, m_sofia), (v_atlantic, m_olivia), (v_atlantic, m_lucas), (v_atlantic, m_grace),
    (v_keys, m_daniel), (v_keys, m_isabella), (v_keys, m_mateo),
    (v_atlas, m_hannah);

  -- Hand-written work orders covering every state of the lifecycle.
  insert into public.work_orders (
    vessel_id, title, issue, solution, status, assigned_to, created_by,
    attested_by, attested_at, rejection_count, last_rejection_reason, created_at, updated_at
  )
  select
    d.vessel_id, d.title, d.issue, d.solution, d.status::public.work_order_status,
    d.assigned_to, d.created_by,
    case when d.attested then d.created_by end,
    case when d.attested then now() - make_interval(days => d.days_ago) + interval '2 days 4 hours' end,
    case when d.rejection is null then 0 else 1 end,
    d.rejection,
    now() - make_interval(days => d.days_ago),
    now() - make_interval(days => d.days_ago) + case
      when d.attested               then interval '2 days 4 hours'
      when d.status = 'Done'        then interval '2 days'
      when d.rejection is not null  then interval '1 day 3 hours'
      when d.status = 'In Progress' then interval '2 hours'
      else interval '0'
    end
  from (values
    (1,  v_coral, 'Port stabilizer fin hydraulic leak',
         'Hydraulic oil weeping from the port stabilizer fin actuator seal. Level dropped 4 L in 24 h; fin locked amidships as a precaution.',
         null, 'Open', m_liam, m_elena, false, 1, null),
    (2,  v_coral, 'HVAC chiller #2 tripping on high pressure',
         'Chiller #2 trips on the HP alarm during afternoon peak load. Condenser inlet reads 34 °C.',
         'Condenser tubes partially fouled. Chemical descale scheduled for the next port day.',
         'In Progress', m_ava, m_elena, false, 3, null),
    (3,  v_coral, 'Galley walk-in freezer door seal',
         'Door gasket torn on the hinge side; frost build-up and temperature drifting to -14 °C.',
         'Replaced the gasket with the OEM part and adjusted the hinge. Holding -20 °C after 6 h.',
         'Done', m_noah, m_tomas, false, 4, null),
    (4,  v_coral, 'Lifeboat #4 davit winch brake inspection',
         'Quarterly SOLAS inspection of the davit winch centrifugal brake.',
         'Brake pads within tolerance; boat lowered and recovered under load. Logged in the PMS.',
         'Done', m_liam, m_elena, true, 9, null),
    (5,  v_coral, 'Bridge radar ARPA intermittent target loss',
         'X-band radar drops ARPA targets beyond 6 NM in heavy rain clutter.',
         'Adjusted the rain clutter gain.',
         'In Progress', m_ava, m_elena, false, 6,
         'A gain change alone is not a fix. Check the waveguide joint for moisture and attach the test log.'),
    (6,  v_biscayne, 'Tender crane slew bearing greasing',
         'Slew bearing grease interval overdue by 50 running hours.',
         null, 'Open', m_mia, m_james, false, 2, null),
    (7,  v_biscayne, 'Watermaker membrane pressure drop',
         'RO watermaker output down 30%; feed pressure low at 48 bar.',
         'Replaced the pre-filters and cleaned the membranes. Output back to 95% at 56 bar.',
         'Done', m_ethan, m_james, false, 5, null),
    (8,  v_biscayne, 'Main engine #1 fuel injector replacement',
         'Cylinder 3 exhaust temperature 40 °C above average; suspected injector.',
         'Replaced the cylinder 3 injector. Exhaust temperatures balanced within 10 °C.',
         'Done', m_mia, m_james, true, 12, null),
    (9,  v_biscayne, 'Guest cabin 204 shower drain blockage',
         'Guest reports standing water in the shower tray.',
         null, 'Open', m_liam, m_james, false, 1, null),
    (10, v_atlantic, 'Pool deck tile delamination',
         'Several tiles lifting near the aft pool coaming; area taped off as a trip hazard.',
         null, 'In Progress', m_olivia, m_sofia, false, 3, null),
    (11, v_atlantic, 'Emergency generator monthly load test',
         'Monthly 30-minute load test of the emergency generator.',
         'Ran 30 min at 75% load; all parameters normal and ATS changeover verified.',
         'Done', m_lucas, m_sofia, true, 15, null),
    (12, v_keys, 'Bow thruster vibration at 60% load',
         'Noticeable vibration and noise from the bow thruster above 60% pitch.',
         null, 'Open', m_isabella, m_daniel, false, 2, null),
    (13, v_keys, 'Starboard navigation light driver failure',
         'Starboard sidelight LED flickering; secondary lamp in use.',
         'Replaced the LED driver module; tested primary and secondary circuits.',
         'Done', m_mateo, m_daniel, false, 4, null)
  ) as d(seq, vessel_id, title, issue, solution, status, assigned_to, created_by, attested, days_ago, rejection)
  order by d.seq;

  -- Audit trail for the hand-written work orders, consistent with their state.
  insert into public.work_order_events (work_order_id, actor_id, event_type, from_status, to_status, comment, created_at)
  select e.work_order_id, e.actor_id, e.event_type::public.work_order_event_type,
         e.from_status::public.work_order_status, e.to_status::public.work_order_status,
         e.comment, e.created_at
  from (
    select w.id as work_order_id, w.created_by as actor_id, 'created' as event_type,
           null as from_status, 'Open' as to_status, null as comment, w.created_at
    from public.work_orders w
    union all
    select w.id, w.assigned_to, 'started', 'Open', 'In Progress', null, w.created_at + interval '2 hours'
    from public.work_orders w where w.status <> 'Open'
    union all
    select w.id, w.assigned_to, 'completed', 'In Progress', 'Done', null, w.created_at + interval '1 day'
    from public.work_orders w where w.rejection_count > 0
    union all
    select w.id, w.created_by, 'rejected', 'Done', 'In Progress', w.last_rejection_reason, w.created_at + interval '1 day 3 hours'
    from public.work_orders w where w.rejection_count > 0
    union all
    select w.id, w.assigned_to, 'completed', 'In Progress', 'Done', null, w.created_at + interval '2 days'
    from public.work_orders w where w.status = 'Done'
    union all
    select w.id, w.attested_by, 'attested', 'Done', 'Done', null, w.attested_at
    from public.work_orders w where w.attested_at is not null
  ) e
  order by e.created_at;

  -- Load-test vessel: 20 crew and p_load_test_orders generated work orders,
  -- spread evenly over the four states. No event history, to keep resets fast.
  -- They use their own id range (900001+), so work orders created in the demo
  -- continue the normal sequence right after the hand-written ones.
  insert into public.members (id, full_name, email, role)
  select ('b0000000-0000-4000-8000-' || lpad((200 + i)::text, 12, '0'))::uuid,
         'Atlas Crew ' || lpad(i::text, 2, '0'),
         'atlas.crew' || lpad(i::text, 2, '0') || '@fleet.test',
         'Crew'
  from generate_series(1, 20) as i;

  insert into public.vessel_assignments (vessel_id, member_id)
  select v_atlas, ('b0000000-0000-4000-8000-' || lpad((200 + i)::text, 12, '0'))::uuid
  from generate_series(1, 20) as i;

  insert into public.work_orders (
    id, vessel_id, title, issue, solution, status, assigned_to, created_by,
    attested_by, attested_at, created_at, updated_at
  )
  overriding system value
  select
    900000 + i,
    v_atlas,
    (array['Inspect', 'Service', 'Replace', 'Calibrate', 'Repair', 'Clean'])[1 + i % 6]
      || ' '
      || (array['ballast pump', 'fire damper', 'sewage plant valve', 'galley exhaust fan',
                'stern tube seal', 'corridor lighting', 'reverse-osmosis filter',
                'anchor windlass brake', 'HVAC air handler', 'fuel separator'])[1 + (i / 6) % 10]
      || ' #' || i,
    'Generated load-test work order ' || i || '.',
    case when i % 4 >= 2 then 'Generated solution for load-test work order ' || i || '.' end,
    (case i % 4 when 0 then 'Open' when 1 then 'In Progress' else 'Done' end)::public.work_order_status,
    ('b0000000-0000-4000-8000-' || lpad((201 + i % 20)::text, 12, '0'))::uuid,
    m_hannah,
    case when i % 4 = 3 then m_hannah end,
    case when i % 4 = 3 then now() - make_interval(mins => p_load_test_orders - i) end,
    now() - make_interval(mins => p_load_test_orders - i) - interval '1 day',
    now() - make_interval(mins => p_load_test_orders - i)
  from generate_series(1, greatest(p_load_test_orders, 0)) as i;

  -- Restore sessions whose member still exists and is active.
  insert into private.acting_sessions (user_id, member_id, updated_at)
  select s.user_id, s.member_id, s.updated_at
  from unnest(v_sessions) as s
  where exists (select 1 from public.members m where m.id = s.member_id and m.is_active);
end;
$$;

-- Admin-only "Reset demo data" button: reviewers share one live database.
create function public.reset_demo_data()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_member('{Admin}');
  perform private.seed_demo_data();
end;
$$;

-- >>> supabase/migrations/20261015000700_function_privileges.sql

-- =============================================================================
-- Function privileges (applied last, after every function exists)
--
-- Postgres grants EXECUTE to PUBLIC by default and Supabase additionally grants
-- it to anon. Lock that down: only signed-in sessions may call the public RPCs,
-- and nothing in the private schema is callable except the three identity
-- helpers that RLS policies need.
-- =============================================================================

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.current_member_id()   to authenticated;
grant execute on function private.current_member_role() to authenticated;
grant execute on function private.current_vessel_ids()  to authenticated;

-- Keep future functions closed by default too.
alter default privileges for role postgres in schema public  revoke execute on functions from public, anon;
alter default privileges for role postgres in schema private revoke execute on functions from public, anon, authenticated;

-- >>> supabase/migrations/20261015000800_hardening.sql

-- =============================================================================
-- Hardening
--
--   1. One lock order everywhere: member rows before vessel rows. Creating a
--      work order used to lock the vessel first, which could deadlock with a
--      concurrent deactivation or removal of the same crew member.
--   2. A work order the caller is not allowed to see is reported exactly like
--      one that does not exist ("Work order not found."), so ids on other
--      vessels cannot be discovered through error messages.
--   3. "Reset demo data" has a 10-minute cooldown. A single locked row makes
--      concurrent requests queue, so the cooldown cannot be bypassed. The seed
--      now clears the small fleet tables with DELETE instead of TRUNCATE
--      (which is not MVCC-safe), so requests overlapping a reset never see
--      members or sessions disappear.
--   4. EXECUTE is granted function by function: API roles can call only the
--      RPCs the app uses. The unused public.set_member_vessels RPC is removed
--      (update_member applies the same rules and is what the UI calls).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 2. Lock a work order the acting member may see, or report "not found".
-- Visibility matches the work_orders RLS policy.
-- -----------------------------------------------------------------------------
create function private.lock_visible_work_order(p_id bigint, p_actor public.members)
returns public.work_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wo public.work_orders;
begin
  select w.* into v_wo
  from public.work_orders w
  where w.id = p_id
    and case p_actor.role
          when 'Admin'   then true
          when 'Captain' then private.is_assigned(p_actor.id, w.vessel_id)
          else w.assigned_to = p_actor.id and private.is_assigned(p_actor.id, w.vessel_id)
        end
  for update;

  if not found then
    raise exception 'Work order not found.' using errcode = 'P0001';
  end if;
  return v_wo;
end;
$$;

-- -----------------------------------------------------------------------------
-- 1. Captain: create (member locked before vessel)
-- -----------------------------------------------------------------------------
create or replace function public.create_work_order(
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
  if not private.is_assigned(v_actor.id, p_vessel_id) then
    raise exception 'You can only create work orders for vessels you command.' using errcode = '42501';
  end if;

  -- Lock order: the crew member's row first (FOR SHARE, inside the helper),
  -- then the vessel (FOR SHARE). The deactivation and removal guards lock the
  -- member and then its vessels, so concurrent requests queue, never deadlock.
  perform private.assert_assignable_crew(p_assigned_to, p_vessel_id);
  perform 1 from public.vessels where id = p_vessel_id and is_active for share;

  -- Re-check under the locks: the captain may have been removed or deactivated
  -- while this request was waiting.
  v_actor := private.require_member('{Captain}');
  if not private.is_assigned(v_actor.id, p_vessel_id) then
    raise exception 'You can only create work orders for vessels you command.' using errcode = '42501';
  end if;

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
-- Lifecycle functions now resolve the work order through
-- private.lock_visible_work_order (rule 2). For crew, "visible" means assigned
-- to them on a vessel they serve on; for captains, on a vessel they command:
-- the same checks the removed assert_assigned_crew / assert_vessel_captain made.
-- -----------------------------------------------------------------------------
create or replace function public.reassign_work_order(p_work_order_id bigint, p_assigned_to uuid)
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
  v_wo := private.lock_visible_work_order(p_work_order_id, v_actor);
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

create or replace function public.start_work_order(p_work_order_id bigint)
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
  v_wo := private.lock_visible_work_order(p_work_order_id, v_actor);
  perform private.assert_status(v_wo, '{Open}', 'start');

  update public.work_orders set status = 'In Progress' where id = v_wo.id;

  insert into public.work_order_events (work_order_id, actor_id, event_type, from_status, to_status)
  values (v_wo.id, v_actor.id, 'started', 'Open', 'In Progress');
end;
$$;

create or replace function public.save_work_order_solution(p_work_order_id bigint, p_solution text)
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
  v_wo := private.lock_visible_work_order(p_work_order_id, v_actor);
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

create or replace function public.complete_work_order(p_work_order_id bigint, p_solution text)
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
  v_wo := private.lock_visible_work_order(p_work_order_id, v_actor);
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

create or replace function public.attest_work_order(p_work_order_id bigint, p_comment text default null)
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
  v_wo := private.lock_visible_work_order(p_work_order_id, v_actor);
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

create or replace function public.reject_work_order(p_work_order_id bigint, p_reason text)
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
  v_wo := private.lock_visible_work_order(p_work_order_id, v_actor);
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

-- Superseded by private.lock_visible_work_order.
drop function private.assert_assigned_crew(public.members, public.work_orders);
drop function private.assert_vessel_captain(public.members, public.work_orders);
drop function private.lock_work_order(bigint);

-- -----------------------------------------------------------------------------
-- 3. Reset cooldown
-- -----------------------------------------------------------------------------
create table private.demo_resets (
  singleton     boolean primary key default true check (singleton),
  last_reset_at timestamptz not null default '-infinity'
);
alter table private.demo_resets enable row level security;  -- no policies: definer functions only
insert into private.demo_resets default values;

-- Same demo data as migration 600; only the clearing step changes (see below).
create or replace function private.seed_demo_data(p_load_test_orders integer default 50000)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- vessels
  v_coral    constant uuid := 'a0000000-0000-4000-8000-000000000001';
  v_biscayne constant uuid := 'a0000000-0000-4000-8000-000000000002';
  v_atlantic constant uuid := 'a0000000-0000-4000-8000-000000000003';
  v_keys     constant uuid := 'a0000000-0000-4000-8000-000000000004';
  v_atlas    constant uuid := 'a0000000-0000-4000-8000-000000000005';
  v_harbor   constant uuid := 'a0000000-0000-4000-8000-000000000006';
  -- admins
  m_morgan   constant uuid := 'b0000000-0000-4000-8000-000000000001';
  m_priya    constant uuid := 'b0000000-0000-4000-8000-000000000002';
  -- captains
  m_elena    constant uuid := 'b0000000-0000-4000-8000-000000000011';
  m_tomas    constant uuid := 'b0000000-0000-4000-8000-000000000012';
  m_james    constant uuid := 'b0000000-0000-4000-8000-000000000013';
  m_sofia    constant uuid := 'b0000000-0000-4000-8000-000000000014';
  m_daniel   constant uuid := 'b0000000-0000-4000-8000-000000000015';
  m_hannah   constant uuid := 'b0000000-0000-4000-8000-000000000016';
  -- crew
  m_liam     constant uuid := 'b0000000-0000-4000-8000-000000000101';
  m_ava      constant uuid := 'b0000000-0000-4000-8000-000000000102';
  m_noah     constant uuid := 'b0000000-0000-4000-8000-000000000103';
  m_mia      constant uuid := 'b0000000-0000-4000-8000-000000000104';
  m_ethan    constant uuid := 'b0000000-0000-4000-8000-000000000105';
  m_olivia   constant uuid := 'b0000000-0000-4000-8000-000000000106';
  m_lucas    constant uuid := 'b0000000-0000-4000-8000-000000000107';
  m_isabella constant uuid := 'b0000000-0000-4000-8000-000000000108';
  m_mateo    constant uuid := 'b0000000-0000-4000-8000-000000000109';
  m_grace    constant uuid := 'b0000000-0000-4000-8000-000000000110';

  v_sessions private.acting_sessions[];
begin
  v_sessions := array(select s from private.acting_sessions s);

  -- The two large work-order tables are truncated (fast). The small fleet
  -- tables are cleared with DELETE, which is MVCC-safe: TRUNCATE is not, so
  -- requests that overlap a reset could otherwise see members and sessions
  -- vanish (e.g. "No active member selected"). DELETE also takes no exclusive
  -- table lock, so readers of these tables never block the reset or vice versa.
  truncate public.work_order_events, public.work_orders restart identity;
  delete from public.vessel_assignments;
  delete from private.acting_sessions;
  delete from public.members;
  delete from public.vessels;

  insert into public.vessels (id, name, imo_number, vessel_type, is_active) values
    (v_coral,    'MV Coral Meridian',              '9387425', 'Cruise ship',      true),
    (v_biscayne, 'MV Biscayne Star',               '9412634', 'Expedition yacht', true),
    (v_atlantic, 'MV Atlantic Serenade',           '9520780', 'Cruise ship',      true),
    (v_keys,     'MV Keys Voyager',                '9603154', 'Tender',           true),
    (v_atlas,    'MV Atlas Endurance (load test)', '9735842', 'Cruise ship',      true),
    (v_harbor,   'MV Harbor Pilot',                '9851268', 'Tender',           false);

  insert into public.members (id, full_name, email, role, is_active) values
    (m_morgan,   'Morgan Hale',     'morgan.hale@fleet.test',     'Admin',   true),
    (m_priya,    'Priya Raman',     'priya.raman@fleet.test',     'Admin',   true),
    (m_elena,    'Elena Vasquez',   'elena.vasquez@fleet.test',   'Captain', true),
    (m_tomas,    'Tomás Rivera',    'tomas.rivera@fleet.test',    'Captain', true),
    (m_james,    'James Okafor',    'james.okafor@fleet.test',    'Captain', true),
    (m_sofia,    'Sofia Lindqvist', 'sofia.lindqvist@fleet.test', 'Captain', true),
    (m_daniel,   'Daniel Mercer',   'daniel.mercer@fleet.test',   'Captain', true),
    (m_hannah,   'Hannah Brooks',   'hannah.brooks@fleet.test',   'Captain', true),
    (m_liam,     'Liam Chen',       'liam.chen@fleet.test',       'Crew',    true),
    (m_ava,      'Ava Patel',       'ava.patel@fleet.test',       'Crew',    true),
    (m_noah,     'Noah Williams',   'noah.williams@fleet.test',   'Crew',    true),
    (m_mia,      'Mia Santos',      'mia.santos@fleet.test',      'Crew',    true),
    (m_ethan,    'Ethan Kim',       'ethan.kim@fleet.test',       'Crew',    true),
    (m_olivia,   'Olivia Nguyen',   'olivia.nguyen@fleet.test',   'Crew',    true),
    (m_lucas,    'Lucas Martin',    'lucas.martin@fleet.test',    'Crew',    true),
    (m_isabella, 'Isabella Rossi',  'isabella.rossi@fleet.test',  'Crew',    true),
    (m_mateo,    'Mateo Garcia',    'mateo.garcia@fleet.test',    'Crew',    true),
    (m_grace,    'Grace Turner',    'grace.turner@fleet.test',    'Crew',    false);

  insert into public.vessel_assignments (vessel_id, member_id) values
    -- Coral Meridian has two captains; Liam also serves on Biscayne Star.
    (v_coral, m_elena), (v_coral, m_tomas), (v_coral, m_liam), (v_coral, m_ava), (v_coral, m_noah),
    (v_biscayne, m_james), (v_biscayne, m_liam), (v_biscayne, m_mia), (v_biscayne, m_ethan),
    (v_atlantic, m_sofia), (v_atlantic, m_olivia), (v_atlantic, m_lucas), (v_atlantic, m_grace),
    (v_keys, m_daniel), (v_keys, m_isabella), (v_keys, m_mateo),
    (v_atlas, m_hannah);

  -- Hand-written work orders covering every state of the lifecycle.
  insert into public.work_orders (
    vessel_id, title, issue, solution, status, assigned_to, created_by,
    attested_by, attested_at, rejection_count, last_rejection_reason, created_at, updated_at
  )
  select
    d.vessel_id, d.title, d.issue, d.solution, d.status::public.work_order_status,
    d.assigned_to, d.created_by,
    case when d.attested then d.created_by end,
    case when d.attested then now() - make_interval(days => d.days_ago) + interval '2 days 4 hours' end,
    case when d.rejection is null then 0 else 1 end,
    d.rejection,
    now() - make_interval(days => d.days_ago),
    now() - make_interval(days => d.days_ago) + case
      when d.attested               then interval '2 days 4 hours'
      when d.status = 'Done'        then interval '2 days'
      when d.rejection is not null  then interval '1 day 3 hours'
      when d.status = 'In Progress' then interval '2 hours'
      else interval '0'
    end
  from (values
    (1,  v_coral, 'Port stabilizer fin hydraulic leak',
         'Hydraulic oil weeping from the port stabilizer fin actuator seal. Level dropped 4 L in 24 h; fin locked amidships as a precaution.',
         null, 'Open', m_liam, m_elena, false, 1, null),
    (2,  v_coral, 'HVAC chiller #2 tripping on high pressure',
         'Chiller #2 trips on the HP alarm during afternoon peak load. Condenser inlet reads 34 °C.',
         'Condenser tubes partially fouled. Chemical descale scheduled for the next port day.',
         'In Progress', m_ava, m_elena, false, 3, null),
    (3,  v_coral, 'Galley walk-in freezer door seal',
         'Door gasket torn on the hinge side; frost build-up and temperature drifting to -14 °C.',
         'Replaced the gasket with the OEM part and adjusted the hinge. Holding -20 °C after 6 h.',
         'Done', m_noah, m_tomas, false, 4, null),
    (4,  v_coral, 'Lifeboat #4 davit winch brake inspection',
         'Quarterly SOLAS inspection of the davit winch centrifugal brake.',
         'Brake pads within tolerance; boat lowered and recovered under load. Logged in the PMS.',
         'Done', m_liam, m_elena, true, 9, null),
    (5,  v_coral, 'Bridge radar ARPA intermittent target loss',
         'X-band radar drops ARPA targets beyond 6 NM in heavy rain clutter.',
         'Adjusted the rain clutter gain.',
         'In Progress', m_ava, m_elena, false, 6,
         'A gain change alone is not a fix. Check the waveguide joint for moisture and attach the test log.'),
    (6,  v_biscayne, 'Tender crane slew bearing greasing',
         'Slew bearing grease interval overdue by 50 running hours.',
         null, 'Open', m_mia, m_james, false, 2, null),
    (7,  v_biscayne, 'Watermaker membrane pressure drop',
         'RO watermaker output down 30%; feed pressure low at 48 bar.',
         'Replaced the pre-filters and cleaned the membranes. Output back to 95% at 56 bar.',
         'Done', m_ethan, m_james, false, 5, null),
    (8,  v_biscayne, 'Main engine #1 fuel injector replacement',
         'Cylinder 3 exhaust temperature 40 °C above average; suspected injector.',
         'Replaced the cylinder 3 injector. Exhaust temperatures balanced within 10 °C.',
         'Done', m_mia, m_james, true, 12, null),
    (9,  v_biscayne, 'Guest cabin 204 shower drain blockage',
         'Guest reports standing water in the shower tray.',
         null, 'Open', m_liam, m_james, false, 1, null),
    (10, v_atlantic, 'Pool deck tile delamination',
         'Several tiles lifting near the aft pool coaming; area taped off as a trip hazard.',
         null, 'In Progress', m_olivia, m_sofia, false, 3, null),
    (11, v_atlantic, 'Emergency generator monthly load test',
         'Monthly 30-minute load test of the emergency generator.',
         'Ran 30 min at 75% load; all parameters normal and ATS changeover verified.',
         'Done', m_lucas, m_sofia, true, 15, null),
    (12, v_keys, 'Bow thruster vibration at 60% load',
         'Noticeable vibration and noise from the bow thruster above 60% pitch.',
         null, 'Open', m_isabella, m_daniel, false, 2, null),
    (13, v_keys, 'Starboard navigation light driver failure',
         'Starboard sidelight LED flickering; secondary lamp in use.',
         'Replaced the LED driver module; tested primary and secondary circuits.',
         'Done', m_mateo, m_daniel, false, 4, null)
  ) as d(seq, vessel_id, title, issue, solution, status, assigned_to, created_by, attested, days_ago, rejection)
  order by d.seq;

  -- Audit trail for the hand-written work orders, consistent with their state.
  insert into public.work_order_events (work_order_id, actor_id, event_type, from_status, to_status, comment, created_at)
  select e.work_order_id, e.actor_id, e.event_type::public.work_order_event_type,
         e.from_status::public.work_order_status, e.to_status::public.work_order_status,
         e.comment, e.created_at
  from (
    select w.id as work_order_id, w.created_by as actor_id, 'created' as event_type,
           null as from_status, 'Open' as to_status, null as comment, w.created_at
    from public.work_orders w
    union all
    select w.id, w.assigned_to, 'started', 'Open', 'In Progress', null, w.created_at + interval '2 hours'
    from public.work_orders w where w.status <> 'Open'
    union all
    select w.id, w.assigned_to, 'completed', 'In Progress', 'Done', null, w.created_at + interval '1 day'
    from public.work_orders w where w.rejection_count > 0
    union all
    select w.id, w.created_by, 'rejected', 'Done', 'In Progress', w.last_rejection_reason, w.created_at + interval '1 day 3 hours'
    from public.work_orders w where w.rejection_count > 0
    union all
    select w.id, w.assigned_to, 'completed', 'In Progress', 'Done', null, w.created_at + interval '2 days'
    from public.work_orders w where w.status = 'Done'
    union all
    select w.id, w.attested_by, 'attested', 'Done', 'Done', null, w.attested_at
    from public.work_orders w where w.attested_at is not null
  ) e
  order by e.created_at;

  -- Load-test vessel: 20 crew and p_load_test_orders generated work orders,
  -- spread evenly over the four states. No event history, to keep resets fast.
  -- They use their own id range (900001+), so work orders created in the demo
  -- continue the normal sequence right after the hand-written ones.
  insert into public.members (id, full_name, email, role)
  select ('b0000000-0000-4000-8000-' || lpad((200 + i)::text, 12, '0'))::uuid,
         'Atlas Crew ' || lpad(i::text, 2, '0'),
         'atlas.crew' || lpad(i::text, 2, '0') || '@fleet.test',
         'Crew'
  from generate_series(1, 20) as i;

  insert into public.vessel_assignments (vessel_id, member_id)
  select v_atlas, ('b0000000-0000-4000-8000-' || lpad((200 + i)::text, 12, '0'))::uuid
  from generate_series(1, 20) as i;

  insert into public.work_orders (
    id, vessel_id, title, issue, solution, status, assigned_to, created_by,
    attested_by, attested_at, created_at, updated_at
  )
  overriding system value
  select
    900000 + i,
    v_atlas,
    (array['Inspect', 'Service', 'Replace', 'Calibrate', 'Repair', 'Clean'])[1 + i % 6]
      || ' '
      || (array['ballast pump', 'fire damper', 'sewage plant valve', 'galley exhaust fan',
                'stern tube seal', 'corridor lighting', 'reverse-osmosis filter',
                'anchor windlass brake', 'HVAC air handler', 'fuel separator'])[1 + (i / 6) % 10]
      || ' #' || i,
    'Generated load-test work order ' || i || '.',
    case when i % 4 >= 2 then 'Generated solution for load-test work order ' || i || '.' end,
    (case i % 4 when 0 then 'Open' when 1 then 'In Progress' else 'Done' end)::public.work_order_status,
    ('b0000000-0000-4000-8000-' || lpad((201 + i % 20)::text, 12, '0'))::uuid,
    m_hannah,
    case when i % 4 = 3 then m_hannah end,
    case when i % 4 = 3 then now() - make_interval(mins => p_load_test_orders - i) end,
    now() - make_interval(mins => p_load_test_orders - i) - interval '1 day',
    now() - make_interval(mins => p_load_test_orders - i)
  from generate_series(1, greatest(p_load_test_orders, 0)) as i;

  -- Restore sessions whose member still exists and is active.
  insert into private.acting_sessions (user_id, member_id, updated_at)
  select s.user_id, s.member_id, s.updated_at
  from unnest(v_sessions) as s
  where exists (select 1 from public.members m where m.id = s.member_id and m.is_active);
end;
$$;

create or replace function public.reset_demo_data()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ready_at timestamptz;
  v_minutes  integer;
begin
  perform private.require_member('{Admin}');

  -- The single cooldown row is locked FOR UPDATE, so concurrent resets queue
  -- here and each one reads the timestamp only after the previous reset has
  -- finished. (Queued resets only hold share locks on members and sessions,
  -- which the seed clears with DELETE, so they never block the running reset.)
  select last_reset_at + interval '10 minutes' into v_ready_at
  from private.demo_resets
  where singleton
  for update;

  if clock_timestamp() < v_ready_at then
    v_minutes := ceil(extract(epoch from v_ready_at - clock_timestamp()) / 60);
    raise exception 'Demo data was reset recently. Try again in % minute%.',
      v_minutes, case when v_minutes = 1 then '' else 's' end
      using errcode = 'P0001';
  end if;

  update private.demo_resets set last_reset_at = clock_timestamp() where singleton;
  perform private.seed_demo_data();
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Explicit EXECUTE grants
-- -----------------------------------------------------------------------------
drop function public.set_member_vessels(uuid, uuid[]);

-- Start from nothing (this also removes the earlier blanket grant from any
-- platform-provided functions in this schema), then grant the app's RPCs.
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function
  -- session
  public.list_directory(),
  public.whoami(),
  public.act_as(uuid),
  -- work orders
  public.work_order_stats(uuid),
  public.create_work_order(uuid, text, text, uuid),
  public.reassign_work_order(bigint, uuid),
  public.start_work_order(bigint),
  public.save_work_order_solution(bigint, text),
  public.complete_work_order(bigint, text),
  public.attest_work_order(bigint, text),
  public.reject_work_order(bigint, text),
  -- administration
  public.create_member(text, text, public.app_role, uuid[]),
  public.update_member(uuid, text, text, public.app_role, uuid[]),
  public.set_member_active(uuid, boolean),
  public.assign_member_to_vessel(uuid, uuid),
  public.remove_member_from_vessel(uuid, uuid),
  public.create_vessel(text, text, text),
  public.update_vessel(uuid, text, text, text),
  public.set_vessel_active(uuid, boolean),
  public.reset_demo_data()
to authenticated;

-- Private helpers: only the three identity helpers that RLS policies call.
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function
  private.current_member_id(),
  private.current_member_role(),
  private.current_vessel_ids()
to authenticated;

-- Future functions in either schema start with no EXECUTE for API roles.
alter default privileges for role postgres in schema public  revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema private revoke execute on functions from public, anon, authenticated;

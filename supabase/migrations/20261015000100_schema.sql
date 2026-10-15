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

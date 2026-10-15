# FleetOps · Marine Work Order Management

A vessel-scoped work order dashboard for a cruise fleet: Admins manage users, roles, vessels and assignments; Captains create and review work orders; Crew carry them out. Every permission is enforced **inside Postgres**, not only in the UI.

- **Live demo:** https://marine-work-orders.vercel.app (no login needed)
- **Stack:** Next.js 16 (App Router) · TypeScript · Supabase (Postgres, RLS, RPC) · TanStack Query · Tailwind CSS 4 · Vercel

---

## Reviewer quick tour (5 minutes)

The sticky bar at the top is the mock login: **1 · Vessel → 2 · Role → 3 · Member**. Picking a member switches the database session to that person instantly.

> **Tip:** each browser tab is its own session. Open two tabs to watch a Captain and a Crew member side by side.

1. **Captain:** Vessel *MV Coral Meridian* → Role *Captain* → *Elena Vasquez*. Click **New work order** and assign it to *Noah Williams*. It starts as **Open**.
2. **Crew:** Role *Crew* → *Noah Williams*. Open the work order → **Start work** (In Progress) → write the solution → **Mark as Done**.
3. **Review:** back to *Elena Vasquez* (or the second captain, *Tomás Rivera*). Filter **Awaiting review** → **Reject…** (a reason is required) and the work order returns to Noah as *In Progress* with the reason shown. Repeat, then **Attest**: the record is closed and locked.
4. **Admin:** Role *Admin* → *Morgan Hale*. Under **Users**, try to deactivate *Noah Williams* while he holds active work: it is refused with a reason. Under **Vessels**, try to deactivate *MV Keys Voyager* (it has open work), and under **Users** its only captain, *Daniel Mercer*. Choose **All vessels (Admins)** in the vessel selector for a fleet-wide view.
5. **Scale:** select *MV Atlas Endurance (load test)*: 50,000 work orders, paginated and filterable without slowing down.

Changed too much? **Users → Reset demo data** (Admins) rebuilds the demo fleet, at most once every 10 minutes.

---

## Architecture

```mermaid
flowchart LR
  subgraph Browser["Browser (Next.js client components)"]
    UI[Dashboard / Admin UI] --> Q[TanStack Query cache<br/>keyed by acting member]
    Q --> SB[supabase-js<br/>publishable key only]
  end
  SB -- "anonymous session (JWT)" --> API[Supabase Data API<br/>PostgREST]
  subgraph PG["Postgres"]
    API -- "SELECT" --> RLS[Row Level Security policies]
    API -- "rpc()" --> FN[SECURITY DEFINER functions<br/>role + vessel + state checks]
    RLS --> T[(tables)]
    FN --> T
    S[(private.acting_sessions)] -.identity.-> RLS
    S -.identity.-> FN
  end
```

The assessment prefers the **browser-side Supabase client**, so there is no server layer to hide checks in. Anyone can open devtools and call the API with the public key. The design therefore assumes the client is hostile:

| Concern | Where it is enforced |
| --- | --- |
| Who is acting | The browser signs in **anonymously** (Supabase Auth, not Email Auth). `act_as(member)` records which member that anonymous user acts as in `private.acting_sessions`. Three helpers (`private.current_member_id/role/vessel_ids`) read it. |
| What you can **read** | RLS on every table. Admin: everything. Captain: their vessels. Crew: only work orders assigned to them, on vessels they still serve on. |
| What you can **write** | Nothing directly: `INSERT/UPDATE/DELETE` are revoked from API roles on every table. All changes go through `SECURITY DEFINER` functions that check role, vessel membership and current status in one transaction. |
| Data rules | `CHECK` constraints, unique indexes and foreign keys. Functions translate violations into friendly messages; the UI's zod schemas only mirror them for instant feedback. |
| Function permissions | API roles can execute only the RPCs the app calls, plus the three identity helpers RLS needs; `anon` can execute nothing. A test asserts this exact list. |
| Probing other vessels | A work order the caller may not see is reported exactly like one that does not exist (*Work order not found.*), so ids on other vessels cannot be discovered through error messages. |
| SQL injection | No dynamic SQL anywhere: PostgREST and `rpc()` parameterize every value, and every function uses `set search_path = ''` with schema-qualified names. |
| Data exposure | The member switcher calls `list_directory()`, which returns only id, name, role and vessel ids (no emails). See the limitations below: on this demo anyone can act as an Admin. |

Replacing the mock with real authentication is contained in the session layer: the identity lookups (`private.current_member_id/role/vessel_ids`, `private.require_member`, `public.whoami`) would map `auth.uid()` to a member instead of reading `private.acting_sessions`, and `act_as` / `list_directory` would go. The RLS policies and every workflow function stay the same.

### Security model and known limitations

- **Identity is self-asserted, by design.** The brief asks for a mock login, so any visitor can act as any active member, including an Admin. What a member may do is enforced by the database; *who* you are is not verified. This is not production-ready authentication.
- **Reviewers share one live database.** Admin actions (deactivating users, resetting data) affect everyone. Reset demo data has a 10-minute cooldown; concurrent requests queue on a locked row, so it cannot be bypassed.
- **Anonymous sessions.** Every browser tab signs in anonymously and creates a Supabase user; Supabase rate-limits these per IP and there is no CAPTCHA. If a stored session is rejected (revoked, tampered or expired beyond refresh), the tab starts a fresh one and acts as the same member again.
- **Concurrency.** Transitions lock the work order row; locks are always taken member rows before vessel rows, so concurrent edits and deactivations queue instead of deadlocking. A reset truncates the work-order tables, so a list loaded at that exact moment can briefly come back empty (`TRUNCATE` is not MVCC-safe); members and sessions are cleared with `DELETE`, so sessions are never affected.

---

## Data model (ERD)

```mermaid
erDiagram
  vessels ||--o{ vessel_assignments : "crewed by"
  members ||--o{ vessel_assignments : "serves on"
  vessels ||--o{ work_orders : "has"
  members ||--o{ work_orders : "assigned_to"
  members ||--o{ work_orders : "created_by"
  members |o--o{ work_orders : "attested_by"
  work_orders ||--o{ work_order_events : "history"
  members ||--o{ work_order_events : "actor"
  members ||--o{ acting_sessions : "acted as"

  vessels {
    uuid id PK
    text name UK "unique, case-insensitive"
    text imo_number UK "7 digits + check digit"
    text vessel_type
    boolean is_active
    timestamptz created_at
    timestamptz updated_at
  }
  members {
    uuid id PK
    text full_name
    text email UK "stored lower-case"
    app_role role "Admin | Captain | Crew"
    boolean is_active
    timestamptz created_at
    timestamptz updated_at
  }
  vessel_assignments {
    uuid vessel_id PK, FK
    uuid member_id PK, FK
    timestamptz assigned_at
  }
  work_orders {
    bigint id PK "shown as WO-000123"
    uuid vessel_id FK
    text title
    text issue
    text solution "optional until Done"
    work_order_status status "Open | In Progress | Done"
    uuid assigned_to FK
    uuid created_by FK
    uuid attested_by FK "null until attested"
    timestamptz attested_at
    int rejection_count
    text last_rejection_reason
    timestamptz created_at
    timestamptz updated_at
  }
  work_order_events {
    bigint id PK
    bigint work_order_id FK
    uuid actor_id FK
    work_order_event_type event_type
    work_order_status from_status
    work_order_status to_status
    text comment "required for rejections"
    timestamptz created_at
  }
  acting_sessions {
    uuid user_id PK "auth.uid() of the tab"
    uuid member_id FK
    timestamptz updated_at
  }
```

The full schema (tables, columns, types, keys, constraints, indexes, policies and functions) is in [`supabase/schema.sql`](supabase/schema.sql), generated from the ordered migrations in [`supabase/migrations`](supabase/migrations).

### Indexes

| Index | Serves |
| --- | --- |
| `work_orders (vessel_id, status, id desc)` | Captain/Admin lists: one vessel, optional status, newest first |
| `work_orders (assigned_to, status, id desc)` | Crew lists and the "has active work" guards |
| `work_orders (created_by)`, `(attested_by)` | Foreign keys |
| `vessel_assignments (vessel_id, member_id)` PK + `(member_id)` | Policy lookups in both directions |
| `members (email)` unique, `members (role) where is_active` | Duplicate prevention, switcher |
| `vessels (imo_number)` unique, `vessels (lower(name))` unique | Duplicate prevention |
| `work_order_events (work_order_id, id)`, `(actor_id)` | History timeline, foreign key |

### Work order lifecycle

```mermaid
stateDiagram-v2
  [*] --> Open: Captain creates (assigns crew on the vessel)
  Open --> InProgress: Assigned crew starts
  InProgress --> Done: Assigned crew marks Done (solution required)
  Done --> InProgress: Captain rejects (reason required)
  Done --> Attested: Captain attests
  Attested --> [*]: closed, immutable
  state "In Progress" as InProgress
  state "Done + attested" as Attested
```

Each transition locks the row (`FOR UPDATE`) and checks the current status, so double clicks, stale screens and two tabs cannot corrupt a record. Every transition is written to `work_order_events`. Callers who cannot see a work order get *Work order not found.*, the same answer as for an id that does not exist.

---

## Assumptions & decisions

The brief leaves several things open. Four principles decided most of them:

1. **Follow the brief literally where it is explicit.** Where it is open, choose the reading that would hold up on a real fleet.
2. **The database is the authority.** Every rule below is enforced in Postgres; the UI only mirrors it.
3. **A maintenance record is an audit trail.** Nothing is hard-deleted, and every step of a work order is logged with who and when.
4. **Work is never stranded.** Every active work order always has a crew member who can do it and a captain who can review it.

### Mock authentication

**How can the database enforce permissions without Email Auth?**
- **Decision:** every browser tab signs in with Supabase **anonymous sign-in**, which issues a real signed JWT without a login screen. `act_as(member)` records which member that anonymous user acts as, in `private.acting_sessions`.
- **Why:** policies need an identity the database can read on every request. With a real JWT, `auth.uid()` works in RLS and in every function, and they all read the acting member from the same server-side table.
- **Considered:** sending the chosen member's id in a request header that policies read. Rejected: every policy would trust a value the client sets on each request, and moving to real login would mean rewriting them all. With a JWT the policies already use `auth.uid()`, so real authentication later only changes how that maps to a member (see the limitations above).

**Is the session per browser or per tab?**
- **Decision:** per tab (`sessionStorage`).
- **Why:** a reviewer can watch a Captain and a Crew member side by side in two tabs, which is the quickest way to see the whole workflow.
- **Trade-off:** every new tab creates an anonymous Supabase user.

**How do the three dropdowns treat Admins, who "may view and manage all vessels"?**
- **Decision:** Admins are listed under the Admin role for every vessel, and only the Admin role offers **All vessels**. The dropdowns list active members only. Changing the vessel keeps the role and member if they are still valid there, and otherwise picks the first valid option.
- **Why:** Admins do not serve on a ship, so tying them to one vessel's list would hide them. The fleet-wide option makes "view all vessels" literal, and the dropdowns can never offer someone who could not act on the selected vessel.

### Roles and vessels

**Is a role per user or per vessel?**
- **Decision:** per user. A user's vessels are many-to-many.
- **Why:** Role Management in the brief assigns a role to a *user*, and on a fleet rank belongs to the person. Vessels are many-to-many because crew rotate between ships and a relief captain may cover several.
- **Considered:** a role per assignment (captain on one ship, crew on another). It is more flexible, but nothing in the brief needs it and it would complicate every permission check.

**Are Admins assigned to vessels?**
- **Decision:** no. Admins are fleet-wide and cannot be assigned; promoting someone to Admin removes their vessel assignments.
- **Why:** Admin is an office role that already sees the whole fleet, so a vessel assignment would add nothing and would make that vessel's roster misleading.

**What does "an available Crew member under their command" mean?**
- **Decision:** the captain must be assigned to the vessel ("their command"). The crew member must be active, have the Crew role and serve on that vessel ("available"). The same check runs when a captain reassigns work.
- **Why:** it is the literal reading, and it needs no data the brief does not define. Availability in the sense of workload or shifts would need rosters the brief never mentions.

**How many captains can a vessel have, and which of them reviews?**
- **Decision:** any number. Any active captain of the vessel can reassign, attest or reject its work orders, not only the captain who created them.
- **Why:** captains rotate and take leave. If only the creator could review, one captain going ashore would leave every Done work order on that ship stuck.

**Who sees which work orders?**
- **Decision:** Admins see everything. Captains see every work order on the vessels they command, including other captains'. Crew see only work orders assigned to them, and only while they still serve on that vessel.
- **Why:** least privilege. Captains share responsibility for the ship, so they need the full picture. Crew need only their own tasks, and removing someone from a ship removes their access to its records.

**Can Admins act on work orders?**
- **Decision:** no, they are read-only.
- **Why:** the brief gives the lifecycle to Captains and Crew only. Keeping the office out of it separates duties: if an Admin could attest, the captain's sign-off could be bypassed.

### Work order lifecycle

**The statuses must be exactly Open / In Progress / Done, but captains also "Attest". Where does attestation go?**
- **Decision:** status stays three-valued. Attestation is a separate fact on a Done record (`attested_at`, `attested_by`) that makes it final. The UI shows *Done · Awaiting review* or *Done · Attested*.
- **Why:** the brief says "strictly", so a fourth status would break an explicit rule. Attestation is a sign-off *about* finished work rather than a further stage of it, so it fits as a fact on Done. A constraint guarantees that only a Done record can be attested.

**Where does a rejected work order go?**
- **Decision:** back to **In Progress** for the same crew member. A reason of at least 5 characters is required, the crew member sees it, and every rejection stays in the history.
- **Why:** "send it back to assigned crew" names the same person, who already has the context. It returns to In Progress rather than Open because the work has started. Reasons live in the append-only `work_order_events` table, so a second rejection never overwrites the first; the latest reason is also kept on the work order for display.

**"Solution (optional until filled)": when is it required?**
- **Decision:** not when creating a work order. Crew can save a draft solution while it is In Progress, and a solution is required to mark it Done (a database constraint).
- **Why:** a captain cannot review work that has no recorded solution, so "until filled" is read as "until the work is finished".

**What should the Work Order ID look like?**
- **Decision:** a sequential number shown as `WO-000123`.
- **Why:** crews quote work order numbers in handovers, logbooks and over the radio, where a short number works and a UUID does not. The number is not a secret: visibility is enforced by RLS, and an id the caller may not see answers exactly like one that does not exist. The 50,000 load-test records use ids from 900001, so real work orders keep a short sequence.

**Can a work order be edited after it is created?**
- **Decision:** a captain can reassign it while it is Open or In Progress, and the change is logged. The title and issue are fixed. An attested work order cannot change at all.
- **Why:** the brief lists no edit operation, and keeping the original request fixed keeps the record honest: the issue as reported is what the crew answered and the captain attested. A logged, captain-only edit while Open would be the next step.

### Deactivation and data integrity

**"Prevent deactivation when it would leave an invalid assignment or active work order without an authorized owner": what counts?**
- **Decision:** an *active* work order is any not yet attested, including Done ones awaiting review. Each needs two owners: the crew member doing it and a captain who can review it. These are refused, each with the reason and the fix:
  - deactivating, re-roling or removing from a vessel a **crew member** who holds active work orders there (a captain must reassign them first);
  - doing the same to the **last active captain** of a vessel with active work orders (nobody could review them);
  - deactivating a **vessel** with active work orders;
  - deactivating or demoting the **last active Admin**, or an Admin deactivating **themselves**.
- **Why:** role changes and vessel removals end someone's authority just as deactivation does, so they run the same check.
- **Considered:** reassigning the work automatically. Rejected: it would silently make a decision that belongs to a captain.

**Can anything be deleted?**
- **Decision:** no. Users and vessels are deactivated. An inactive user's vessel assignments are kept but ignored, so reactivating restores them. A deactivated vessel leaves the selectors and its captains and crew lose access to it, while Admins keep its full history.
- **Why:** work orders point to the people who created, did and attested them, and to their ship. Deleting either would erase who did what.

**What counts as a duplicate?**
- **Decision:** users with the same email, ignoring case. Vessels with the same IMO number, or the same name ignoring case. IMO numbers must also have a valid check digit.
- **Why:** an email identifies a person. A ship keeps its IMO number for life, even when it is renamed, and the check digit catches typos. Names are unique too, so the vessel selector is never ambiguous. Required fields and formats are database constraints; the forms only mirror them for instant feedback.

### The demo environment

**Reviewers share one live database. How is it kept usable?**
- **Decision:** an Admin-only **Reset demo data** rebuilds the demo fleet, at most once every 10 minutes. Tabs acting as a seeded member stay signed in as that member after a reset.
- **Why:** one reviewer's deactivations should not spoil the next reviewer's tour, and the cooldown stops a single visitor from repeatedly wiping everyone else's work.

**What data is in the demo?**
- **Decision:** a small fleet with fictional names, `.test` email addresses and fictional IMO numbers, plus a load-test vessel with 50,000 work orders.
- **Why:** there is no real personal data (`.test` is a reserved domain, so no mail can reach anyone), and the load-test vessel backs the performance claims with measured numbers.

---

## Performance & scalability

- **Server-side everything:** filtering, search, counting and pagination run in Postgres (`range()` + `count: exact`); the browser never loads more than one page (25 rows).
- **Index-backed queries** for every list and guard (see above), plus the load-test vessel with **50,000 work orders** (ids `WO-900001`+) to prove it.
- **Measured** with `EXPLAIN ANALYZE` on the free-tier database, running under RLS as the real role (best of 3):

  | Query | Time |
  | --- | --- |
  | First page, all vessels (Admin) | 0.4 ms |
  | First page, one vessel filtered by status (Captain) | 1.0 ms |
  | First page of a crew member's own work orders | 1.5 ms |
  | Exact count over 50,000 rows | 12–20 ms |
  | Dashboard counters (`work_order_stats`) | 14–23 ms |
  | Page 1,000 (offset 25,000) | 34–38 ms |

  In the browser, each request took 110–190 ms end to end, mostly network latency, measured from Southeast Asia to the Tokyo-hosted database; expect more from other regions.
- **Title search** is an `ILIKE` filter over the rows the caller may see (~80 ms across all 50,000). A trigram index would not help: under RLS Postgres only uses an index for *leakproof* operators, and `ILIKE` is not one. At larger scale the next step is a search function that applies the same vessel checks explicitly, plus keyset pagination for very deep pages.
- **RLS written for speed:** helper calls are wrapped as `(select private.current_member_role())` so Postgres evaluates them once per query (an InitPlan) instead of once per row; membership checks use hashed `IN (subquery)` lookups.
- **Client cache:** TanStack Query, keyed by acting member, so switching members never shows another member's data and switching back is instant. Previous page stays on screen while the next one loads.
- **Small payloads:** list queries select only the columns they render; the detail sheet loads the full record and history on demand.

---

## Testing

The database is the security boundary, so it is tested directly. Every test runs as a simulated browser session (JWT claims + the `authenticated` role, exactly what PostgREST does) inside a transaction that is **rolled back**, so the live data is untouched.

```bash
npm run test:db
```

**36 tests:** `rls.test.mjs` (11), `work-orders.test.mjs` (10), `admin.test.mjs` (10), `hardening.test.mjs` (5).

Coverage includes: anonymous requests are refused everything; RLS visibility per role (crew only their own, captains only their vessels, admins everything, history follows its work order); direct table writes refused for every role including Admin; the private schema is closed; the exact set of functions API roles may execute; the full lifecycle including reject → redo → attest by a second captain; every wrong turn (wrong role, wrong vessel, wrong crew, skipping a status, missing solution, missing rejection reason, editing an attested record); hidden work orders answering exactly like missing ones; reassignment moving visibility; validation and case-insensitive duplicates; IMO check digits; every deactivation/removal/role-change guard; last-Admin protection; the reset cooldown; and, on two real connections, lock ordering and the absence of the create-versus-deactivate deadlock.

> **Run the suite against a development project, not production.** Data changes are rolled back, but tests still use up work-order ID numbers, and the cooldown and concurrency tests briefly hold locks on the demo tables. The concurrency tests need a real Postgres server with several connections (any Supabase project qualifies).

---

## Running locally

Requirements: Node 22+ and a Supabase project (the free tier is fine).

1. In the Supabase dashboard: **Authentication → Sign In / Providers → enable "Allow anonymous sign-ins"**.
2. `cp .env.example .env.local` and fill in the project URL, publishable key and the **Session pooler** connection string (Connect → Connection string).
3. Install, apply the schema, seed and test:

```bash
npm install
npm run db:push     # apply supabase/migrations
npm run db:seed     # demo fleet + 50,000 load-test work orders
npm run test:db     # database permission + workflow tests (development project only)
npm run typecheck   # generates Next.js route types, then runs tsc
npm run dev
```

`DATABASE_URL` is only used by these local scripts. The deployed app needs just `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (both public by design), plus `CRON_SECRET` for the daily keep-alive job.

## Deployment

Vercel production deployment (`vercel deploy --prod`) of the `master` branch, served at https://marine-work-orders.vercel.app. The database is a Supabase project on the free tier. A daily Vercel Cron (`/api/keep-alive`, protected by `CRON_SECRET`) makes one authenticated query so the project is never paused for inactivity while the submission is being reviewed.

## Project structure

```
supabase/
  migrations/      ordered SQL: schema → access control → RPCs → demo data → privileges → hardening
  schema.sql       generated single-file schema (npm run db:schema)
  seed.sql         select private.seed_demo_data(50000);
tests/db/          node:test suites run against the real database (rolled back)
scripts/db.mjs     push / seed / types / schema helpers (never prints secrets)
src/
  app/             routes: / (work orders), /admin/users, /admin/vessels, /api/keep-alive
  components/
    session/       mock auth: provider, the three-dropdown utility bar, gates
    work-orders/   dashboard, list, create dialog, detail sheet with role actions
    admin/         users, vessels, roster and their dialogs
    ui/            small accessible primitives (button, form, dialog, badges…)
  lib/
    api/           typed data access: one function per query or RPC
    hooks/         TanStack Query hooks and the shared mutation hook
    supabase/      browser client + generated database types
    session-rules.ts  pure rules for the dependent dropdowns
    validation.ts  zod schemas mirroring the database constraints
```

## What I would do next

- Supabase Realtime on `work_orders` so a captain sees crew updates without refocusing the tab.
- Database tests in CI against a disposable database, plus Playwright end-to-end tests for the main flows (the current suite covers the database, which is the security boundary).
- Real authentication (Supabase Auth with SSO) replacing the anonymous-session bridge; only the identity lookups described above change.
- Keyset pagination for very deep pages, and a search function that applies the vessel checks explicitly so title search can use an index.

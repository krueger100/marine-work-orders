// Row Level Security and privilege tests: who can see and touch what.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { asSession, createPool, M, V } from './helpers.mjs';

const pool = createPool();
after(() => pool.end());

const TABLES = [
  'public.vessels',
  'public.members',
  'public.vessel_assignments',
  'public.work_orders',
  'public.work_order_events',
];

test('a request without a session can read nothing and call nothing', () =>
  asSession(pool, 'anon', async (s) => {
    for (const table of TABLES) await s.fails(`select * from ${table}`, [], /permission denied/);
    await s.fails('select public.list_directory()', [], /permission denied/);
    await s.fails('select public.act_as($1)', [M.morgan], /permission denied/);
  }));

test('signed in without a member: the directory works, every table is empty', () =>
  asSession(pool, null, async (s) => {
    const { list_directory: dir } = await s.one('select public.list_directory()');
    assert.ok(dir.vessels.length >= 5);
    assert.ok(dir.members.every((m) => !('email' in m)), 'directory must not expose emails');
    assert.ok(!dir.vessels.some((v) => v.id === V.harbor), 'inactive vessels are hidden');
    assert.ok(!dir.members.some((m) => m.id === M.grace), 'inactive members are hidden');
    for (const table of TABLES) assert.equal(await s.count(table), 0, table);
  }));

test('acting as an inactive member is refused', () =>
  asSession(pool, null, (s) => s.fails('select public.act_as($1)', [M.grace], /inactive/)));

test('crew see only work orders assigned to them', () =>
  asSession(pool, M.ava, async (s) => {
    const rows = await s.rows('select assigned_to from public.work_orders');
    assert.ok(rows.length > 0);
    assert.ok(rows.every((r) => r.assigned_to === M.ava));
  }));

test('crew serving on two vessels see their work on both', () =>
  asSession(pool, M.liam, async (s) => {
    const vessels = (await s.rows('select distinct vessel_id from public.work_orders order by 1')).map((r) => r.vessel_id);
    assert.deepEqual(vessels, [V.coral, V.biscayne].sort());
  }));

test('captains see every work order on their vessel and nothing elsewhere', () =>
  asSession(pool, M.elena, async (s) => {
    const vessels = (await s.rows('select distinct vessel_id from public.work_orders')).map((r) => r.vessel_id);
    assert.deepEqual(vessels, [V.coral]);
    assert.ok((await s.count('public.work_orders')) >= 5);
    assert.deepEqual((await s.rows('select id from public.vessels')).map((r) => r.id), [V.coral]);
  }));

test('non-admins only see their shipmates', () =>
  asSession(pool, M.mateo, async (s) => {
    const ids = (await s.rows('select id from public.members')).map((r) => r.id);
    assert.ok(ids.includes(M.daniel) && ids.includes(M.mateo));
    assert.ok(!ids.includes(M.elena), 'a captain of another vessel is not visible');
    assert.ok(!ids.includes(M.morgan), 'admins are not shipmates');
  }));

test('admins see the whole fleet, including inactive vessels and members', () =>
  asSession(pool, M.morgan, async (s) => {
    assert.ok((await s.count('public.vessels', 'id = $1', [V.harbor])) === 1);
    assert.ok((await s.count('public.members', 'id = $1', [M.grace])) === 1);
    assert.ok((await s.count('public.work_orders', 'vessel_id <> $1', [V.coral])) > 0);
  }));

test('history is visible exactly when its work order is', () =>
  asSession(pool, M.ava, async (s) => {
    const hidden = await s.count(
      'public.work_order_events e',
      'not exists (select 1 from public.work_orders w where w.id = e.work_order_id)',
    );
    assert.equal(hidden, 0);
    assert.ok((await s.count('public.work_order_events')) > 0);
  }));

test('direct table writes are rejected for every role, even Admin', async () => {
  for (const member of [M.morgan, M.elena, M.ava]) {
    await asSession(pool, member, async (s) => {
      await s.fails("update public.work_orders set status = 'Done'", [], /permission denied/);
      await s.fails("update public.members set role = 'Admin'", [], /permission denied/);
      await s.fails(
        "insert into public.vessels (name, imo_number, vessel_type) values ('MV X', '1234567', 'Tender')",
        [],
        /permission denied/,
      );
      await s.fails('delete from public.work_order_events', [], /permission denied/);
    });
  }
});

test('the private schema is closed to API roles', () =>
  asSession(pool, M.morgan, async (s) => {
    await s.fails('select * from private.acting_sessions', [], /permission denied/);
    await s.fails('select private.seed_demo_data(0)', [], /permission denied/);
    await s.fails('select private.require_member()', [], /permission denied/);
  }));

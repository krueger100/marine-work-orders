// Hardening tests: uniform "not found", the reset cooldown, exact function
// permissions and lock ordering. Everything is rolled back; the two concurrency
// tests briefly hold row locks on a second connection but never commit.
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { asSession, createPool, M, V } from './helpers.mjs';

const pool = createPool();
after(() => pool.end());

const ATLAS_WORK_ORDER = 900004; // a generated load-test work order on MV Atlas Endurance

test('work orders the caller cannot see are indistinguishable from missing ones', () =>
  asSession(pool, M.noah, async (s) => {
    const messageFor = async (sql, params) => (await s.fails(sql, params)).message;

    const missing = await messageFor('select public.start_work_order($1)', [-1]);
    const otherVessel = await messageFor('select public.start_work_order($1)', [ATLAS_WORK_ORDER]);
    assert.equal(missing, 'Work order not found.');
    assert.equal(otherVessel, missing, 'another vessel’s work order must look missing');

    await s.actAs(M.elena); // Coral captain
    assert.equal(await messageFor('select public.attest_work_order($1)', [ATLAS_WORK_ORDER]), missing);
    assert.equal(await messageFor('select public.reassign_work_order($1, $2)', [ATLAS_WORK_ORDER, M.noah]), missing);
  }));

test('reset demo data has a 10-minute cooldown', () =>
  asSession(pool, M.morgan, async (s) => {
    const setLastReset = async (sqlInterval) => {
      await s.client.query('reset role'); // owner-only setup inside the rolled-back transaction
      await s.client.query(`update private.demo_resets set last_reset_at = ${sqlInterval}`);
      await s.client.query('set local role authenticated');
    };

    await setLastReset("'-infinity'");
    await s.rows('select public.reset_demo_data()');
    await s.fails('select public.reset_demo_data()', [], /Try again in 10 minutes\./);

    await setLastReset("now() - interval '9 minutes 30 seconds'");
    await s.fails('select public.reset_demo_data()', [], /Try again in 1 minute\./);

    await setLastReset("now() - interval '11 minutes'");
    await s.rows('select public.reset_demo_data()');
  }));

test('API roles can execute exactly the functions the app calls', async () => {
  const { rows } = await pool.query(`
    select n.nspname || '.' || p.proname as fn,
           has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')`);

  assert.deepEqual(rows.filter((r) => r.anon).map((r) => r.fn), [], 'anon must not execute anything');
  assert.deepEqual(
    rows.filter((r) => r.authenticated).map((r) => r.fn).sort(),
    [
      'private.current_member_id',
      'private.current_member_role',
      'private.current_vessel_ids',
      'public.act_as',
      'public.assign_member_to_vessel',
      'public.attest_work_order',
      'public.complete_work_order',
      'public.create_member',
      'public.create_vessel',
      'public.create_work_order',
      'public.list_directory',
      'public.reassign_work_order',
      'public.reject_work_order',
      'public.remove_member_from_vessel',
      'public.reset_demo_data',
      'public.save_work_order_solution',
      'public.set_member_active',
      'public.set_vessel_active',
      'public.start_work_order',
      'public.update_member',
      'public.update_vessel',
      'public.whoami',
      'public.work_order_stats',
    ],
  );
});

// --- Concurrency (two connections, nothing committed) --------------------------

async function openSession(memberId, preLock) {
  const client = await pool.connect();
  await client.query('begin');
  if (preLock) await client.query(preLock.sql, preLock.params); // as the owner, before the role switch
  const claims = JSON.stringify({ sub: randomUUID(), role: 'authenticated' });
  await client.query("select set_config('request.jwt.claims', $1, true)", [claims]);
  await client.query('set local role authenticated');
  await client.query('select public.act_as($1)', [memberId]);
  return client;
}

async function close(...clients) {
  for (const client of clients) {
    await client.query('rollback').catch(() => {});
    client.release();
  }
}

const settle = (promise) => promise.then(() => ({ ok: true }), (error) => ({ ok: false, code: error.code }));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('create_work_order locks the crew member before the vessel', async () => {
  const holder = await pool.connect();
  const captain = await openSession(M.elena);
  try {
    await holder.query('begin');
    await holder.query('select 1 from public.vessels where id = $1 for no key update', [V.coral]);

    const create = settle(
      captain.query('select public.create_work_order($1, $2, $3, $4)', [V.coral, 'Lock order', 'Issue text', M.noah]),
    );
    await sleep(300); // now waiting for the vessel

    const probe = await settle(pool.query('select 1 from public.members where id = $1 for update nowait', [M.noah]));
    assert.equal(probe.code, '55P03', 'the crew member must already be locked while the vessel is awaited');

    await holder.query('rollback');
    assert.equal((await create).ok, true);
  } finally {
    await close(holder, captain);
  }
});

test('creating a work order and deactivating its crew member at once never deadlock', async () => {
  // The admin's transaction locks Noah first, as set_member_active does.
  const admin = await openSession(M.morgan, {
    sql: 'select 1 from public.members where id = $1 for update',
    params: [M.noah],
  });
  const captain = await openSession(M.elena);
  try {
    const create = settle(
      captain.query('select public.create_work_order($1, $2, $3, $4)', [V.coral, 'Deadlock probe', 'Issue text', M.noah]),
    );
    await sleep(300); // the captain now waits for Noah
    const deactivate = settle(admin.query('select public.set_member_active($1, false)', [M.noah]));
    const adminResult = await deactivate; // must finish (Noah's open work refuses it) instead of deadlocking
    await admin.query('rollback');
    const captainResult = await create;
    assert.notEqual(adminResult.code, '40P01');
    assert.notEqual(captainResult.code, '40P01');
    assert.equal(captainResult.ok, true);
  } finally {
    await close(admin, captain);
  }
});

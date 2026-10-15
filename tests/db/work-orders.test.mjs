// Work order lifecycle tests: every transition, every role, every wrong turn.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { asSession, createPool, M, V } from './helpers.mjs';

const pool = createPool();
after(() => pool.end());

async function createWorkOrder(s, { vessel = V.coral, assignee = M.noah } = {}) {
  const { id } = await s.one('select public.create_work_order($1, $2, $3, $4) as id', [
    vessel,
    'Test: fuel transfer pump low pressure',
    'Discharge pressure drops to 1.2 bar under load.',
    assignee,
  ]);
  return id;
}

const workOrder = (s, id) => s.one('select * from public.work_orders where id = $1', [id]);

test('full lifecycle: create, start, complete, reject, complete, attest', () =>
  asSession(pool, M.elena, async (s) => {
    const id = await createWorkOrder(s);
    let wo = await workOrder(s, id);
    assert.equal(wo.status, 'Open');
    assert.equal(wo.created_by, M.elena);

    await s.actAs(M.noah);
    await s.rows('select public.start_work_order($1)', [id]);
    await s.rows('select public.complete_work_order($1, $2)', [id, 'Replaced the relief valve spring.']);
    assert.equal((await workOrder(s, id)).status, 'Done');

    await s.actAs(M.elena);
    await s.fails('select public.reject_work_order($1, $2)', [id, '  '], /rejection reason/);
    await s.rows('select public.reject_work_order($1, $2)', [id, 'Attach the pressure test log.']);
    wo = await workOrder(s, id);
    assert.equal(wo.status, 'In Progress');
    assert.equal(wo.rejection_count, 1);
    assert.equal(wo.last_rejection_reason, 'Attach the pressure test log.');

    await s.actAs(M.noah);
    await s.rows('select public.complete_work_order($1, $2)', [id, 'Valve replaced; test log attached.']);

    // Any captain of the vessel may review, not only the creator.
    await s.actAs(M.tomas);
    await s.rows('select public.attest_work_order($1)', [id]);
    wo = await workOrder(s, id);
    assert.equal(wo.status, 'Done');
    assert.equal(wo.attested_by, M.tomas);
    assert.ok(wo.attested_at);

    // Attested records are final.
    await s.fails('select public.reject_work_order($1, $2)', [id, 'Changed my mind.'], /attested and closed/);
    await s.fails('select public.reassign_work_order($1, $2)', [id, M.ava], /attested and closed/);
    await s.actAs(M.noah);
    await s.fails('select public.save_work_order_solution($1, $2)', [id, 'edit'], /attested and closed/);

    const events = (
      await s.rows('select event_type from public.work_order_events where work_order_id = $1 order by id', [id])
    ).map((e) => e.event_type);
    assert.deepEqual(events, ['created', 'started', 'completed', 'rejected', 'completed', 'attested']);
  }));

test('captains can only create work orders on vessels they command', () =>
  asSession(pool, M.elena, (s) =>
    s.fails('select public.create_work_order($1, $2, $3, $4)', [V.biscayne, 'Title', 'Issue text', M.mia], /vessels you command/),
  ));

test('work orders can only be assigned to active crew on the same vessel', () =>
  asSession(pool, M.elena, async (s) => {
    for (const assignee of [M.mia /* other vessel */, M.tomas /* a captain */, M.grace /* inactive */]) {
      await s.fails(
        'select public.create_work_order($1, $2, $3, $4)',
        [V.coral, 'Title', 'Issue text', assignee],
        /active crew serving on this vessel/,
      );
    }
    assert.ok(await createWorkOrder(s, { assignee: M.liam })); // Liam serves on Coral (and Biscayne)
  }));

test('only Captains create work orders', async () => {
  for (const member of [M.noah, M.morgan]) {
    await asSession(pool, member, (s) =>
      s.fails('select public.create_work_order($1, $2, $3, $4)', [V.coral, 'Title', 'Issue text', M.noah], /requires the Captain role/),
    );
  }
});

test('validation: title and issue are required', () =>
  asSession(pool, M.elena, async (s) => {
    await s.fails('select public.create_work_order($1, $2, $3, $4)', [V.coral, '  ', 'Issue text', M.noah], /Title must be/);
    await s.fails('select public.create_work_order($1, $2, $3, $4)', [V.coral, 'Title', null, M.noah], /Issue is required/);
  }));

test('only the assigned crew member can work a work order', () =>
  asSession(pool, M.elena, async (s) => {
    const id = await createWorkOrder(s, { assignee: M.noah });
    for (const other of [M.ava, M.liam]) {
      await s.actAs(other);
      await s.fails('select public.start_work_order($1)', [id], /Only the crew member assigned/);
    }
    await s.actAs(M.elena);
    await s.fails('select public.start_work_order($1)', [id], /requires the Crew role/);
  }));

test('crew cannot skip In Progress or finish without a solution', () =>
  asSession(pool, M.elena, async (s) => {
    const id = await createWorkOrder(s);
    await s.actAs(M.noah);
    await s.fails('select public.complete_work_order($1, $2)', [id, 'Done it'], /currently Open/);
    await s.rows('select public.start_work_order($1)', [id]);
    await s.fails('select public.start_work_order($1)', [id], /currently In Progress/);
    await s.fails('select public.complete_work_order($1, $2)', [id, '   '], /Document the solution/);
    await s.rows('select public.save_work_order_solution($1, $2)', [id, 'Draft notes']);
    assert.equal((await workOrder(s, id)).solution, 'Draft notes');
  }));

test('reviews: only Done work orders, only captains of that vessel', () =>
  asSession(pool, M.elena, async (s) => {
    const id = await createWorkOrder(s);
    await s.fails('select public.attest_work_order($1)', [id], /currently Open/);
    await s.actAs(M.noah);
    await s.rows('select public.start_work_order($1)', [id]);
    await s.rows('select public.complete_work_order($1, $2)', [id, 'Fixed']);
    await s.fails('select public.attest_work_order($1)', [id], /requires the Captain role/);
    await s.actAs(M.james); // captain of Biscayne, not Coral
    await s.fails('select public.attest_work_order($1)', [id], /Only a captain of this vessel/);
  }));

test('reassigning moves visibility to the new crew member', () =>
  asSession(pool, M.elena, async (s) => {
    const id = await createWorkOrder(s, { assignee: M.noah });
    await s.fails('select public.reassign_work_order($1, $2)', [id, M.mia], /active crew serving on this vessel/);
    await s.rows('select public.reassign_work_order($1, $2)', [id, M.ava]);
    assert.equal((await workOrder(s, id)).assigned_to, M.ava);

    await s.actAs(M.noah);
    assert.equal(await s.count('public.work_orders', 'id = $1', [id]), 0);
    await s.actAs(M.ava);
    assert.equal(await s.count('public.work_orders', 'id = $1', [id]), 1);
  }));

test('dashboard stats only count what the caller can see', () =>
  asSession(pool, M.ava, async (s) => {
    const { stats } = await s.one('select public.work_order_stats() as stats');
    assert.equal(stats.total, await s.count('public.work_orders'));
    assert.equal(stats.total, stats.open + stats.in_progress + stats.awaiting_review + stats.attested);
  }));

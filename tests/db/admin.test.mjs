// Admin management tests: validation, duplicates, role rules and the
// "never leave work without an authorized owner" guards.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { asSession, createPool, M, V } from './helpers.mjs';

const pool = createPool();
after(() => pool.end());

async function createMember(s, { name = 'Zoe Park', email = 'zoe.park@fleet.test', role = 'Crew', vessels = [] } = {}) {
  const { id } = await s.one('select public.create_member($1, $2, $3, $4) as id', [name, email, role, vessels]);
  return id;
}

async function createWorkOrder(s, captain, vessel, assignee) {
  await s.actAs(captain);
  const { id } = await s.one('select public.create_work_order($1, $2, $3, $4) as id', [
    vessel,
    'Guard test',
    'Work that needs an owner.',
    assignee,
  ]);
  await s.actAs(M.morgan);
  return id;
}

const vesselIdsOf = async (s, memberId) =>
  (await s.rows('select vessel_id from public.vessel_assignments where member_id = $1 order by 1', [memberId])).map(
    (r) => r.vessel_id,
  );

test('only Admins can call the management functions', () =>
  asSession(pool, M.elena, async (s) => {
    const denied = /requires the Admin role/;
    await s.fails('select public.create_member($1, $2, $3)', ['A B', 'a@b.test', 'Crew'], denied);
    await s.fails('select public.update_member($1, $2, $3, $4)', [M.noah, 'Noah', 'noah@x.test', 'Captain'], denied);
    await s.fails('select public.set_member_active($1, false)', [M.noah], denied);
    await s.fails('select public.set_member_vessels($1, $2)', [M.noah, [V.coral]], denied);
    await s.fails('select public.create_vessel($1, $2, $3)', ['MV X', '1234567', 'Tender'], denied);
    await s.fails('select public.set_vessel_active($1, false)', [V.keys], denied);
    await s.fails('select public.reset_demo_data()', [], denied);
  }));

test('users: required fields, email format, case-insensitive duplicates', () =>
  asSession(pool, M.morgan, async (s) => {
    const id = await createMember(s, { email: '  Zoe.Park@Fleet.TEST ' });
    assert.equal((await s.one('select email from public.members where id = $1', [id])).email, 'zoe.park@fleet.test');

    const create = 'select public.create_member($1, $2, $3)';
    await s.fails(create, ['Zoe Again', 'ZOE.PARK@fleet.test', 'Crew'], /already exists/);
    await s.fails(create, ['Liam Chen', 'liam.chen@fleet.test', 'Crew'], /already exists/);
    await s.fails(create, ['No At Sign', 'not-an-email', 'Crew'], /valid email/);
    await s.fails(create, [' ', 'blank@fleet.test', 'Crew'], /Full name must be/);
    await s.fails(create, ['No Role', 'norole@fleet.test', null], /Role is required/);
    await s.fails(create, ['Bad Role', 'badrole@fleet.test', 'Bosun'], /invalid input value for enum/);
  }));

test('vessels: IMO check digit, duplicate IMO and duplicate name', () =>
  asSession(pool, M.morgan, async (s) => {
    const create = 'select public.create_vessel($1, $2, $3)';
    await s.fails(create, ['MV Typo', '1234568', 'Tender'], /check digit/);
    await s.fails(create, ['MV Copy', '9387425', 'Tender'], /IMO number already exists/);
    await s.fails(create, ['mv coral MERIDIAN', '1234567', 'Tender'], /name already exists/);
    await s.fails(create, ['MV No Type', '1234567', ''], /Vessel type must be/);
    const { id } = await s.one('select public.create_vessel($1, $2, $3) as id', ['MV Test Tender', '1234567', 'Tender']);
    await s.rows('select public.update_vessel($1, $2, $3, $4)', [id, 'MV Test Tender II', '1234567', 'Tender']);
    assert.equal((await s.one('select name from public.vessels where id = $1', [id])).name, 'MV Test Tender II');
  }));

test('crew holding active work orders cannot be deactivated, re-roled or removed', () =>
  asSession(pool, M.morgan, async (s) => {
    const zoe = await createMember(s, { vessels: [V.coral] });
    const wo = await createWorkOrder(s, M.elena, V.coral, zoe);

    await s.fails('select public.set_member_active($1, false)', [zoe], /Cannot deactivate Zoe Park: they still hold 1 active work order\./);
    await s.fails(
      'select public.update_member($1, $2, $3, $4)',
      [zoe, 'Zoe Park', 'zoe.park@fleet.test', 'Captain'],
      /Cannot change the role of Zoe Park: they still hold 1 active/,
    );
    await s.fails('select public.remove_member_from_vessel($1, $2)', [zoe, V.coral], /Cannot remove Zoe Park from this vessel/);
    await s.fails('select public.set_member_vessels($1, $2)', [zoe, []], /still hold 1 active/);

    // Once a captain reassigns the work, the member can be released.
    await s.actAs(M.elena);
    await s.rows('select public.reassign_work_order($1, $2)', [wo, M.ava]);
    await s.actAs(M.morgan);
    await s.rows('select public.set_member_active($1, false)', [zoe]);
    await s.fails('select public.act_as($1)', [zoe], /inactive/);
  }));

test('the last captain of a vessel with active work cannot leave it', () =>
  asSession(pool, M.morgan, async (s) => {
    await createWorkOrder(s, M.daniel, V.keys, M.mateo); // Keys has a single captain
    await s.fails(
      'select public.set_member_active($1, false)',
      [M.daniel],
      /Cannot deactivate Daniel Mercer: they are the only active captain of MV Keys Voyager/,
    );
    await s.fails('select public.remove_member_from_vessel($1, $2)', [M.daniel, V.keys], /only active captain/);

    const relief = await createMember(s, { name: 'Ruth Bell', email: 'ruth.bell@fleet.test', role: 'Captain', vessels: [V.keys] });
    assert.ok(relief);
    await s.rows('select public.set_member_active($1, false)', [M.daniel]);
  }));

test('a vessel with two captains can lose one', () =>
  asSession(pool, M.morgan, (s) => s.rows('select public.set_member_active($1, false)', [M.tomas])));

test('at least one Admin remains, and Admins cannot deactivate themselves', () =>
  asSession(pool, M.morgan, async (s) => {
    await s.fails('select public.set_member_active($1, false)', [M.morgan], /deactivate yourself/);
    await s.rows('select public.update_member($1, $2, $3, $4)', [M.priya, 'Priya Raman', 'priya.raman@fleet.test', 'Crew']);
    await s.fails(
      'select public.update_member($1, $2, $3, $4)',
      [M.morgan, 'Morgan Hale', 'morgan.hale@fleet.test', 'Captain'],
      /At least one active Admin/,
    );
  }));

test('Admins are fleet-wide: promotion clears assignments, assignment is refused', () =>
  asSession(pool, M.morgan, async (s) => {
    const zoe = await createMember(s, { vessels: [V.coral, V.biscayne] });
    await s.rows('select public.update_member($1, $2, $3, $4)', [zoe, 'Zoe Park', 'zoe.park@fleet.test', 'Admin']);
    assert.deepEqual(await vesselIdsOf(s, zoe), []);
    await s.fails('select public.assign_member_to_vessel($1, $2)', [zoe, V.coral], /fleet-wide/);
  }));

test('vessel assignments: assign, move and remove', () =>
  asSession(pool, M.morgan, async (s) => {
    const zoe = await createMember(s, { vessels: [V.coral] });
    await s.rows('select public.set_member_vessels($1, $2)', [zoe, [V.biscayne, V.keys]]);
    assert.deepEqual(await vesselIdsOf(s, zoe), [V.biscayne, V.keys].sort());
    await s.rows('select public.remove_member_from_vessel($1, $2)', [zoe, V.keys]);
    assert.deepEqual(await vesselIdsOf(s, zoe), [V.biscayne]);
    await s.fails('select public.assign_member_to_vessel($1, $2)', [zoe, V.harbor], /inactive/);
  }));

test('a vessel with active work orders cannot be deactivated', () =>
  asSession(pool, M.morgan, async (s) => {
    await createWorkOrder(s, M.elena, V.coral, M.noah);
    await s.fails('select public.set_vessel_active($1, false)', [V.coral], /must be attested first/);
    await s.rows('select public.set_vessel_active($1, true)', [V.harbor]);
    await s.rows('select public.set_vessel_active($1, false)', [V.harbor]);
  }));

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

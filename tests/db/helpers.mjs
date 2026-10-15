// Test harness for the database rules. Every test runs inside a transaction
// that is rolled back, so the live demo data is never changed.
//
// A "session" mimics exactly what PostgREST does for a browser request: it sets
// the JWT claims of a (fake) anonymous user and switches to the `authenticated`
// role, so RLS and function privileges apply just as they do in production.
import { randomUUID } from 'node:crypto';
import pg from 'pg';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set. Run with: node --env-file=.env.local --test tests/db');
}

// Fixed ids from private.seed_demo_data().
export const V = {
  coral: 'a0000000-0000-4000-8000-000000000001',
  biscayne: 'a0000000-0000-4000-8000-000000000002',
  atlantic: 'a0000000-0000-4000-8000-000000000003',
  keys: 'a0000000-0000-4000-8000-000000000004',
  atlas: 'a0000000-0000-4000-8000-000000000005',
  harbor: 'a0000000-0000-4000-8000-000000000006', // inactive
};

export const M = {
  morgan: 'b0000000-0000-4000-8000-000000000001', // Admin
  priya: 'b0000000-0000-4000-8000-000000000002', // Admin
  elena: 'b0000000-0000-4000-8000-000000000011', // Captain, Coral
  tomas: 'b0000000-0000-4000-8000-000000000012', // Captain, Coral
  james: 'b0000000-0000-4000-8000-000000000013', // Captain, Biscayne
  sofia: 'b0000000-0000-4000-8000-000000000014', // Captain, Atlantic
  daniel: 'b0000000-0000-4000-8000-000000000015', // Captain, Keys
  liam: 'b0000000-0000-4000-8000-000000000101', // Crew, Coral + Biscayne
  ava: 'b0000000-0000-4000-8000-000000000102', // Crew, Coral
  noah: 'b0000000-0000-4000-8000-000000000103', // Crew, Coral
  mia: 'b0000000-0000-4000-8000-000000000104', // Crew, Biscayne
  ethan: 'b0000000-0000-4000-8000-000000000105', // Crew, Biscayne
  olivia: 'b0000000-0000-4000-8000-000000000106', // Crew, Atlantic
  mateo: 'b0000000-0000-4000-8000-000000000109', // Crew, Keys
  grace: 'b0000000-0000-4000-8000-000000000110', // Crew, inactive
};

export function createPool() {
  return new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    // Supabase's pooler presents its own CA; this harness only runs locally.
    ssl: { rejectUnauthorized: false },
    max: 4,
  });
}

/**
 * Runs `fn` as a browser session that is acting as `memberId`
 * (null = signed in but no member selected; 'anon' = not signed in at all).
 * Everything is rolled back afterwards.
 */
export async function asSession(pool, memberId, fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    if (memberId === 'anon') {
      await client.query("select set_config('request.jwt.claims', '{\"role\":\"anon\"}', true)");
      await client.query('set local role anon');
    } else {
      const claims = JSON.stringify({ sub: randomUUID(), role: 'authenticated', is_anonymous: true });
      await client.query("select set_config('request.jwt.claims', $1, true)", [claims]);
      await client.query('set local role authenticated');
      if (memberId) await client.query('select public.act_as($1)', [memberId]);
    }
    return await fn(new Session(client));
  } finally {
    await client.query('rollback').catch(() => {});
    client.release();
  }
}

class Session {
  constructor(client) {
    this.client = client;
  }

  async rows(sql, params = []) {
    return (await this.client.query(sql, params)).rows;
  }

  async one(sql, params = []) {
    const rows = await this.rows(sql, params);
    if (rows.length !== 1) throw new Error(`Expected 1 row, got ${rows.length}`);
    return rows[0];
  }

  async count(table, where = 'true', params = []) {
    const { n } = await this.one(`select count(*)::int as n from ${table} where ${where}`, params);
    return n;
  }

  /** Expects the statement to fail; returns the error. Uses a savepoint so the session continues. */
  async fails(sql, params = [], messagePattern) {
    await this.client.query('savepoint expect_failure');
    try {
      await this.client.query(sql, params);
    } catch (error) {
      await this.client.query('rollback to savepoint expect_failure');
      if (messagePattern && !messagePattern.test(error.message)) {
        throw new Error(`Failed with an unexpected message: "${error.message}" (wanted ${messagePattern})`);
      }
      return error;
    }
    throw new Error(`Expected failure but it succeeded: ${sql}`);
  }

  /** Switch the acting member mid-transaction (the member switcher). */
  async actAs(memberId) {
    await this.client.query('select public.act_as($1)', [memberId]);
  }
}

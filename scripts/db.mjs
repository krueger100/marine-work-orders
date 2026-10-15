// Local database tooling. Reads DATABASE_URL from .env.local via
// `node --env-file`; the URL (which contains the password) is never printed.
//
//   npm run db:push    apply supabase/migrations to the database
//   npm run db:seed    rebuild the demo fleet + load-test data (supabase/seed.sql)
//   npm run db:types   regenerate src/lib/supabase/database.types.ts
//   npm run db:schema  rebuild supabase/schema.sql from the migrations
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function requireDatabaseUrl() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is missing. Copy .env.example to .env.local and fill it in.');
    process.exit(1);
  }
  return url;
}

function supabaseCli(args, { captureStdout = false } = {}) {
  // Run the CLI's JS entry point directly (no shell), so the URL is never
  // interpolated into a command line string. "y" answers the push prompt.
  const entry = path.join(root, 'node_modules', 'supabase', 'dist', 'supabase.js');
  const result = spawnSync(process.execPath, [entry, ...args], {
    cwd: root,
    input: 'y\n',
    stdio: ['pipe', captureStdout ? 'pipe' : 'inherit', 'inherit'],
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
  return result.stdout;
}

async function runSqlFile(relativePath) {
  const client = new pg.Client({ connectionString: requireDatabaseUrl(), ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const started = Date.now();
    await client.query(readFileSync(path.join(root, relativePath), 'utf8'));
    console.log(`Ran ${relativePath} in ${Date.now() - started} ms`);
  } finally {
    await client.end();
  }
}

function buildSchemaFile() {
  const dir = path.join(root, 'supabase', 'migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const header = [
    '-- =============================================================================',
    '-- schema.sql: the complete database schema, generated from supabase/migrations',
    '-- (npm run db:schema). Apply the migrations, not this file, to a live project.',
    '-- =============================================================================',
    '',
  ].join('\n');
  const body = files
    .map((f) => `-- >>> supabase/migrations/${f}\n\n${readFileSync(path.join(dir, f), 'utf8').trim()}\n`)
    .join('\n');
  writeFileSync(path.join(root, 'supabase', 'schema.sql'), `${header}\n${body}`);
  console.log(`Wrote supabase/schema.sql from ${files.length} migrations`);
}

switch (process.argv[2]) {
  case 'push':
    supabaseCli(['db', 'push', '--db-url', requireDatabaseUrl(), '--include-all']);
    break;
  case 'seed':
    await runSqlFile('supabase/seed.sql');
    break;
  case 'types': {
    const types = supabaseCli(['gen', 'types', 'typescript', '--db-url', requireDatabaseUrl(), '--schema', 'public'], {
      captureStdout: true,
    });
    writeFileSync(path.join(root, 'src', 'lib', 'supabase', 'database.types.ts'), types);
    console.log('Wrote src/lib/supabase/database.types.ts');
    break;
  }
  case 'schema':
    buildSchemaFile();
    break;
  default:
    console.error('Usage: node --env-file=.env.local scripts/db.mjs <push|seed|types|schema>');
    process.exit(1);
}

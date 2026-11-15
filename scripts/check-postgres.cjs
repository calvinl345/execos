// Deeper Postgres connectivity test. Run with:
//   node --env-file=.env scripts/check-postgres.cjs
//
// Verifies:
//   1. DATABASE_URL is set
//   2. Postgres connection works (right host, port, password, db)
//   3. pgvector extension is installed
//   4. pg_trgm extension is installed
//
// This is the prerequisite before Drizzle migrations can run.

const postgres = require('postgres');

const dbUrl = process.env.DATABASE_URL;

function printCredentialHint(name, message) {
  console.error(`Credential to fix: ${name}`);
  console.error(`How to fix: ${message}`);
}

function getSupabaseProjectId(parsedUrl) {
  const match = parsedUrl.username.match(/^postgres\.([a-z0-9-]+)$/i);
  return match ? match[1] : null;
}

function getSupabaseExtensionsUrl(parsedUrl) {
  const projectId = getSupabaseProjectId(parsedUrl);
  return projectId ? `https://supabase.com/dashboard/project/${projectId}/database/extensions` : null;
}

console.log('Postgres direct-connection test');
console.log('---');

if (!dbUrl) {
  console.error('FAIL: DATABASE_URL not set in .env');
  printCredentialHint('DATABASE_URL', 'rerun the installer and paste DATABASE_URL from Supabase Connect -> ORM -> Drizzle -> Configure ORM -> .env.');
  process.exit(1);
}

let parsedDbUrl;
// Don't log the full URL (contains password). Show host + db only.
try {
  parsedDbUrl = new URL(dbUrl);
  console.log(`Host: ${parsedDbUrl.hostname}`);
  console.log(`Port: ${parsedDbUrl.port || 5432}`);
  console.log(`Database: ${parsedDbUrl.pathname.replace(/^\//, '') || '<missing>'}`);
  console.log(`User: ${parsedDbUrl.username}`);
  console.log(`Password: ${parsedDbUrl.password ? `${parsedDbUrl.password.slice(0, 3)}...` : '<missing>'}`);
} catch (err) {
  console.error(`FAIL: DATABASE_URL is not a valid URL: ${err.message}`);
  if (dbUrl.includes('#')) {
      printCredentialHint('DATABASE_URL password', 'the database password appears to contain #. In a URI, # must be encoded as %23. Re-copy DATABASE_URL from Supabase Connect -> ORM -> Drizzle -> Configure ORM -> .env.');
  } else {
    printCredentialHint('DATABASE_URL', 'copy the full Postgres URI. It should start with postgres:// or postgresql:// and include username, password, host, port, and database name.');
  }
  process.exit(1);
}
console.log('---');

const sql = postgres(dbUrl, {
  max: 1,
  idle_timeout: 5,
  connect_timeout: 10,
  prepare: false,
  // Suppress pgcrypto/uuid-ossp notices on first run
  onnotice: () => {},
});

(async () => {
  try {
    const start = Date.now();
    const result = await sql`SELECT 1 AS ok, current_database() AS db, version() AS pg_version`;
    const elapsed = Date.now() - start;
    console.log(`Connected (${elapsed}ms)`);
    console.log(`Database: ${result[0].db}`);
    console.log(`Postgres: ${result[0].pg_version.split(',')[0]}`);
  } catch (err) {
    console.error(`FAIL: could not connect`);
    console.error(err.message || err);
    if (err.code === 'ENOTFOUND') {
      printCredentialHint('DATABASE_URL host', 'the hostname did not resolve. Re-copy the database connection string and confirm the project ref in the host is correct.');
    } else if (err.code === '28P01' || (err.message || '').includes('password')) {
      printCredentialHint('DATABASE_URL password', 'the database password was rejected. Re-copy DATABASE_URL from Supabase Connect -> ORM -> Drizzle -> Configure ORM -> .env for this exact project.');
    } else if (err.code === '3D000') {
      printCredentialHint('DATABASE_URL database name', 'the database name is wrong. Supabase Postgres connection strings normally end with /postgres.');
    } else if (err.code === '28000' || err.code === '42704') {
      printCredentialHint('DATABASE_URL username', 'the database username/role was rejected. Re-copy DATABASE_URL from Supabase Connect -> ORM -> Drizzle -> Configure ORM -> .env instead of editing it by hand.');
    } else if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT' || err.code === 'EHOSTUNREACH') {
      printCredentialHint('DATABASE_URL host/port', 'the database host or port could not be reached. Re-copy DATABASE_URL from Supabase Connect -> ORM -> Drizzle -> Configure ORM -> .env.');
    } else {
      printCredentialHint('DATABASE_URL', 'the database connection string failed. Re-copy DATABASE_URL from Supabase Connect -> ORM -> Drizzle -> Configure ORM -> .env.');
    }
    await sql.end({ timeout: 1 }).catch(() => {});
    process.exit(1);
  }

  // Extension checks
  let extensions;
  try {
    extensions = await sql`SELECT extname, extversion FROM pg_extension ORDER BY extname`;
  } catch (err) {
    console.error('FAIL: could not query pg_extension');
    console.error(err.message || err);
    await sql.end({ timeout: 1 }).catch(() => {});
    process.exit(1);
  }

  const have = new Set(extensions.map((e) => e.extname));
  const required = ['vector', 'pg_trgm'];
  console.log('---');
  console.log('Required extensions:');
  let allOk = true;
  for (const ext of required) {
    if (have.has(ext)) {
      const v = extensions.find((e) => e.extname === ext)?.extversion;
      console.log(`  ${ext}: installed (v${v})`);
    } else {
      console.log(`  ${ext}: MISSING`);
      allOk = false;
    }
  }

  console.log('---');
  console.log('All installed extensions:');
  for (const e of extensions) {
    console.log(`  ${e.extname} v${e.extversion}`);
  }

  await sql.end({ timeout: 1 });

  console.log('---');
  if (allOk) {
    console.log('Postgres connection PASSED. Ready for Drizzle setup.');
    process.exit(0);
  } else {
    const extensionsUrl = getSupabaseExtensionsUrl(parsedDbUrl);
    console.error('FAIL: required extensions missing.');
    console.error('Enable them via Supabase Dashboard -> Database -> Extensions.');
    if (extensionsUrl) {
      console.error(`Open: ${extensionsUrl}`);
    }
    console.error('Credential to fix: none');
    console.error('How to fix: enable the missing Postgres extensions for this Supabase project, then rerun the installer.');
    process.exit(1);
  }
})();

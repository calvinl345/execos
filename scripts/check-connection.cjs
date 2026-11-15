// Quick Supabase connectivity test. Run with:
//   node --env-file=.env scripts/check-connection.cjs
//
// Verifies:
//   1. SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + SUPABASE_ANON_KEY env vars are set
//   2. Project URL is reachable
//   3. Both keys authenticate against the REST API
//
// This is a one-shot diagnostic. The full health check (with schema-version
// + pgvector + pg_trgm verification) lives in src/health/index.ts and lands
// later in this chunk.

// Normalize URL: strip any trailing slash and any /rest/v1/ suffix the dashboard
// might have included. We append the path ourselves below.
const rawUrl = process.env.SUPABASE_URL || '';
const url = rawUrl.replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.SUPABASE_ANON_KEY;

function isLegacyJwtKey(value) {
  return value.startsWith('eyJ');
}

function supabaseApiHeaders(apiKey) {
  const headers = { apikey: apiKey };
  if (isLegacyJwtKey(apiKey)) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

function printCredentialHint(name, message) {
  console.error(`Credential to fix: ${name}`);
  console.error(`How to fix: ${message}`);
}

console.log('Connection test — Supabase project');
console.log('---');

if (!url) {
  console.error('FAIL: SUPABASE_URL not set in .env');
  printCredentialHint('SUPABASE_URL', 'rerun the installer and paste the Supabase Project ID from Project Settings -> General -> Project ID.');
  process.exit(1);
}
if (!key) {
  console.error('FAIL: SUPABASE_SERVICE_ROLE_KEY not set in .env');
  printCredentialHint('SUPABASE_SERVICE_ROLE_KEY', 'copy the Secret key from Project Settings -> API Keys -> Publishable and secret API keys.');
  process.exit(1);
}
if (!anonKey) {
  console.error('FAIL: SUPABASE_ANON_KEY not set in .env');
  printCredentialHint('SUPABASE_ANON_KEY', 'copy the Publishable key from Project Settings -> API Keys -> Publishable and secret API keys.');
  process.exit(1);
}

try {
  new URL(url);
} catch (err) {
  console.error(`FAIL: SUPABASE_URL is not a valid URL: ${err.message}`);
  printCredentialHint('SUPABASE_URL', 'rerun the installer and paste only the Supabase Project ID; the installer will build the URL.');
  process.exit(1);
}

console.log(`URL: ${url}`);
console.log(`Service-role key prefix: ${key.slice(0, 12)}...`);
console.log(`Anon key prefix: ${anonKey.slice(0, 12)}...`);
console.log('---');

(async () => {
  // Hit the REST root with the service-role key.
  // Expected: 200 OK with a JSON list of exposed tables (will be empty
  // because we haven't created any tables yet).
  const start = Date.now();
  let response;
  try {
    response = await fetch(`${url}/rest/v1/`, {
      headers: supabaseApiHeaders(key),
    });
  } catch (err) {
    console.error(`FAIL: network error reaching ${url}`);
    console.error(err.message || err);
    printCredentialHint('SUPABASE_URL', 'check the Supabase Project ID. The expected URL is https://<project-id>.supabase.co.');
    process.exit(1);
  }
  const elapsed = Date.now() - start;

  if (!response.ok) {
    const body = await response.text().catch(() => '<unreadable>');
    console.error(`FAIL: ${response.status} ${response.statusText}`);
    console.error(`Body: ${body.slice(0, 500)}`);
    if (response.status === 401 || response.status === 403) {
      printCredentialHint('SUPABASE_SERVICE_ROLE_KEY', 'copy the Secret key from Project Settings -> API Keys -> Publishable and secret API keys. Make sure it belongs to the same project as the Project ID.');
    } else if (response.status === 404) {
      printCredentialHint('SUPABASE_URL', 'check the Supabase Project ID. The expected URL is https://<project-id>.supabase.co.');
    }
    process.exit(1);
  }

  console.log(`Service-role authenticated (${response.status}, ${elapsed}ms)`);

  // Now verify anon/publishable key works. Use /auth/v1/settings instead of
  // /rest/v1/, which lists table metadata and is not available to low-privilege
  // modern publishable keys.
  const anonStart = Date.now();
  let anonResponse;
  try {
    anonResponse = await fetch(`${url}/auth/v1/settings`, {
      headers: supabaseApiHeaders(anonKey),
    });
  } catch (err) {
    console.error(`FAIL: network error on anon-key request`);
    console.error(err.message || err);
    printCredentialHint('SUPABASE_URL', 'check the Supabase Project ID. The expected URL is https://<project-id>.supabase.co.');
    process.exit(1);
  }
  const anonElapsed = Date.now() - anonStart;

  if (!anonResponse.ok) {
    const body = await anonResponse.text().catch(() => '<unreadable>');
    console.error(`FAIL: anon key rejected — ${anonResponse.status} ${anonResponse.statusText}`);
    console.error(`Body: ${body.slice(0, 500)}`);
    if (anonResponse.status === 401 || anonResponse.status === 403) {
      printCredentialHint('SUPABASE_ANON_KEY', 'copy the Publishable key from Project Settings -> API Keys -> Publishable and secret API keys. Make sure it belongs to the same project as the Project ID.');
    } else if (anonResponse.status === 404) {
      printCredentialHint('SUPABASE_URL', 'check the Supabase Project ID. The expected URL is https://<project-id>.supabase.co.');
    }
    process.exit(1);
  }

  console.log(`Anon key authenticated (${anonResponse.status}, ${anonElapsed}ms)`);

  console.log('---');
  console.log('Connection test PASSED. Ready for schema work.');
  console.log('Next: provide DATABASE_URL from Supabase Connect -> ORM -> Drizzle -> Configure ORM -> .env.');
})();

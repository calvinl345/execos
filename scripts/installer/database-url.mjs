export function supabaseProjectInputToProjectId(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";

  let match = trimmed.match(/^https:\/\/([a-z0-9-]+)\.supabase\.co(?:\/rest\/v1)?\/?$/i);
  if (match) return match[1];

  match = trimmed.match(/^([a-z0-9-]+)\.supabase\.co(?:\/rest\/v1)?\/?$/i);
  if (match) return match[1];

  if (/^[a-z0-9-]+$/i.test(trimmed)) return trimmed;
  throw new Error("Supabase Project ID must look like abc123, or a project URL like https://abc123.supabase.co.");
}

export function supabaseProjectInputToUrl(value) {
  const projectId = supabaseProjectInputToProjectId(value);
  return projectId ? `https://${projectId}.supabase.co` : "";
}

export function convertDatabaseUrlInput(value) {
  let trimmed = String(value ?? "").trim();
  if (!trimmed) return "";

  const envAssignment = trimmed.match(/^DATABASE_URL\s*=\s*(.+)$/i);
  if (envAssignment) {
    trimmed = envAssignment[1].trim();
  }
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    trimmed = trimmed.slice(1, -1).trim();
  }

  if (trimmed === "[YOUR-PASSWORD]") {
    throw new Error("Paste the full DATABASE_URL from Supabase Connect -> ORM -> Drizzle -> Configure ORM -> .env, not only the database password.");
  }

  if (!/^postgres(?:ql)?:\/\//i.test(trimmed)) {
    throw new Error("DATABASE_URL must be the full Postgres URI from Supabase Connect -> ORM -> Drizzle -> Configure ORM -> .env.");
  }

  if (trimmed.includes("[YOUR-PASSWORD]")) {
    throw new Error("Replace [YOUR-PASSWORD] in DATABASE_URL with this project's database password.");
  }

  let repaired = trimmed;
  let urlHadFragment = false;
  try {
    const parsed = new URL(trimmed);
    urlHadFragment = Boolean(parsed.hash);
  } catch {
    // Try to repair the common Supabase case below: a raw database password
    // with URI-reserved characters such as # pasted into the connection string.
  }

  const match = trimmed.match(/^(postgres(?:ql)?:\/\/[^:]+:)(.+)@([^/@]+(?::\d+)?\/.+)$/i);
  if ((urlHadFragment || trimmed.includes("#")) && match) {
    repaired = `${match[1]}${encodeURIComponent(match[2])}@${match[3]}`;
  }

  let parsed;
  try {
    parsed = new URL(repaired);
  } catch (error) {
    throw new Error(`DATABASE_URL is not a valid Postgres URI: ${error.message}`);
  }

  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must start with postgres:// or postgresql://.");
  }
  if ((parsed.pathname || "").replace(/\/+$/, "") !== "/postgres") {
    throw new Error("Supabase DATABASE_URL should end with /postgres.");
  }

  return repaired;
}

export function postgresFailureKind(output) {
  const text = String(output ?? "");
  if (/vector:\s+MISSING|pg_trgm:\s+MISSING|required extensions missing/i.test(text)) {
    return "missing-extensions";
  }
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|DATABASE_URL|pooler region/i.test(text)) {
    return "host-or-region";
  }
  return "other";
}

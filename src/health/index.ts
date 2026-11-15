/**
 * Health probe registry.
 *
 * This file uses a registry pattern with one section per probe. New
 * probes are added by calling `registerProbe(name, fn)`, never by
 * editing existing probe bodies. A test asserts the registry shape and
 * the content stability of existing probes after a new probe registers.
 *
 * AC-044 staging:
 *   - supabase: implemented (reachability + schema version + required
 *     extensions).
 *   - embed: OpenAI key presence + runtime dimension verification.
 *   - mcp: stub returning `not_configured` until the MCP servers in
 *     `.mcp.json` are wired in.
 *
 * Probes that are not yet wired return a `not_configured` shape with
 * an explanatory reason (so the dashboard / CLI can render "configure
 * me" guidance instead of failing the whole health check).
 */

import { sql } from "drizzle-orm";
import { db, sqlClient } from "../db/index.js";
import {
  EMBEDDING_DIMENSION,
  EMBEDDING_PROVIDER,
  verifyDimensionAtBoot,
} from "../embeddings/index.js";

export type ProbeStatus = "ok" | "fail" | "not_configured";

export interface ProbeResult {
  name: string;
  status: ProbeStatus;
  durationMs: number;
  details?: Record<string, unknown>;
  error?: string;
  reason?: string; // populated when status === "not_configured"
}

export interface OverallHealth {
  status: ProbeStatus;
  probes: ProbeResult[];
  ranAt: string; // ISO 8601 UTC
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

type Probe = () => Promise<ProbeResult>;

const probeRegistry: Map<string, Probe> = new Map();

export function registerProbe(name: string, probe: Probe): void {
  if (probeRegistry.has(name)) {
    throw new Error(
      `Probe '${name}' is already registered. Use a unique name per probe.`,
    );
  }
  probeRegistry.set(name, probe);
}

export function getRegisteredProbeNames(): string[] {
  return Array.from(probeRegistry.keys()).sort();
}

/**
 * Test-only accessor. Returns the probe function registered under the
 * given name (or undefined). Used by `tests/health/registry.test.ts` to
 * assert content stability of existing probes after a new probe registers.
 *
 * Production code MUST NOT call this. The probe is invoked by
 * `runHealthCheck`; consumers do not need a direct handle.
 */
export function _getRegisteredProbeForTest(
  name: string,
): Probe | undefined {
  return probeRegistry.get(name);
}

/**
 * Test-only mutator. Removes a probe registration so test teardown can
 * leave the registry in its original state. Production code MUST NOT
 * call this.
 */
export function _unregisterProbeForTest(name: string): void {
  probeRegistry.delete(name);
}

export async function runHealthCheck(): Promise<OverallHealth> {
  const ranAt = new Date().toISOString();
  const results: ProbeResult[] = [];
  for (const [name, probe] of probeRegistry) {
    try {
      results.push(await probe());
    } catch (err) {
      results.push({
        name,
        status: "fail",
        durationMs: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Overall status: fail if any probe failed; ok if all configured ones
  // are ok and not_configured probes are explicitly tolerated; not_configured
  // if everything is not_configured (clean install pre-Chunk-5).
  const hasFail = results.some((r) => r.status === "fail");
  const allNotConfigured = results.every(
    (r) => r.status === "not_configured",
  );
  const status: ProbeStatus = hasFail
    ? "fail"
    : allNotConfigured
      ? "not_configured"
      : "ok";

  return { status, probes: results, ranAt };
}

// ---------------------------------------------------------------------------
// Built-in probes (registered immediately)
// ---------------------------------------------------------------------------

interface VersionRow extends Record<string, unknown> {
  version: string;
}

interface ExtensionRow extends Record<string, unknown> {
  extname: string;
  extversion: string;
}

interface MigrationRow extends Record<string, unknown> {
  hash: string;
  created_at: string;
}

/**
 * Supabase / direct-Postgres reachability + schema version + required
 * extensions. Combined into one probe because they share a DB
 * connection and round-trip cost.
 */
async function supabaseProbe(): Promise<ProbeResult> {
  const start = Date.now();
  try {
    // 1. Reachability.
    await sqlClient`SELECT 1`;

    // 2. Postgres version (informational).
    const versionResult = await db.execute<VersionRow>(
      sql`SELECT version() AS version`,
    );
    const versionRows = versionResult as unknown as VersionRow[];
    const pgVersion = versionRows[0]?.version ?? "unknown";

    // 3. Required extensions (vector, pg_trgm).
    const extResult = await db.execute<ExtensionRow>(
      sql`SELECT extname, extversion FROM pg_extension WHERE extname IN ('vector', 'pg_trgm')`,
    );
    const extRows = extResult as unknown as ExtensionRow[];
    const have = new Set(extRows.map((e) => e.extname));
    const missing = ["vector", "pg_trgm"].filter((e) => !have.has(e));
    if (missing.length > 0) {
      return {
        name: "supabase",
        status: "fail",
        durationMs: Date.now() - start,
        error: `Required Postgres extensions missing: ${missing.join(", ")}. Enable via Supabase dashboard -> Database -> Extensions.`,
      };
    }

    // 4. Schema version (most recent applied drizzle migration).
    let schemaVersion: { hash: string; appliedAt: string } | undefined;
    try {
      const migResult = await db.execute<MigrationRow>(
        sql`SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1`,
      );
      const migRows = migResult as unknown as MigrationRow[];
      if (migRows.length > 0) {
        schemaVersion = {
          hash: migRows[0].hash,
          appliedAt: migRows[0].created_at,
        };
      }
    } catch {
      // Migrations table not present yet (first install pre-migrate).
      schemaVersion = undefined;
    }

    return {
      name: "supabase",
      status: schemaVersion ? "ok" : "fail",
      durationMs: Date.now() - start,
      details: {
        pgVersion: pgVersion.split(",")[0],
        extensions: extRows.map((e) => `${e.extname} v${e.extversion}`),
        schemaVersion,
      },
      ...(schemaVersion
        ? {}
        : {
            error:
              "No schema migrations applied. Run `node --import=tsx scripts/migrate.ts up` to bootstrap.",
          }),
    };
  } catch (err) {
    return {
      name: "supabase",
      status: "fail",
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

registerProbe("supabase", supabaseProbe);

/**
 * Embed provider probe. Missing credentials are not_configured; present
 * credentials must pass runtime dimension verification.
 */
async function embedProbe(): Promise<ProbeResult> {
  const start = Date.now();
  if (!process.env.OPENAI_API_KEY) {
    return {
      name: "embed",
      status: "not_configured",
      durationMs: Date.now() - start,
      reason:
        "Embedding provider probe is not configured. Set OPENAI_API_KEY in .env when ready.",
    };
  }
  try {
    await verifyDimensionAtBoot();
    return {
      name: "embed",
      status: "ok",
      durationMs: Date.now() - start,
      details: {
        provider: EMBEDDING_PROVIDER,
        dimension: EMBEDDING_DIMENSION,
      },
    };
  } catch (err) {
    return {
      name: "embed",
      status: "fail",
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

registerProbe("embed", embedProbe);

/**
 * MCP probe placeholder. Activated when the MCP servers in `.mcp.json`
 * are wired in (each configured server responds to a no-op call per
 * Appendix F).
 */
async function mcpProbeStub(): Promise<ProbeResult> {
  return {
    name: "mcp",
    status: "not_configured",
    durationMs: 0,
    reason:
      "MCP responsiveness probe is not configured. Configure servers in .mcp.json when ready.",
  };
}

registerProbe("mcp", mcpProbeStub);

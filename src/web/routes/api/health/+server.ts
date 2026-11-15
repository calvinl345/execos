/**
 * Dashboard identity endpoint.
 *
 * The CLI discovers a running dashboard by probing this route instead of
 * trusting pidfile bookkeeping (see architecture/constitution.md R15 and
 * architecture/decisions/010-dashboard-lifecycle.md).
 * The `app` value is a contract string matched by the CLI launcher; the two
 * literals must stay identical.
 */
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types.js";

const startedAt = new Date().toISOString();

export const GET: RequestHandler = () => {
  return json({
    app: "execos-dashboard",
    pid: process.pid,
    started_at: startedAt,
    env_kind: process.env.EXECOS_ENV_KIND ?? null,
  });
};

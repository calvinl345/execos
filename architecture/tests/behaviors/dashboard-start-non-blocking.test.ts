/**
 * Behavioral golden — constitution R16 (decisions/010-dashboard-lifecycle.md):
 * agent-invoked commands are non-blocking. `execos dashboard start` must
 * return the terminal promptly instead of holding it, in every path that does
 * not spawn a server: the foreign-listener refusal and the status probe both
 * complete and exit through the real CLI binary.
 *
 * The happy spawn path (WMI detach, server outliving its creator) is
 * deliberately not exercised here: it would start a real server on the
 * dashboard port. Its detachment mechanics are pinned by the launcher unit
 * tests (serveCommandArgs / windowsDetachedCommandLine in
 * tests/cli/dashboard-launcher.test.ts).
 *
 * The CLI is invoked directly (node --import=tsx src/cli/index.ts) rather
 * than through scripts/execos.mjs: the launcher Object.assigns the target
 * env file over process.env, which pins DASHBOARD_PORT to the real
 * dashboard port and would point this test at a live server. The behavioral
 * contract under test belongs to the command, not the env wrapper.
 */
import { execFile } from "node:child_process";
import { createServer, type AddressInfo, type Server } from "node:net";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

const CLI_ENTRY = join(process.cwd(), "src", "cli", "index.ts");
const RETURN_BUDGET_MS = 25_000;

interface CliRun {
  code: number | null;
  stdout: string;
  stderr: string;
  elapsedMs: number;
}

function runCli(args: string[], port: number): Promise<CliRun> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    execFile(
      process.execPath,
      ["--import=tsx", CLI_ENTRY, ...args],
      {
        env: {
          ...process.env,
          DASHBOARD_PORT: String(port),
          EXECOS_DASHBOARD_PORT: String(port),
        },
        timeout: RETURN_BUDGET_MS,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        const elapsedMs = Date.now() - startedAt;
        if (error && (error as { killed?: boolean }).killed) {
          reject(
            new Error(
              `execos ${args.join(" ")} held the terminal past ${RETURN_BUDGET_MS}ms — blocking behavior is forbidden (R16)`,
            ),
          );
          return;
        }
        const code = error ? ((error as { code?: number }).code ?? 1) : 0;
        resolve({ code: typeof code === "number" ? code : 1, stdout, stderr, elapsedMs });
      },
    );
  });
}

let server: Server | null = null;

afterEach(() => {
  server?.close();
  server = null;
});

describe("behaviors: dashboard-start-non-blocking", () => {
  test("start returns the terminal promptly when a foreign process holds the port", async () => {
    server = createServer();
    const port = await new Promise<number>((resolve) => {
      server!.listen(0, "127.0.0.1", () =>
        resolve((server!.address() as AddressInfo).port),
      );
    });

    const run = await runCli(["dashboard", "start"], port);

    expect(run.code).toBe(1);
    expect(run.stderr).toMatch(/not the ExecOS dashboard/);
    expect(run.elapsedMs).toBeLessThan(RETURN_BUDGET_MS);
  });

  test("status probes and returns promptly when nothing is listening", async () => {
    const probe = createServer();
    const freePort = await new Promise<number>((resolve) => {
      probe.listen(0, "127.0.0.1", () => {
        const port = (probe.address() as AddressInfo).port;
        probe.close(() => resolve(port));
      });
    });

    const run = await runCli(["dashboard", "status"], freePort);

    expect(run.code).toBe(1);
    expect(run.stdout).toMatch(/not running/i);
    expect(run.elapsedMs).toBeLessThan(RETURN_BUDGET_MS);
  });
});

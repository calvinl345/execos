import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  browserOpenCommand,
  DASHBOARD_APP_ID,
  dashboardServerCommand,
  fetchDashboardHealth,
  forceStopCommand,
  isLocalPortReachable,
  isProcessAlive,
  parseDashboardHealth,
  readLivePid,
  serveCommandArgs,
  windowsDetachedCommandLine,
} from "../../src/cli/commands/dashboard.js";

let tmp: string;
let servers: Server[] = [];

beforeEach(() => {
  tmp = join(tmpdir(), `daily-dash-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmp, { recursive: true });
});

afterEach(() => {
  for (const server of servers) server.close();
  servers = [];
  rmSync(tmp, { recursive: true, force: true });
});

describe("readLivePid", () => {
  test("returns null when lockfile missing", () => {
    expect(readLivePid(join(tmp, "missing.pid"))).toBeNull();
  });

  test("returns null and clears lockfile when PID is dead", () => {
    const path = join(tmp, "stale.pid");
    // PID 999999 is almost certainly not running.
    writeFileSync(path, "999999", "utf8");
    expect(readLivePid(path)).toBeNull();
  });

  test("returns null on malformed lockfile", () => {
    const path = join(tmp, "bad.pid");
    writeFileSync(path, "not-a-number", "utf8");
    expect(readLivePid(path)).toBeNull();
  });

  test("returns the live PID when the recorded process is the current test runner", () => {
    const path = join(tmp, "live.pid");
    writeFileSync(path, String(process.pid), "utf8");
    expect(readLivePid(path)).toBe(process.pid);
  });
});

describe("isProcessAlive", () => {
  test("returns true for the current process", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });
  test("returns false for an obviously-dead PID", () => {
    expect(isProcessAlive(999999)).toBe(false);
  });
});

describe("dashboardServerCommand", () => {
  test("launches the production web server when it is built", () => {
    mkdirSync(join(tmp, "build-web"), { recursive: true });
    writeFileSync(join(tmp, "build-web", "index.js"), "", "utf8");

    const command = dashboardServerCommand(tmp, 3737);

    expect(command.command).toBe(process.execPath);
    expect(command.args).toEqual([join(tmp, "build-web", "index.js")]);
  });

  test("falls back to Vite through Node when the web build is missing", () => {
    const command = dashboardServerCommand(tmp, 3737);

    expect(command.command).toBe(process.execPath);
    expect(command.args).toEqual([
      join(tmp, "node_modules", "vite", "bin", "vite.js"),
      "dev",
      "--host",
      "127.0.0.1",
      "--port",
      "3737",
      "--strictPort",
    ]);
  });
});

describe("browserOpenCommand", () => {
  test("uses the Windows shell launcher for default-browser opens", () => {
    expect(browserOpenCommand("http://localhost:3737", "win32")).toEqual({
      command: "cmd.exe",
      args: ["/c", "start", "", "http://localhost:3737"],
    });
  });

  test("uses xdg-open on Linux", () => {
    expect(browserOpenCommand("http://localhost:3737", "linux")).toEqual({
      command: "xdg-open",
      args: ["http://localhost:3737"],
    });
  });

  test("uses open on macOS", () => {
    expect(browserOpenCommand("http://localhost:3737", "darwin")).toEqual({
      command: "open",
      args: ["http://localhost:3737"],
    });
  });
});

describe("forceStopCommand", () => {
  test("uses taskkill tree-kill on Windows", () => {
    expect(forceStopCommand(1234, "win32")).toEqual({
      command: "taskkill.exe",
      args: ["/PID", "1234", "/T", "/F"],
    });
  });

  test("returns null on Linux (uses process.kill signals instead)", () => {
    expect(forceStopCommand(1234, "linux")).toBeNull();
  });

  test("returns null on macOS (uses process.kill signals instead)", () => {
    expect(forceStopCommand(1234, "darwin")).toBeNull();
  });
});

describe("parseDashboardHealth", () => {
  test("accepts a payload with the dashboard app id and a valid pid", () => {
    const health = parseDashboardHealth({
      app: DASHBOARD_APP_ID,
      pid: 4321,
      started_at: "2026-06-10T00:00:00.000Z",
      env_kind: "production",
    });
    expect(health).toEqual({
      app: DASHBOARD_APP_ID,
      pid: 4321,
      started_at: "2026-06-10T00:00:00.000Z",
      env_kind: "production",
    });
  });

  test("rejects a payload with a foreign app id", () => {
    expect(parseDashboardHealth({ app: "some-other-app", pid: 4321 })).toBeNull();
  });

  test("rejects a payload without a usable pid", () => {
    expect(parseDashboardHealth({ app: DASHBOARD_APP_ID, pid: "nope" })).toBeNull();
    expect(parseDashboardHealth({ app: DASHBOARD_APP_ID })).toBeNull();
  });

  test("rejects non-object payloads", () => {
    expect(parseDashboardHealth(null)).toBeNull();
    expect(parseDashboardHealth("ok")).toBeNull();
  });
});

describe("fetchDashboardHealth", () => {
  let http: HttpServer | null = null;

  afterEach(async () => {
    if (http) {
      await new Promise<void>((resolve) => http?.close(() => resolve()));
      http = null;
    }
  });

  async function listen(handler: Parameters<typeof createHttpServer>[1]): Promise<number> {
    http = createHttpServer(handler);
    await new Promise<void>((resolve) => http?.listen(0, "127.0.0.1", resolve));
    const address = http.address();
    if (!address || typeof address === "string") throw new Error("Expected TCP address");
    return address.port;
  }

  test("returns health when the listener identifies as the dashboard", async () => {
    const port = await listen((req, res) => {
      expect(req.url).toBe("/api/health");
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ app: DASHBOARD_APP_ID, pid: 777, started_at: "x", env_kind: null }));
    });
    const health = await fetchDashboardHealth(port);
    expect(health?.pid).toBe(777);
  });

  test("returns null when the listener is not the dashboard", async () => {
    const port = await listen((_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ hello: "world" }));
    });
    await expect(fetchDashboardHealth(port)).resolves.toBeNull();
  });

  test("returns null when the port is closed", async () => {
    await expect(fetchDashboardHealth(9, 200)).resolves.toBeNull();
  });
});

describe("serveCommandArgs", () => {
  test("runs the execos launcher's dashboard serve with the resolved port", () => {
    const cmd = serveCommandArgs("C:\\repo", 3737, false);
    expect(cmd.command).toBe(process.execPath);
    expect(cmd.args).toEqual([
      join("C:\\repo", "scripts", "execos.mjs"),
      "dashboard",
      "serve",
      "--port",
      "3737",
    ]);
  });

  test("appends --prefer-vite when the build cannot be trusted", () => {
    const cmd = serveCommandArgs("/repo", 4000, true);
    expect(cmd.args.at(-1)).toBe("--prefer-vite");
  });
});

describe("windowsDetachedCommandLine", () => {
  test("wraps the serve command in cmd.exe with log redirection", () => {
    const line = windowsDetachedCommandLine(
      { command: "C:\\node\\node.exe", args: ["C:\\repo\\scripts\\execos.mjs", "dashboard", "serve", "--port", "3737"] },
      "C:\\repo\\.cache\\dashboard.out.log",
      "C:\\repo\\.cache\\dashboard.err.log",
    );
    expect(line.startsWith('cmd.exe /d /s /c "')).toBe(true);
    expect(line).toContain('"C:\\node\\node.exe" "C:\\repo\\scripts\\execos.mjs" "dashboard" "serve" "--port" "3737"');
    expect(line).toContain('1>> "C:\\repo\\.cache\\dashboard.out.log"');
    expect(line).toContain('2>> "C:\\repo\\.cache\\dashboard.err.log"');
  });
});

describe("isLocalPortReachable", () => {
  test("returns true when a local port is accepting connections", async () => {
    const server = createServer();
    servers.push(server);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected TCP server address");
    }

    await expect(isLocalPortReachable(address.port)).resolves.toBe(true);
  });

  test("returns false when a local port is closed", async () => {
    await expect(isLocalPortReachable(9, "127.0.0.1", 50)).resolves.toBe(false);
  });
});

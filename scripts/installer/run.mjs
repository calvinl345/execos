#!/usr/bin/env node

import { spawn } from "node:child_process";
import { chmodSync, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { homedir, tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import {
  ENV_ORDER,
  backupExistingEnv,
  readEnvFile,
  serializeValidatedSteps,
  validatedStepsFrom,
  writeEnvFile,
  writeEnvFileAtomically,
} from "./env.mjs";
import {
  convertDatabaseUrlInput,
  postgresFailureKind,
  supabaseProjectInputToProjectId,
  supabaseProjectInputToUrl,
} from "./database-url.mjs";
import { applyProfile, writePendingInstall } from "./materialize.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepoRoot = resolve(dirname(scriptPath), "..", "..");

export function parseArgs(argv) {
  const options = {
    repoRoot: defaultRepoRoot,
    profile: "production",
    dbEnvironment: "",
    skipInstall: false,
    skipBuild: false,
    skipDatabase: false,
    useExistingCredentials: false,
    allowProductionDatabaseChanges: false,
    noClearScreen: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`Missing value for ${arg}`);
      return argv[i];
    };
    if (arg === "--repo-root") options.repoRoot = resolve(next());
    else if (arg === "--profile") options.profile = next();
    else if (arg === "--db-environment") options.dbEnvironment = next();
    else if (arg === "--skip-install") options.skipInstall = true;
    else if (arg === "--skip-build") options.skipBuild = true;
    else if (arg === "--skip-database") options.skipDatabase = true;
    else if (arg === "--use-existing-credentials") options.useExistingCredentials = true;
    else if (arg === "--allow-production-database-changes") options.allowProductionDatabaseChanges = true;
    else if (arg === "--no-clear-screen") options.noClearScreen = true;
    else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  options.profile = normalizeProfile(options.profile);
  options.dbEnvironment = resolveDbEnvironment(options.dbEnvironment, options.profile);
  return options;
}

function usage() {
  return [
    "Usage: bash scripts/install.sh [options]",
    "",
    "Options:",
    "  --profile production|developer",
    "  --db-environment development|production",
    "  --skip-install",
    "  --skip-build",
    "  --skip-database",
    "  --use-existing-credentials",
    "  --allow-production-database-changes",
    "  --no-clear-screen",
    "  --repo-root <path>",
  ].join("\n");
}

function normalizeProfile(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "production" || normalized === "developer") return normalized;
  throw new Error(`Unknown profile '${value}'. Expected 'production' or 'developer'.`);
}

function resolveDbEnvironment(requested, profile) {
  if (!requested) return profile === "developer" ? "development" : "production";
  const normalized = String(requested).trim().toLowerCase();
  if (normalized === "development" || normalized === "production") return normalized;
  throw new Error(`Unknown database environment '${requested}'. Expected 'development' or 'production'.`);
}

function envFileName(environment) {
  if (environment === "development") return ".env.development.local";
  if (environment === "production") return ".env.production.local";
  throw new Error(`Unknown database environment '${environment}'.`);
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return 0;
  }

  assertRepoRoot(options.repoRoot);
  warnForMountedWindowsFs(options.repoRoot);
  if (!options.useExistingCredentials) {
    await writePendingInstall({
      repoRoot: options.repoRoot,
      profile: options.profile,
      dbEnvironment: options.dbEnvironment,
      platform: "linux",
    });
  }

  const context = createContext(options);
  applyProductionDatabaseInterlock(context);
  context.installStep = 0;
  context.installTotalSteps = computeInstallTotalSteps(options);
  cleanupOrphanTempEnvFiles(context);
  try {
    if (options.useExistingCredentials) {
      useExistingCredentials(context);
      writeTempEnv(context);
    } else {
      await promptForCredentials(context);
    }
    await validateRestAndOpenAi(context);
    await stopDashboardForInstall(context);
    if (!options.skipInstall) {
      await runInstallStep(context, "Installing npm dependencies", "npm", ["ci"]);
    }
    if (!options.skipDatabase) {
      await validatePostgresLoop(context);
    }
    if (!options.skipBuild) {
      await runInstallStep(context, "Building TypeScript", "npm", ["run", "build"]);
      await runInstallStep(context, "Building web dashboard", process.execPath, [
        "scripts/run-with-env.cjs",
        context.tempEnvPath,
        "node",
        "node_modules/vite/bin/vite.js",
        "build",
      ]);
    }
    if (!options.skipDatabase) {
      await runInstallStep(context, "Running pending migrations", process.execPath, [
        "scripts/run-with-env.cjs",
        context.tempEnvPath,
        "node",
        "--import=tsx",
        "scripts/migrate.ts",
        "up",
      ]);
      await runInstallStep(context, "Seeding app settings", process.execPath, [
        "scripts/run-with-env.cjs",
        context.tempEnvPath,
        "node",
        "--import=tsx",
        "scripts/seed-app-settings.ts",
      ]);
      await runInstallStep(context, "Backfilling task embeddings", process.execPath, [
        "scripts/run-with-env.cjs",
        context.tempEnvPath,
        "node",
        "--import=tsx",
        "scripts/backfill-task-embeddings.ts",
        "--strict",
      ]);
    }

    const healthArgs = context.dbEnvironment === "development"
      ? ["scripts/run-with-env.cjs", context.tempEnvPath, "node", "--import=tsx", "src/cli/index.ts", "health"]
      : ["scripts/run-with-env.cjs", context.tempEnvPath, "node", "dist/cli/index.js", "health"];
    await runInstallStep(context, "Running health check", process.execPath, healthArgs);
    await setExecosLiveTarget(context);
    await publishExecosCommand(context);
    await finalizeInstall(context);
    await ensureExecosCommandOnPath(context);
    await startDashboardAfterInstall(context);
    return 0;
  } finally {
    rmSync(context.tempEnvPath, { force: true });
  }
}

const PRODUCTION_MIGRATE_ACK = "I_UNDERSTAND_THIS_MUTATES_PRODUCTION";

function applyProductionDatabaseInterlock(context) {
  if (context.dbEnvironment !== "production" || context.skipDatabase) {
    return;
  }

  if (!context.allowProductionDatabaseChanges) {
    throw new Error(
      [
        "Refusing to run production database steps without --allow-production-database-changes.",
        "Use --skip-database to capture credentials or clone safely.",
        "Rerun with --allow-production-database-changes only after clone verification passes.",
      ].join(" "),
    );
  }

  process.env.EXECOS_ALLOW_PRODUCTION_MIGRATE = PRODUCTION_MIGRATE_ACK;
}

function computeInstallTotalSteps(options) {
  let total = 2; // Validate Supabase + Validate OpenAI
  if (!options.skipInstall) total += 1; // npm ci
  if (!options.skipDatabase) total += 1; // postgres check
  if (!options.skipBuild) total += 2; // ts build + dashboard build
  if (!options.skipDatabase) total += 3; // migrate + seed + backfill embeddings
  total += 1; // health check
  total += 1; // command publishing
  return total;
}

async function runInstallStep(context, label, command, args) {
  context.installStep += 1;
  return runLogged(context, label, command, args, {
    step: context.installStep,
    totalSteps: context.installTotalSteps,
  });
}

async function publishExecosCommand(context) {
  context.installStep += 1;
  const stepInfo = { step: context.installStep, totalSteps: context.installTotalSteps };
  try {
    await runLogged(context, "Publishing execos command", "npm", ["link"], stepInfo);
  } catch (error) {
    context.commandPublishWarning =
      "'npm link' could not publish the global 'execos' command. Setup continued, but 'execos' may not work in a new terminal yet.";
    console.warn(context.commandPublishWarning);
    printTail(error.output ?? error.message);
    if (process.platform !== "win32") {
      console.warn("Falling back to user-local shims.");
      writeUserLocalExecosShims(context);
    }
  }
}

async function setExecosLiveTarget(context) {
  console.log("");
  console.log("==> Setting active target");
  const result = await runProcess(
    process.execPath,
    ["scripts/execos-target.mjs", "use", context.dbEnvironment],
    context.repoRoot,
  );
  if (result.stdout.trim()) console.log(result.stdout.trim());
  if (result.code !== 0) {
    throw new Error(
      result.stderr.trim() ||
        `Could not set active ExecOS target to '${context.dbEnvironment}'.`,
    );
  }
}

async function ensureExecosCommandOnPath(context) {
  const commandName = context.dbEnvironment === "development" ? "execos" : "execos";
  const result = await runProcess(commandName, ["--help"], context.repoRoot);
  if (result.code === 0) {
    console.log(`ExecOS CLI command detected: ${commandName}`);
    return;
  }

  if (process.platform !== "win32") {
    const shimDir = writeUserLocalExecosShims(context);
    const shimDirWasOnPath = isDirectoryOnPath(shimDir);
    prependPathForCurrentProcess(shimDir);
    const shimResult = await runProcess(commandName, ["--help"], context.repoRoot);
    if (shimResult.code === 0) {
      console.log(`ExecOS CLI command detected: ${commandName}`);
      if (!shimDirWasOnPath) {
        console.warn(`Add ${shimDir} to PATH if a fresh shell cannot find ${commandName}.`);
      }
      return;
    }
  }

  if (context.commandPublishWarning) {
    console.warn(`Warning: ${commandName} is not available on PATH yet.`);
    return;
  }

  throw new Error(
    `The ${commandName} command was published, but '${commandName} --help' did not run successfully.`,
  );
}

function writeUserLocalExecosShims(context) {
  const shimDir = join(homedir(), ".local", "bin");
  mkdirSync(shimDir, { recursive: true });
  writeExecosShim(join(shimDir, "execos"), join(context.repoRoot, "scripts", "execos.mjs"));
  writeExecosShim(join(shimDir, "execos"), join(context.repoRoot, "scripts", "execos.mjs"));
  return shimDir;
}

function writeExecosShim(path, targetScript) {
  const escapedScript = targetScript.replace(/'/g, "'\\''");
  writeFileSync(path, `#!/usr/bin/env sh\nexec node '${escapedScript}' "$@"\n`, "utf8");
  chmodSync(path, 0o755);
}

function prependPathForCurrentProcess(directory) {
  if (isDirectoryOnPath(directory)) return;
  process.env.PATH = process.env.PATH ? `${directory}${delimiter}${process.env.PATH}` : directory;
}

function isDirectoryOnPath(directory) {
  const normalized = resolve(directory);
  return String(process.env.PATH ?? "")
    .split(delimiter)
    .filter(Boolean)
    .some((entry) => {
      try {
        return resolve(entry) === normalized;
      } catch {
        return false;
      }
    });
}

function skipInstallStep(context) {
  context.installStep += 1;
}

function cleanupOrphanTempEnvFiles(context) {
  const prefix = `${context.envName}.installing-`;
  const suffix = ".tmp";
  let entries;
  try {
    entries = readdirSync(context.repoRoot);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.startsWith(prefix) || !entry.endsWith(suffix)) continue;
    if (entry === `${prefix}${process.pid}${suffix}`) continue;
    rmSync(join(context.repoRoot, entry), { force: true });
  }
}

function assertRepoRoot(repoRoot) {
  if (!existsSync(join(repoRoot, "package.json")) || !existsSync(join(repoRoot, "Profiles"))) {
    throw new Error(`Repo root does not look like ExecOS: ${repoRoot}`);
  }
}

function warnForMountedWindowsFs(repoRoot) {
  const normalized = repoRoot.replace(/\\/g, "/");
  if (/^\/mnt\/[a-z]\//i.test(normalized)) {
    console.warn("Warning: this checkout is on a mounted Windows filesystem.");
    console.warn("Windows-built node_modules will not run on Linux; this installer will rerun npm ci.");
    console.warn("On /mnt/c/... filesystems, npm ci can be 5-10x slower due to filesystem overhead.");
    console.warn("Consider cloning to ~/execos instead.");
  }
}

function createContext(options) {
  const envName = envFileName(options.dbEnvironment);
  const envPath = join(options.repoRoot, envName);
  const partialEnvPath = join(options.repoRoot, `${envName}.installing.partial`);
  const tempEnvPath = join(options.repoRoot, `${envName}.installing-${process.pid}.tmp`);
  const legacyEnvPath = join(options.repoRoot, ".env");
  const finalValues = readEnvFile(envPath);
  const legacyValues =
    !options.useExistingCredentials && Object.keys(finalValues).length === 0 ? readEnvFile(legacyEnvPath) : {};
  const partialValues = options.useExistingCredentials ? {} : readEnvFile(partialEnvPath);
  const values = {
    ...legacyValues,
    ...finalValues,
    ...partialValues,
    EXECOS_DB_ENV: options.dbEnvironment,
    DASHBOARD_PORT: partialValues.DASHBOARD_PORT ?? finalValues.DASHBOARD_PORT ?? legacyValues.DASHBOARD_PORT ?? "3737",
    USER_DEFAULT_TIMEZONE: partialValues.USER_DEFAULT_TIMEZONE ?? finalValues.USER_DEFAULT_TIMEZONE ?? legacyValues.USER_DEFAULT_TIMEZONE ?? "America/Denver",
  };

  return {
    ...options,
    envName,
    envPath,
    partialEnvPath,
    tempEnvPath,
    legacyEnvPath,
    values,
    validatedSteps: validatedStepsFrom(values),
    commandPublishWarning: "",
    logRoot: join(tmpdir(), "execos-install"),
  };
}

const REQUIRED_CREDENTIAL_KEYS = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_ANON_KEY",
  "DATABASE_URL",
  "OPENAI_API_KEY",
];

function useExistingCredentials(context) {
  if (!existsSync(context.envPath)) {
    throw new Error(`Cannot update without ${context.envName}. Run scripts/install.sh once first, then rerun scripts/update.sh.`);
  }
  const missing = REQUIRED_CREDENTIAL_KEYS.filter((key) => !String(context.values[key] ?? "").trim());
  if (missing.length > 0) {
    throw new Error(
      `Cannot update because ${context.envName} is missing required value(s): ${missing.join(
        ", ",
      )}. Run scripts/install.sh to repair credentials.`,
    );
  }
  console.log(`Using existing credentials from ${context.envName}. No credential prompts will be shown.`);
}

async function isLocalPortReachable(port, host = "127.0.0.1", timeoutMs = 250) {
  return new Promise((resolvePort) => {
    const socket = createConnection({ host, port });
    let settled = false;
    const finish = (reachable) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolvePort(reachable);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

function dashboardCliArgs(context, command, envPath = context.tempEnvPath) {
  if (context.dbEnvironment === "development") {
    return [
      "scripts/run-with-env.cjs",
      envPath,
      "node",
      "--import=tsx",
      "src/cli/index.ts",
      "dashboard",
      command,
    ];
  }
  return ["scripts/run-with-env.cjs", envPath, "node", "dist/cli/index.js", "dashboard", command];
}

async function stopDashboardForInstall(context) {
  const dashboardPid = liveDashboardPid(context);
  if (dashboardPid === null) {
    const port = Number(context.values.DASHBOARD_PORT ?? 3737);
    if (await isLocalPortReachable(port)) {
      console.warn(
        `Dashboard port ${port} is in use, but this checkout has no live dashboard PID recorded. Leaving that process alone.`,
      );
    }
    return false;
  }

  console.log("");
  console.log("==> Stopping dashboard before install/update");
  try {
    await stopDashboardPidForRuntimeUpdate(context, dashboardPid);
  } catch (error) {
    throw new Error(
      `Dashboard pid ${dashboardPid} could not be stopped before updating runtime files: ${error.message || String(error)}`,
    );
  }

  return true;
}

function liveDashboardPid(context) {
  const pidPath = dashboardPidPath(context);
  if (!existsSync(pidPath)) return null;
  const pid = Number.parseInt(readFileSync(pidPath, "utf8").trim(), 10);
  if (!Number.isFinite(pid) || pid <= 0) return null;
  return isProcessAlive(pid) ? pid : null;
}

function dashboardPidPath(context) {
  return join(context.repoRoot, ".cache", "dashboard.pid");
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function stopDashboardPidForRuntimeUpdate(context, pid) {
  if (!isProcessAlive(pid)) {
    rmSync(dashboardPidPath(context), { force: true });
    return;
  }

  process.kill(pid, "SIGTERM");
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 1000));
  if (isProcessAlive(pid)) {
    process.kill(pid, "SIGKILL");
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1000));
  }
  if (isProcessAlive(pid)) {
    throw new Error("process is still running after SIGKILL");
  }
  rmSync(dashboardPidPath(context), { force: true });
}

async function startDashboardAfterInstall(context) {
  console.log("");
  console.log("==> Starting dashboard");
  const result = await runProcess(process.execPath, dashboardCliArgs(context, "start", context.envPath), context.repoRoot);
  if (result.code !== 0) {
    console.warn("Warning: install/update completed, but dashboard start failed. Run execos dashboard start manually.");
  }
}

async function promptForCredentials(context) {
  await writeBanner(context);

  const credentialContext = [
    `If ${context.envName} already has a value, press Enter to keep it.`,
    "Dashboard port defaults to 3737. Timezone defaults to America/Denver.",
  ];
  const credentialSteps = 7;
  const projectInput = await promptValue(context, "1. Supabase Project ID", {
    defaultValue: context.values.SUPABASE_URL,
    step: 1,
    totalSteps: credentialSteps,
    help: [
      ...credentialContext,
      "",
      "Find the Project ID in Supabase: Project Settings -> General -> Project ID.",
      "Open: https://supabase.com/dashboard/projects",
      "Paste only the Project ID. The installer will write SUPABASE_URL=https://<project-id>.supabase.co.",
      "Example Project ID: abc123",
    ],
  });
  const projectId = supabaseProjectInputToProjectId(projectInput);
  context.values.SUPABASE_URL = supabaseProjectInputToUrl(projectInput);

  context.values.SUPABASE_PROJECT_NAME = await promptValue(context, "2. Supabase project name", {
    defaultValue: context.values.SUPABASE_PROJECT_NAME,
    required: false,
    step: 2,
    totalSteps: credentialSteps,
    help: [
      ...credentialContext,
      "",
      "Find the friendly project name in Supabase: Project Settings -> General -> Project name.",
      "This is only shown in the local dashboard environment tooltip.",
    ],
  });

  await writeSupabaseExtensionsScreen(context, projectId, 3, credentialSteps);

  context.values.SUPABASE_SERVICE_ROLE_KEY = await promptValue(context, "4. Supabase secret/service-role key", {
    defaultValue: context.values.SUPABASE_SERVICE_ROLE_KEY,
    secret: true,
    step: 4,
    totalSteps: credentialSteps,
    help: [
      "Find it in Supabase: Project Settings -> API Keys -> Publishable and secret API keys.",
      `Open: https://supabase.com/dashboard/project/${projectId}/settings/api`,
      "Copy the Secret key. It usually starts with sb_secret_. Legacy service_role keys also work.",
      "Jordan's CLI uses this for writes and storage uploads. Keep it private.",
    ],
  });
  context.values.SUPABASE_ANON_KEY = await promptValue(context, "5. Supabase publishable/anon key", {
    defaultValue: context.values.SUPABASE_ANON_KEY,
    secret: true,
    step: 5,
    totalSteps: credentialSteps,
    help: [
      "Find it in Supabase: Project Settings -> API Keys -> Publishable and secret API keys.",
      `Open: https://supabase.com/dashboard/project/${projectId}/settings/api`,
      "Copy the Publishable key. It usually starts with sb_publishable_. Legacy anon keys also work.",
      "The dashboard uses this for read-only views under RLS.",
    ],
  });
  const databaseInput = await promptValue(context, "6. Supabase DATABASE_URL", {
    defaultValue: context.values.DATABASE_URL,
    secret: true,
    step: 6,
    totalSteps: credentialSteps,
    normalize: convertDatabaseUrlInput,
    help: [
      "Copy DATABASE_URL from Supabase: Connect -> ORM -> Drizzle -> Configure ORM -> .env.",
      "It starts with postgresql:// and includes the username, password, host, port, and database.",
      "Paste only the full URL value, without DATABASE_URL= or quotes. Replace [YOUR-PASSWORD] before pasting.",
    ],
  });
  context.databaseInput = databaseInput;
  context.values.DATABASE_URL = databaseInput;
  context.values.OPENAI_API_KEY = await promptValue(context, "7. OpenAI API key", {
    defaultValue: context.values.OPENAI_API_KEY,
    secret: true,
    step: 7,
    totalSteps: credentialSteps,
    help: [
      "Used only by Jordan's embedding adapter for memory retrieval.",
      "Open: https://platform.openai.com/api-keys",
      "It starts with sk-.",
    ],
  });
  context.values.EXECOS_INSTALL_VALIDATED_STEPS = serializeValidatedSteps(context.validatedSteps);
  savePartial(context);
  writeTempEnv(context);
}

async function validateRestAndOpenAi(context) {
  if (!context.validatedSteps.has("supabase")) {
    await runInstallStep(context, "Validating Supabase API credentials", process.execPath, [
      "scripts/run-with-env.cjs",
      context.tempEnvPath,
      "node",
      "scripts/check-connection.cjs",
    ]);
    markValidated(context, "supabase");
  } else {
    skipInstallStep(context);
  }

  if (!context.validatedSteps.has("openai")) {
    await runInstallStep(context, "Validating OpenAI API key", process.execPath, [
      "scripts/run-with-env.cjs",
      context.tempEnvPath,
      "node",
      "scripts/check-openai.cjs",
    ]);
    markValidated(context, "openai");
  } else {
    skipInstallStep(context);
  }
}

async function validatePostgresLoop(context) {
  if (context.validatedSteps.has("postgres")) {
    skipInstallStep(context);
    return;
  }
  context.installStep += 1;
  const stepInfo = { step: context.installStep, totalSteps: context.installTotalSteps };
  while (!context.validatedSteps.has("postgres")) {
    try {
      await runLogged(context, "Checking Postgres connection and extensions", process.execPath, [
        "scripts/run-with-env.cjs",
        context.tempEnvPath,
        "node",
        "scripts/check-postgres.cjs",
      ], stepInfo);
      markValidated(context, "postgres");
    } catch (error) {
      const kind = postgresFailureKind(error.output ?? error.message);
      if (kind === "missing-extensions") {
        const projectId = supabaseProjectInputToProjectId(context.values.SUPABASE_URL);
        await writeSupabaseExtensionsScreen(context, projectId, 3, 7);
        continue;
      }
      if (kind === "host-or-region") {
        const databaseInput = await promptValue(context, "Supabase DATABASE_URL", {
          defaultValue: context.databaseInput ?? context.values.DATABASE_URL ?? "",
          secret: true,
          normalize: convertDatabaseUrlInput,
          help: [
            "The previous database host/user check failed.",
            "Copy DATABASE_URL from Supabase: Connect -> ORM -> Drizzle -> Configure ORM -> .env.",
            "Paste only the full URL value, without DATABASE_URL= or quotes. Replace [YOUR-PASSWORD] before pasting.",
          ],
        });
        context.databaseInput = databaseInput;
        context.values.DATABASE_URL = databaseInput;
        savePartial(context);
        writeTempEnv(context);
        continue;
      }
      throw error;
    }
  }
}

async function finalizeInstall(context) {
  if (context.useExistingCredentials) {
    console.log("");
    console.log("==> Keeping existing environment file");
    console.log(`${context.envName} was reused without rewriting credentials.`);
  } else {
    console.log("");
    console.log("==> Writing repo-local environment files");
    const backupPath = backupExistingEnv(context.envPath);
    if (backupPath) console.log(`Existing ${context.envName} backed up to ${backupPath}`);

    delete context.values.EXECOS_INSTALL_VALIDATED_STEPS;
    writeEnvFileAtomically(context.envPath, context.values, { order: ENV_ORDER, generatedBy: "scripts/install.sh" });
    rmSync(context.partialEnvPath, { force: true });
  }
  rmSync(context.tempEnvPath, { force: true });
  await applyProfile({ repoRoot: context.repoRoot, profile: context.profile });
  writeWelcome(context);
}

function markValidated(context, step) {
  context.validatedSteps.add(step);
  context.values.EXECOS_INSTALL_VALIDATED_STEPS = serializeValidatedSteps(context.validatedSteps);
  savePartial(context);
  writeTempEnv(context);
}

function savePartial(context) {
  writeEnvFile(context.partialEnvPath, context.values, { order: ENV_ORDER, generatedBy: "scripts/install.sh partial retry cache" });
}

function writeTempEnv(context) {
  writeEnvFile(context.tempEnvPath, context.values, { order: ENV_ORDER, generatedBy: "scripts/install.sh temporary validation file" });
}

async function runLogged(context, label, command, args, stepInfo = null) {
  mkdirSync(context.logRoot, { recursive: true });
  const safe = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "step";
  const started = timestamp();
  const stdoutPath = join(context.logRoot, `${started}-${safe}-stdout.log`);
  const stderrPath = join(context.logRoot, `${started}-${safe}-stderr.log`);

  const useScreen = stepInfo && process.stdout.isTTY && !context.noClearScreen;
  if (useScreen) {
    writeInstallScreen(context, label, stdoutPath, stderrPath, stepInfo.step, stepInfo.totalSteps);
  } else {
    console.log("");
    console.log(`==> ${label}`);
    console.log(`Output log: ${stdoutPath}`);
    console.log(`Error log:  ${stderrPath}`);
    console.log(`Tail live:  tail -f '${stdoutPath}'`);
  }

  const result = await runProcess(command, args, context.repoRoot, { label, stdoutPath, stderrPath });
  if (result.code !== 0) {
    console.error(`${label} failed with exit code ${result.code}.`);
    printTail(result.stderr || result.stdout);
    const error = new Error(`${label} failed.`);
    error.output = `${result.stdout}\n${result.stderr}`;
    throw error;
  }
  console.log(`[ok] ${label}`);
}

function writeInstallScreen(context, label, stdoutPath, stderrPath, step, totalSteps) {
  clearScreen(context);
  writeLogo();
  writeProfileBadge(context);
  writeProgressLine(step, totalSteps);
  console.log("");
  console.log(formatBold("Installing ExecOS"));
  console.log("");
  console.log(`==> ${label}`);
  console.log(`Output log: ${stdoutPath}`);
  console.log(`Error log:  ${stderrPath}`);
  console.log(`Tail live:  tail -f '${stdoutPath}'`);
  console.log("");
}

function runProcess(command, args, cwd, { label, stdoutPath, stderrPath } = {}) {
  return new Promise((resolveResult) => {
    const child = spawn(command, args, { cwd, env: process.env, shell: false });
    let stdout = "";
    let stderr = "";
    const stdoutStream = stdoutPath ? createWriteStream(stdoutPath, { flags: "w" }) : null;
    const stderrStream = stderrPath ? createWriteStream(stderrPath, { flags: "w" }) : null;
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
      stdoutStream?.write(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
      stderrStream?.write(chunk);
    });

    const startedAt = Date.now();
    const showHeartbeat = label && process.stdout.isTTY;
    let heartbeatTimer = null;
    if (showHeartbeat) {
      const tick = () => {
        const elapsed = Math.round((Date.now() - startedAt) / 1000);
        process.stdout.write(`\r  ...working (${elapsed}s elapsed) `);
      };
      tick();
      heartbeatTimer = setInterval(tick, 2000);
    }
    const stopHeartbeat = () => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
        process.stdout.write("\r" + " ".repeat(48) + "\r");
      }
    };

    const finish = (result) => {
      stopHeartbeat();
      const closes = [];
      if (stdoutStream) closes.push(new Promise((r) => stdoutStream.end(r)));
      if (stderrStream) closes.push(new Promise((r) => stderrStream.end(r)));
      Promise.all(closes).then(() => resolveResult(result));
    };

    child.once("error", (error) => {
      finish({ code: 1, stdout, stderr: `${stderr}${error.message}\n` });
    });
    child.once("close", (code) => {
      finish({ code: code ?? 1, stdout, stderr });
    });
  });
}

async function promptValue(
  context,
  title,
  { defaultValue = "", secret = false, help = [], step = 1, totalSteps = 1, normalize = null, required = true } = {},
) {
  const helpLines = Array.isArray(help) ? help : help ? [help] : [`Enter the value for ${title}.`];
  const hasExisting = Boolean(String(defaultValue ?? "").trim());
  let errorMessage = "";
  while (true) {
    writeCredentialScreen(context, {
      title,
      help: helpLines,
      step,
      totalSteps,
      secret,
      hasExisting,
      defaultValue,
      errorMessage,
    });
    const suffix = hasExisting ? " [press Enter to keep existing]" : "";
    const value = await ask(`Value${suffix}: `);
    const finalValue = value.trim() || String(defaultValue ?? "").trim();
    if (finalValue) {
      try {
        return normalize ? normalize(finalValue) : finalValue;
      } catch (error) {
        errorMessage = error.message || String(error);
        continue;
      }
    }
    if (!required) return "";
    errorMessage = `${title} is required.`;
  }
}

async function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

function clearScreen(context) {
  if (!context.noClearScreen && process.stdout.isTTY) {
    process.stdout.write("\x1Bc");
  }
}

async function writeBanner(context) {
  clearScreen(context);
  writeLogo();
  writeProfileBadge(context);
  console.log("");
  console.log(formatBold("Repo-local setup"));
  console.log("Configures the repo-local ExecOS app on this machine.");
  console.log("");
  console.log(formatBold("Have these values ready:"));
  writeLabelLine("Project ID", "Supabase Project Settings -> General");
  writeLabelLine("API keys", "Supabase Project Settings -> API Keys");
  writeLabelLine("Extensions", "Supabase Database -> Extensions: enable vector and pg_trgm");
  writeLabelLine("DATABASE_URL", "Supabase Connect -> ORM -> Drizzle -> Configure ORM -> .env");
  writeLabelLine("OpenAI API key", "Used for memory embeddings");
  writeLabelLine("Supabase", "https://supabase.com/dashboard/projects");
  writeLabelLine("OpenAI", "https://platform.openai.com/api-keys");
  console.log("");
  await ask("Press Enter when ready for credential prompts");
}

function writeWelcome(context) {
  const cliCommand = context.dbEnvironment === "development" ? "execos" : "execos";
  clearScreen(context);
  writeLogo();
  writeProfileBadge(context);
  console.log("Install complete. Welcome to ExecOS.");
  console.log("");
  console.log(formatBold("Installed here:"));
  console.log(`  ${context.repoRoot}`);
  console.log("");
  console.log(formatBold("Configuration:"));
  writeLabelLine("CLI", `${cliCommand} ...`);
  writeLabelLine("Dashboard", `http://localhost:${context.values.DASHBOARD_PORT}`);
  writeLabelLine("Timezone", context.values.USER_DEFAULT_TIMEZONE);
  console.log("");
  console.log(formatBold("Start with an agent:"));
  console.log("  1. Open Claude Code or Codex in this folder. (Please Note that Claude Co-Work is not yet supported).");
  console.log("  2. Ask: open the dashboard");
  console.log("  3. Or ask: show me my active tasks");
  console.log("  4. Or ask: create a task for ...");
  console.log("");
  console.log(formatBold("Start from the terminal:"));
  console.log(`  ${cliCommand} dashboard start`);
  console.log(`  ${cliCommand} task list`);
  if (context.commandPublishWarning) {
    console.log("");
    console.log(formatBold("Command publishing warning:"));
    console.log(`  ${context.commandPublishWarning}`);
    if (process.platform === "win32") {
      console.log("  To make 'execos' available globally on Windows, rerun the installer from an Administrator shell");
      console.log("  or enable Windows Developer Mode, then rerun the installer.");
    } else {
      console.log("  Add your user-local bin directory to PATH, then rerun the installer if needed.");
    }
  }
  console.log("");
  console.log(formatBold("Useful files:"));
  console.log(`  ${context.envName} - environment-specific secrets`);
  console.log("  AGENTS.md    - materialized Codex instructions for this profile");
  console.log("  CLAUDE.md    - materialized Claude Code instructions for this profile");
  console.log("");
  console.log(formatBold("If something changes later:"));
  console.log(`  Edit ${context.envName} for dashboard port, timezone, or API keys.`);
  console.log(`  Rerun this installer with --db-environment ${context.dbEnvironment} to refresh this environment.`);
  console.log("");
  console.log(formatBold("Reporting bugs from chat:"));
  console.log("  Run this once to sign in to GitHub:");
  console.log("    gh auth login");
  console.log("  At the prompts pick: GitHub.com -> HTTPS -> Y -> Login with a web browser.");
  console.log("  After that, just say 'report a bug' or 'this is broken' to your agent and");
  console.log("  it will file a GitHub issue for you.");
  console.log("");
  console.log("You are ready.");
}

function writeCredentialScreen(context, { title, help, step, totalSteps, secret, hasExisting, defaultValue, errorMessage }) {
  clearScreen(context);
  writeLogo();
  writeProfileBadge(context);
  writeProgressLine(step, totalSteps);
  console.log("");
  console.log(formatBold(title));
  for (const line of help) {
    if (!line.trim()) {
      console.log("");
      continue;
    }
    const match = line.match(/^([^:]+):\s+(.+)$/);
    if (match) writeLabelLine(match[1], match[2]);
    else console.log(`  ${line}`);
  }
  if (secret) console.log("  Input is visible while you type so you can verify pasted values.");
  if (hasExisting) console.log("  Existing value found. Press Enter to keep it.");
  else if (defaultValue) console.log(`  Press Enter to use the default: ${defaultValue}`);
  if (errorMessage) {
    console.log("");
    console.log(errorMessage);
  }
  console.log("");
}

async function writeSupabaseExtensionsScreen(context, projectId, step, totalSteps) {
  const extensionsUrl = `https://supabase.com/dashboard/project/${projectId}/database/extensions`;
  clearScreen(context);
  writeLogo();
  writeProfileBadge(context);
  writeProgressLine(step, totalSteps);
  console.log("");
  console.log(formatBold("2. Enable Supabase extensions"));
  console.log("  Supabase does not always enable Jordan's required Postgres extensions by default.");
  console.log("  Open the project extensions page:");
  writeLabelLine("Open", extensionsUrl);
  console.log("");
  console.log("  Enable these two extensions:");
  console.log("    vector");
  console.log("    pg_trgm");
  console.log("");
  console.log("  The installer will verify this before running migrations.");
  console.log("");
  await ask("Press Enter after both extensions are enabled");
}

function writeLogo() {
  const chars = {
    "@": "\u2588",
    ">": "\u2557",
    "<": "\u2554",
    "/": "\u255D",
    "\\": "\u255A",
    "|": "\u2551",
    "=": "\u2550",
  };
  // "EXEC" renders in yellow and "OS" in cyan, side by side.
  const execTemplates = [
    "@@@@@@@>@@>  @@>@@@@@@@> @@@@@@>",
    "@@<====/\\@@>@@</@@<====/@@<====/",
    "@@@@@>   \\@@@</ @@@@@>  @@|     ",
    "@@<==/   @@<@@> @@<==/  @@|     ",
    "@@@@@@@>@@</ @@>@@@@@@@>\\@@@@@@>",
    "\\======/\\=/  \\=/\\======/ \\=====/",
  ];
  const osTemplates = [
    " @@@@@@> @@@@@@@>",
    "@@<===@@>@@<====/",
    "@@|   @@|@@@@@@@>",
    "@@|   @@|\\====@@|",
    "\\@@@@@@</@@@@@@@|",
    " \\=====/ \\======/",
  ];
  const render = (template) => template.replace(/[@></\\|=]/g, (char) => chars[char]);
  console.log("");
  execTemplates.forEach((template, i) => {
    console.log(`${color(render(template), "yellow")}  ${color(render(osTemplates[i]), "cyan")}`);
  });
  console.log("");
  console.log(color("An AI chief of staff for founders", "cyan"));
  console.log(color("ExecOS v0.1", "yellow"));
  console.log("");
}

function writeProfileBadge(context) {
  const parts = [];
  if (context.profile) parts.push(`Profile: ${context.profile}`);
  if (context.dbEnvironment) parts.push(`DB: ${context.dbEnvironment}`);
  if (context.envName) parts.push(`Env: ${context.envName}`);
  if (parts.length > 0) console.log(color(`[${parts.join(" | ")}]`, "cyan"));
}

function writeLabelLine(label, value, indent = "  ") {
  console.log(`${indent}${formatBold(`${label}:`)} ${value}`);
}

function writeProgressLine(step, totalSteps) {
  const width = 24;
  const filled = Math.floor((step / totalSteps) * width);
  const bar = `${"#".repeat(filled)}${"-".repeat(width - filled)}`;
  console.log(color(`Step ${step} of ${totalSteps}  [${bar}]`, "cyan"));
}

function formatBold(text) {
  if (!process.stdout.isTTY) return text;
  return `\u001b[1m${text}\u001b[22m`;
}

function color(text, name) {
  if (!process.stdout.isTTY) return text;
  const codes = { yellow: 33, cyan: 36 };
  return `\u001b[${codes[name] ?? 0}m${text}\u001b[0m`;
}

function printTail(output) {
  const lines = String(output ?? "").trim().split(/\r?\n/).filter(Boolean).slice(-30);
  if (lines.length === 0) return;
  console.error("");
  console.error("Last log lines:");
  for (const line of lines) console.error(line);
}

function timestamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

if (resolve(process.argv[1] ?? "") === scriptPath) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}

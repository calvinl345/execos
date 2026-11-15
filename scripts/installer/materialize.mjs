#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const here = dirname(scriptPath);
const defaultRepoRoot = resolve(here, "..", "..");

export function resolveProfileName(requested) {
  const normalized = String(requested ?? "production").trim().toLowerCase();
  if (normalized === "developer") return "Developer";
  if (normalized === "production") return "Production";
  throw new Error(`Unknown profile '${requested}'. Expected 'production' or 'developer'.`);
}

function assertInsideRepo(repoRoot, targetPath) {
  const repo = resolve(repoRoot);
  const target = resolve(targetPath);
  if (target !== repo && !target.startsWith(`${repo}${sep}`)) {
    throw new Error(`Refusing to materialize outside repo: ${targetPath}`);
  }
}

function copyRequiredFile(source, destination) {
  if (!existsSync(source)) throw new Error(`Profile file missing: ${source}`);
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(source, destination, { force: true });
}

const SOUL_INJECT_BEGIN = "<!-- SOUL.md inject:begin -->";
const SOUL_INJECT_END = "<!-- SOUL.md inject:end -->";

function readSoulBody(soulSource) {
  const text = readFileSync(soulSource, "utf8");
  const lines = text.split("\n");
  const firstH2 = lines.findIndex((line) => line.startsWith("## "));
  const body = firstH2 >= 0 ? lines.slice(firstH2).join("\n") : text;
  return body.replace(/\s+$/, "");
}

function injectSoul(content, soulBody, sourceLabel) {
  const beginIdx = content.indexOf(SOUL_INJECT_BEGIN);
  const endIdx = content.indexOf(SOUL_INJECT_END);
  if (beginIdx === -1 || endIdx === -1 || endIdx < beginIdx) {
    throw new Error(`SOUL.md inject markers missing or malformed in ${sourceLabel}`);
  }
  const before = content.slice(0, beginIdx + SOUL_INJECT_BEGIN.length);
  const after = content.slice(endIdx);
  return `${before}\n\n${soulBody}\n\n${after}`;
}

function materializeWithSoulInject(systemPromptsRoot, fileName, repoRoot, soulBody) {
  const sourcePath = join(systemPromptsRoot, fileName);
  if (!existsSync(sourcePath)) throw new Error(`Profile file missing: ${sourcePath}`);
  const sourceText = readFileSync(sourcePath, "utf8");
  const output = soulBody ? injectSoul(sourceText, soulBody, sourcePath) : sourceText;
  const destination = join(repoRoot, fileName);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, output, "utf8");
}

function replaceDirectoryContents(repoRoot, source, destination) {
  if (!existsSync(source)) throw new Error(`Profile skills folder missing: ${source}`);
  assertInsideRepo(repoRoot, destination);
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(destination, { recursive: true });
  cpSync(source, destination, { recursive: true, force: true });
}

const GEMINI_SETTINGS = {
  mcpServers: {
    svelte: {
      httpUrl: "https://mcp.svelte.dev/mcp",
      serverUrl: "https://mcp.svelte.dev/mcp",
      url: "https://mcp.svelte.dev/mcp",
    },
  },
};

function writeGeminiSettings(repoRoot) {
  const destination = join(repoRoot, ".gemini", "settings.json");
  assertInsideRepo(repoRoot, destination);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, `${JSON.stringify(GEMINI_SETTINGS)}\n`, "utf8");
}

const CLAUDE_STOP_HOOK = {
  hooks: [
    {
      type: "command",
      command: 'node "${CLAUDE_PROJECT_DIR}/.claude/hooks/arch-check-stop.mjs"',
      timeout: 600,
    },
  ],
};

const CLAUDE_SOLUTION_EDIT_HOOK = {
  matcher: "Edit|Write|MultiEdit",
  hooks: [
    {
      type: "command",
      command: 'python "${CLAUDE_PROJECT_DIR}/.claude/skills/change-planner-dev/scripts/solution_edit_hook.py"',
    },
  ],
};

const CODEX_HOOK_SETTINGS = {
  hooks: {
    Stop: [
      {
        hooks: [
          {
            type: "command",
            command: "node .claude/hooks/arch-check-stop.mjs",
            statusMessage: "Architecture backstop: arch:check on changed src/architecture/tests files",
            timeout: 600,
          },
        ],
      },
    ],
  },
};

const AGENTS_DEV_HOOK_SETTINGS = {
  "change-manager-solution-edit-log": {
    PreToolUse: [
      {
        matcher: "write_to_file|replace_file_content|multi_replace_file_content",
        hooks: [
          {
            type: "command",
            command: "python .agents/skills/change-planner-dev/scripts/solution_edit_hook.py",
            timeout: 10,
          },
        ],
      },
    ],
  },
};

function claudeHookSettingsForProfile(resolvedProfile) {
  const hooks = {};
  if (resolvedProfile === "Developer") {
    hooks.PreToolUse = [CLAUDE_SOLUTION_EDIT_HOOK];
  }
  hooks.Stop = [CLAUDE_STOP_HOOK];
  return { hooks };
}

function writeJsonFile(repoRoot, relativePath, value) {
  const destination = join(repoRoot, relativePath);
  assertInsideRepo(repoRoot, destination);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeRuntimeHookSettings(repoRoot, resolvedProfile) {
  writeJsonFile(repoRoot, join(".claude", "settings.json"), claudeHookSettingsForProfile(resolvedProfile));
  writeJsonFile(repoRoot, join(".codex", "hooks.json"), CODEX_HOOK_SETTINGS);
  writeJsonFile(
    repoRoot,
    join(".agents", "hooks.json"),
    resolvedProfile === "Developer" ? AGENTS_DEV_HOOK_SETTINGS : {},
  );
}

function writeActiveProfileMarker(repoRoot, resolvedProfile) {
  writeJsonFile(repoRoot, join(".execos", "active-profile.json"), {
    profile: resolvedProfile === "Developer" ? "developer" : "production",
  });
}

export function applyProfile({ repoRoot = defaultRepoRoot, profile = "production" } = {}) {
  const resolvedProfile = resolveProfileName(profile);
  const profileRoot = join(repoRoot, "Profiles", resolvedProfile);
  const systemPromptsRoot = join(profileRoot, "System Prompts");
  const skillsRoot = join(profileRoot, "Skills");

  if (!existsSync(profileRoot)) {
    throw new Error(`Unknown profile '${profile}'. Expected folder at ${profileRoot}`);
  }

  const soulSource = join(systemPromptsRoot, "SOUL.md");
  const soulBody = existsSync(soulSource) ? readSoulBody(soulSource) : null;

  materializeWithSoulInject(systemPromptsRoot, "AGENTS.md", repoRoot, soulBody);
  materializeWithSoulInject(systemPromptsRoot, "CLAUDE.md", repoRoot, soulBody);

  const legacySoulPath = join(repoRoot, "SOUL.md");
  assertInsideRepo(repoRoot, legacySoulPath);
  rmSync(legacySoulPath, { force: true });

  // Operational contracts live at the repo-root OperationalContracts/ dir and
  // are loaded directly by the CLI; remove the retired materialized copy.
  const legacyContractsPath = join(repoRoot, ".operational-contracts");
  assertInsideRepo(repoRoot, legacyContractsPath);
  rmSync(legacyContractsPath, { recursive: true, force: true });

  replaceDirectoryContents(repoRoot, skillsRoot, join(repoRoot, ".agents", "skills"));
  replaceDirectoryContents(repoRoot, skillsRoot, join(repoRoot, ".claude", "skills"));
  replaceDirectoryContents(repoRoot, skillsRoot, join(repoRoot, ".gemini", "skills"));
  writeGeminiSettings(repoRoot);
  writeRuntimeHookSettings(repoRoot, resolvedProfile);
  writeActiveProfileMarker(repoRoot, resolvedProfile);

  return [
    `Applied '${resolvedProfile}' profile.`,
    soulBody
      ? "Materialized system prompts: AGENTS.md, CLAUDE.md (SOUL.md inlined)"
      : "Materialized system prompts: AGENTS.md, CLAUDE.md",
    "Materialized skills: .agents/skills, .claude/skills, .gemini/skills",
    "Materialized Gemini settings: .gemini/settings.json",
    "Materialized runtime hook settings: .claude/settings.json, .codex/hooks.json, .agents/hooks.json",
    "Materialized active profile marker: .execos/active-profile.json",
    "Operational contracts load directly from OperationalContracts/ (no materialization)",
  ];
}

export function installCommandFor({ platform, profile, dbEnvironment }) {
  const args = [];
  if (platform === "windows") {
    args.push("powershell", "-ExecutionPolicy", "Bypass", "-File", ".\\scripts\\install.ps1", "-Profile", profile);
    if (dbEnvironment) args.push("-DbEnvironment", dbEnvironment);
    return args.map(quoteWindowsArg).join(" ");
  }

  args.push("bash", "scripts/install.sh", "--profile", profile);
  if (dbEnvironment) args.push("--db-environment", dbEnvironment);
  return args.map(quoteShellArg).join(" ");
}

export function pendingInstallLines({ repoRoot, profile, dbEnvironment, platform }) {
  const installCommand = installCommandFor({ platform, profile, dbEnvironment });
  const fence = platform === "windows" ? "powershell" : "bash";
  const cdCommand = platform === "windows" ? `cd "${repoRoot}"` : `cd ${quoteShellArg(repoRoot)}`;
  const scriptName = platform === "windows" ? "scripts/install.ps1" : "scripts/install.sh";
  return [
    "# ExecOS Installation Incomplete",
    "",
    `This checkout has not completed ${scriptName} successfully.`,
    "",
    "Do not run ExecOS operational workflows yet, including task management, dashboard launch, memory, review, resource upload, database migration, or health-check commands.",
    "",
    "If the user asks for ExecOS help, tell them setup is incomplete and ask them to rerun the installer from the repo root:",
    "",
    `\`\`\`${fence}`,
    cdCommand,
    installCommand,
    "```",
    "",
    `Installer target profile: ${profile}`,
    `Installer database environment: ${dbEnvironment}`,
    "",
    "After the installer completes, it will replace this temporary guidance with the selected profile's full instructions and skills.",
    "",
    "Do not invent credentials, do not ask the user to paste secrets into chat, and do not manually edit env files unless the user explicitly asks for repair help.",
  ];
}

export function writePendingInstall({ repoRoot = defaultRepoRoot, profile = "production", dbEnvironment = "production", platform = process.platform === "win32" ? "windows" : "linux" } = {}) {
  const lines = pendingInstallLines({ repoRoot, profile, dbEnvironment, platform });
  writeText(join(repoRoot, "AGENTS.md"), lines);
  writeText(join(repoRoot, "CLAUDE.md"), lines);

  const legacySoulPath = join(repoRoot, "SOUL.md");
  assertInsideRepo(repoRoot, legacySoulPath);
  rmSync(legacySoulPath, { force: true });

  const installCommand = installCommandFor({ platform, profile, dbEnvironment });
  writeInstallRequiredSkill(join(repoRoot, ".agents", "skills"), installCommand, platform);
  writeInstallRequiredSkill(join(repoRoot, ".claude", "skills"), installCommand, platform);
  writeInstallRequiredSkill(join(repoRoot, ".gemini", "skills"), installCommand, platform);
  writeGeminiSettings(repoRoot);
  writeRuntimeHookSettings(repoRoot, "Production");

  return [`Wrote pending-install guidance for ${platform}.`];
}

function writeInstallRequiredSkill(skillsRoot, installCommand, platform) {
  rmSync(skillsRoot, { recursive: true, force: true });
  const fence = platform === "windows" ? "powershell" : "bash";
  writeText(join(skillsRoot, "install-required", "SKILL.md"), [
    "# Installation Required",
    "",
    "Use when the user asks to operate ExecOS, open the dashboard, manage tasks, run reviews, save resources, query memory, or use project-specific ExecOS workflows.",
    "",
    "ExecOS installation has not completed successfully in this checkout. Do not run operational ExecOS commands.",
    "",
    "Tell the user to rerun the installer from the repo root:",
    "",
    `\`\`\`${fence}`,
    installCommand,
    "```",
    "",
    "Once the installer completes, this temporary skill will be replaced by the selected profile's real skills.",
  ]);
}

function writeText(path, lines) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${lines.join("\n")}\n`, "utf8");
}

function quoteShellArg(value) {
  if (/^[A-Za-z0-9_./:=+-]+$/.test(value)) return value;
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function quoteWindowsArg(value) {
  if (!/[\s"]/.test(value)) return value;
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function parseCli(argv) {
  const [command, ...rest] = argv;
  if (command === "--help" || command === "-h" || !command) {
    return { command: "help" };
  }
  const options = { command, repoRoot: defaultRepoRoot, profile: "production", platform: process.platform === "win32" ? "windows" : "linux", dbEnvironment: "" };
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    const next = () => {
      i += 1;
      if (i >= rest.length) throw new Error(`Missing value for ${arg}`);
      return rest[i];
    };
    if (arg === "--repo-root") options.repoRoot = resolve(next());
    else if (arg === "--profile") options.profile = next();
    else if (arg === "--platform") options.platform = next();
    else if (arg === "--db-environment") options.dbEnvironment = next();
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (!options.command) throw new Error("Usage: node scripts/installer/materialize.mjs <apply-profile|write-pending> [options]");
  if (!["windows", "linux"].includes(options.platform)) throw new Error("--platform must be windows or linux");
  if (!isAbsolute(options.repoRoot)) options.repoRoot = resolve(options.repoRoot);
  if (!options.dbEnvironment) options.dbEnvironment = options.profile === "developer" ? "development" : "production";
  return options;
}

if (resolve(process.argv[1] ?? "") === scriptPath) {
  try {
    const options = parseCli(process.argv.slice(2));
    const lines = options.command === "help"
      ? [
          "Usage: node scripts/installer/materialize.mjs <apply-profile|write-pending> [options]",
          "  --profile production|developer",
          "  --db-environment development|production",
          "  --platform windows|linux",
          "  --repo-root <path>",
        ]
      : options.command === "apply-profile"
      ? applyProfile(options)
      : options.command === "write-pending"
        ? writePendingInstall(options)
        : (() => { throw new Error(`Unknown command: ${options.command}`); })();
    for (const line of lines) console.log(line);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

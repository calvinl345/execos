import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyProfile, pendingInstallLines, writePendingInstall } from "../../scripts/installer/materialize.mjs";

describe("installer profile materializer", () => {
  let repo;

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "execos-materialize-"));
    seedProfile("Developer", "dashboard-dev");
    seedProfile("Production", "dashboard-prod");
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("materializes system prompts and skills from profile sources", () => {
    const lines = applyProfile({ repoRoot: repo, profile: "developer" });

    expect(lines[0]).toContain("Developer");
    expect(lines).toContain("Materialized runtime hook settings: .claude/settings.json, .codex/hooks.json, .agents/hooks.json");
    expect(lines).toContain("Materialized active profile marker: .execos/active-profile.json");
    expect(readFileSync(join(repo, "AGENTS.md"), "utf8")).toContain("Developer AGENTS");
    expect(existsSync(join(repo, ".agents", "skills", "dashboard-dev", "SKILL.md"))).toBe(true);
    expect(existsSync(join(repo, ".claude", "skills", "dashboard-dev", "SKILL.md"))).toBe(true);
    expect(readJson(join(repo, ".execos", "active-profile.json"))).toEqual({ profile: "developer" });
  });

  it("writes production runtime hook settings without dev-only edit hooks", () => {
    applyProfile({ repoRoot: repo, profile: "production" });

    const claude = readJson(join(repo, ".claude", "settings.json"));
    const agents = readJson(join(repo, ".agents", "hooks.json"));
    const codex = readJson(join(repo, ".codex", "hooks.json"));

    expect(claude.hooks.Stop).toBeDefined();
    expect(claude.hooks.PreToolUse).toBeUndefined();
    expect(agents).toEqual({});
    expect(codex.hooks.Stop[0].hooks[0].command).toBe("node .claude/hooks/arch-check-stop.mjs");
    expect(codex.hooks.Stop[0].hooks[0].statusMessage).toContain("Architecture backstop");
  });

  it("writes developer runtime hook settings with corrected change-planner paths", () => {
    applyProfile({ repoRoot: repo, profile: "developer" });

    const claudeText = readFileSync(join(repo, ".claude", "settings.json"), "utf8");
    const agentsText = readFileSync(join(repo, ".agents", "hooks.json"), "utf8");
    const claude = JSON.parse(claudeText);

    expect(claude.hooks.PreToolUse[0].matcher).toBe("Edit|Write|MultiEdit");
    expect(claude.hooks.PreToolUse[0].hooks[0].command).toContain("change-planner-dev");
    expect(claude.hooks.Stop).toBeDefined();
    expect(agentsText).toContain(".agents/skills/change-planner-dev/");
    expect(agentsText).not.toContain("change-manager-dev");
  });

  it("fully rewrites runtime hook settings when switching developer to production", () => {
    applyProfile({ repoRoot: repo, profile: "developer" });
    applyProfile({ repoRoot: repo, profile: "production" });

    const claude = readJson(join(repo, ".claude", "settings.json"));
    const agents = readJson(join(repo, ".agents", "hooks.json"));
    const marker = readJson(join(repo, ".execos", "active-profile.json"));

    expect(claude.hooks.PreToolUse).toBeUndefined();
    expect(claude.hooks.Stop).toBeDefined();
    expect(agents).toEqual({});
    expect(marker).toEqual({ profile: "production" });
  });

  it("replaces stale generated skills on every profile apply", () => {
    applyProfile({ repoRoot: repo, profile: "production" });
    mkdirSync(join(repo, ".agents", "skills", "stale-skill"), { recursive: true });
    mkdirSync(join(repo, ".claude", "skills", "stale-skill"), { recursive: true });
    writeFileSync(join(repo, ".agents", "skills", "stale-skill", "SKILL.md"), "stale\n");
    writeFileSync(join(repo, ".claude", "skills", "stale-skill", "SKILL.md"), "stale\n");

    applyProfile({ repoRoot: repo, profile: "developer" });

    expect(existsSync(join(repo, ".agents", "skills", "stale-skill"))).toBe(false);
    expect(existsSync(join(repo, ".claude", "skills", "stale-skill"))).toBe(false);
    expect(existsSync(join(repo, ".agents", "skills", "dashboard-dev", "SKILL.md"))).toBe(true);
    expect(existsSync(join(repo, ".claude", "skills", "dashboard-dev", "SKILL.md"))).toBe(true);
  });

  it("inlines SOUL.md between inject markers and removes the legacy SOUL.md file", () => {
    const soulSentinel = "PERSONALITY_SECTION_SENTINEL_LINE";
    seedProductionWithSoul(soulSentinel);
    writeFileSync(join(repo, "SOUL.md"), "stale standalone SOUL\n");

    applyProfile({ repoRoot: repo, profile: "production" });

    const agents = readFileSync(join(repo, "AGENTS.md"), "utf8");
    const claude = readFileSync(join(repo, "CLAUDE.md"), "utf8");
    expect(agents).toContain(soulSentinel);
    expect(claude).toContain(soulSentinel);
    expect(agents).toContain("<!-- SOUL.md inject:begin -->");
    expect(agents).toContain("<!-- SOUL.md inject:end -->");
    expect(existsSync(join(repo, "SOUL.md"))).toBe(false);
  });

  it("writes platform-specific pending-install guidance", () => {
    const windowsLines = pendingInstallLines({
      repoRoot: "C:\\repo",
      profile: "production",
      dbEnvironment: "production",
      platform: "windows",
    });
    const linuxLines = pendingInstallLines({
      repoRoot: "/home/dev/execos",
      profile: "production",
      dbEnvironment: "production",
      platform: "linux",
    });

    expect(windowsLines.join("\n")).toContain(".\\scripts\\install.ps1");
    expect(windowsLines.join("\n")).toContain("```powershell");
    expect(linuxLines.join("\n")).toContain("bash scripts/install.sh");
    expect(linuxLines.join("\n")).toContain("```bash");
  });

  it("replaces stale Windows pending-install files with Linux guidance and clears legacy SOUL.md", () => {
    writeFileSync(join(repo, "AGENTS.md"), "```powershell\n.\\scripts\\install.ps1\n```\n");
    writeFileSync(join(repo, "SOUL.md"), "stale standalone SOUL\n");
    mkdirSync(join(repo, ".claude", "skills", "install-required"), { recursive: true });
    writeFileSync(join(repo, ".claude", "skills", "install-required", "SKILL.md"), "```powershell\nold\n```\n");

    writePendingInstall({
      repoRoot: repo,
      profile: "developer",
      dbEnvironment: "development",
      platform: "linux",
    });

    expect(readFileSync(join(repo, "AGENTS.md"), "utf8")).toContain("bash scripts/install.sh");
    expect(readFileSync(join(repo, "CLAUDE.md"), "utf8")).toContain("```bash");
    expect(existsSync(join(repo, "SOUL.md"))).toBe(false);
    expect(readFileSync(join(repo, ".claude", "skills", "install-required", "SKILL.md"), "utf8")).toContain(
      "bash scripts/install.sh",
    );
  });

  it("writes production-shaped runtime hook settings for pending install", () => {
    writePendingInstall({
      repoRoot: repo,
      profile: "developer",
      dbEnvironment: "development",
      platform: "linux",
    });

    const claude = readJson(join(repo, ".claude", "settings.json"));
    const agents = readJson(join(repo, ".agents", "hooks.json"));
    const codex = readJson(join(repo, ".codex", "hooks.json"));

    expect(claude.hooks.Stop).toBeDefined();
    expect(claude.hooks.PreToolUse).toBeUndefined();
    expect(agents).toEqual({});
    expect(codex.hooks.Stop).toBeDefined();
  });

  function seedProfile(profile, skill) {
    const root = join(repo, "Profiles", profile);
    mkdirSync(join(root, "System Prompts"), { recursive: true });
    mkdirSync(join(root, "Skills", skill), { recursive: true });
    writeFileSync(join(root, "System Prompts", "AGENTS.md"), `${profile} AGENTS\n`);
    writeFileSync(join(root, "System Prompts", "CLAUDE.md"), `${profile} CLAUDE\n`);
    writeFileSync(join(root, "Skills", skill, "SKILL.md"), `${skill}\n`);
  }

  function readJson(path) {
    return JSON.parse(readFileSync(path, "utf8"));
  }

  function seedProductionWithSoul(sentinel) {
    const root = join(repo, "Profiles", "Production", "System Prompts");
    mkdirSync(root, { recursive: true });
    const hostBody = [
      "# AGENTS.md",
      "",
      "Production-facing instructions.",
      "",
      "<!-- SOUL.md inject:begin -->",
      "placeholder",
      "<!-- SOUL.md inject:end -->",
      "",
      "## Mission",
      "",
      "Body content.",
      "",
    ].join("\n");
    writeFileSync(join(root, "AGENTS.md"), hostBody);
    writeFileSync(join(root, "CLAUDE.md"), hostBody.replace("# AGENTS.md", "# CLAUDE.md"));
    writeFileSync(
      join(root, "SOUL.md"),
      [
        "# SOUL.md",
        "",
        "Meta paragraph that should be stripped.",
        "",
        "## Core Stance",
        "",
        sentinel,
        "",
      ].join("\n"),
    );
  }
});

/**
 * Conventions tests — structural rules beyond import topology, plus the
 * constitution sync meta-check.
 *
 * Every `describe` title here is an enforcement link in
 * architecture/constitution.md (format `conventions: <name>`); the sync test
 * below fails if a title and the constitution drift apart in either
 * direction. Do not rename a describe without amending the constitution
 * through the RATIFY procedure.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import type { Command } from "commander";
import { buildProgram } from "../../src/cli/index.js";
import { commandRegistry } from "../registry.js";

const ROOT = process.cwd();

function walkFiles(dir: string, exts?: string[]): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".svelte-kit") continue;
      out.push(...walkFiles(full, exts));
    } else if (!exts || exts.some((ext) => entry.name.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

function rel(path: string): string {
  return relative(ROOT, path).split(sep).join("/");
}

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

function collectLeafCommands(command: Command, prefix: string[] = []): string[] {
  const children = command.commands.filter((child) => child.name() !== "help");
  if (children.length === 0) return [prefix.join(" ")];
  return children.flatMap((child) =>
    collectLeafCommands(child, [...prefix, child.name()]),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// R24 — registry completeness and metadata honesty
// (decisions/014-command-registry.md)
// ─────────────────────────────────────────────────────────────────────────────

describe("conventions: registry-completeness", () => {
  const leaves = collectLeafCommands(buildProgram()).filter(Boolean).sort();
  const canonical = commandRegistry
    .filter((entry) => entry.status === "canonical")
    .map((entry) => entry.name)
    .sort();
  const deprecated = commandRegistry
    .filter((entry) => entry.status === "deprecated")
    .map((entry) => entry.name);

  it("every Commander leaf appears in the registry as canonical, and vice versa", () => {
    expect(leaves).toEqual(canonical);
  });

  it("registry names are unique", () => {
    const names = commandRegistry.map((entry) => entry.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("deprecated commands are not invocable", () => {
    // change-008 D1 deleted the legacy write stubs outright; any future
    // deprecation must keep the command out of the Commander tree.
    expect(deprecated.filter((name) => leaves.includes(name))).toEqual([]);
  });

  it("mutating commands route through services or carry a named exception", () => {
    // Named exception: exceptions.md R2 ratchet (goal/memory/resource writes
    // stay on their pre-contract paths until goalops/memoryops land).
    const ratchetFiles = new Set(["goal.ts", "memory.ts", "resource.ts"]);
    const familyFile = (name: string): string =>
      name.startsWith("memory sync-to-notion")
        ? "memory-sync.ts"
        : `${name.split(" ")[0]}.ts`;

    const offenders: string[] = [];
    for (const entry of commandRegistry.filter((record) => record.mutates)) {
      const file = familyFile(entry.name);
      if (ratchetFiles.has(file)) continue;
      const content = read(`src/cli/commands/${file}`);
      if (!/from "(\.\.\/)+services\//.test(content)) {
        offenders.push(`${entry.name} (${file} has no src/services import)`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// R23 — operational contracts have exactly one authoritative copy at the
// repo root; no per-profile contract tree may reappear
// (decisions/019-contracts-single-source.md)
// ─────────────────────────────────────────────────────────────────────────────

describe("conventions: contracts-single-source", () => {
  it("the root OperationalContracts source carries the taskops contract", () => {
    expect(
      existsSync(join(ROOT, "OperationalContracts", "taskops", "contract.yaml")),
    ).toBe(true);
  });

  it("no profile carries an OperationalContracts tree", () => {
    const strays = ["Developer", "Production"]
      .map((profile) => join(ROOT, "Profiles", profile, "OperationalContracts"))
      .filter((dir) => existsSync(dir))
      .map(rel);
    expect(strays).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// R17 — the dashboard binds loopback only
// (decisions/010-dashboard-lifecycle.md)
// ─────────────────────────────────────────────────────────────────────────────

describe("conventions: dashboard-loopback-only", () => {
  it("no 0.0.0.0 bind literal anywhere under src/ or in vite.config.ts", () => {
    const files = [
      ...walkFiles(join(ROOT, "src"), [".ts", ".svelte"]),
      join(ROOT, "vite.config.ts"),
    ];
    const offenders = files
      .filter((file) => readFileSync(file, "utf8").includes("0.0.0.0"))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("the dashboard serve path pins the host to 127.0.0.1", () => {
    const content = read("src/cli/commands/dashboard.ts");
    expect(content).toContain('process.env.HOST = "127.0.0.1"');
    expect(content).toContain('"--host", "127.0.0.1"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// R18 — priority/flag visual vocabulary has one source
// (decisions/011-web-ui-single-vocabulary.md)
// ─────────────────────────────────────────────────────────────────────────────

describe("conventions: priority-meta-single-source", () => {
  it("TASK_PRIORITY_META is referenced only by flags.ts and PriorityIndicator.svelte", () => {
    const allowed = new Set([
      "src/web/lib/utils/flags.ts",
      "src/web/lib/components/PriorityIndicator.svelte",
    ]);
    const offenders = walkFiles(join(ROOT, "src", "web"), [".ts", ".svelte"])
      .filter((file) => readFileSync(file, "utf8").includes("TASK_PRIORITY_META"))
      .map(rel)
      .filter((file) => !allowed.has(file));
    expect(offenders).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// R19 — interaction primitives are shared components
// (decisions/011-web-ui-single-vocabulary.md)
// ─────────────────────────────────────────────────────────────────────────────

describe("conventions: shared-interaction-primitives", () => {
  it("no local .kbd or .action-button styles outside Kbd.svelte and ActionButton.svelte", () => {
    const allowed = new Set([
      "src/web/lib/components/Kbd.svelte",
      "src/web/lib/components/ActionButton.svelte",
    ]);
    const patterns = [/\.kbd\s*\{/, /\.action-button\s*\{/, /class="kbd[\s"]/];
    const offenders = walkFiles(join(ROOT, "src", "web"), [".svelte"])
      .filter((file) => {
        const content = readFileSync(file, "utf8");
        return patterns.some((pattern) => pattern.test(content));
      })
      .map(rel)
      .filter((file) => !allowed.has(file));
    expect(offenders).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// R20 — dark mode is co-located dark: variants, never a global remap
// (decisions/011-web-ui-single-vocabulary.md)
// ─────────────────────────────────────────────────────────────────────────────

describe("conventions: no-global-dark-remap", () => {
  it(":global(.dark appears nowhere in src/web", () => {
    const offenders = walkFiles(join(ROOT, "src", "web"), [".svelte", ".ts", ".css"])
      .filter((file) => readFileSync(file, "utf8").includes(":global(.dark"))
      .map(rel);
    expect(offenders).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// R28 — bits-ui is the only UI component library in src/web
// (decisions/022-bits-ui-component-library.md)
// ─────────────────────────────────────────────────────────────────────────────

describe("conventions: bits-ui-single-library", () => {
  // Known Svelte component / headless-primitive libraries. A blocklist is
  // honest about its coverage: it catches the realistic drift (a well-known
  // second library arriving via npm install + import), not a novel unknown
  // package — that residue is design review under the R28 decision.
  const COMPETING_UI_LIBRARIES = [
    "@melt-ui/svelte",
    "melt",
    "radix-svelte",
    "shadcn-svelte",
    "flowbite-svelte",
    "@skeletonlabs/skeleton",
    "carbon-components-svelte",
    "@rgossiaux/svelte-headlessui",
    "svelte-headlessui",
    "svelte-material-ui",
    "@smui/", // scoped family prefix
    "sveltestrap",
    "@svelteuidev/", // scoped family prefix
    "daisyui",
    "attractions",
  ];
  const isCompeting = (name: string): boolean =>
    COMPETING_UI_LIBRARIES.some((lib) =>
      lib.endsWith("/") ? name.startsWith(lib) : name === lib || name.startsWith(`${lib}/`),
    );

  it("bits-ui is a direct dependency", () => {
    const pkg = JSON.parse(read("package.json")) as {
      dependencies?: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies ?? {})).toContain("bits-ui");
  });

  it("no competing UI component library is declared in package.json", () => {
    const pkg = JSON.parse(read("package.json")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const declared = [
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
    ];
    expect(declared.filter(isCompeting)).toEqual([]);
  });

  it("no src/web module imports a competing UI component library", () => {
    const importRe = /from\s+"([^"]+)"|import\s*\(\s*"([^"]+)"\s*\)/g;
    const offenders: string[] = [];
    for (const file of walkFiles(join(ROOT, "src", "web"), [".ts", ".svelte"])) {
      const content = readFileSync(file, "utf8");
      for (const match of content.matchAll(importRe)) {
        const specifier = match[1] ?? match[2];
        if (specifier && isCompeting(specifier)) {
          offenders.push(`${rel(file)} -> ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The constitution sync meta-check: every STRUCTURAL/BEHAVIORAL rule's named
// check exists, and every architecture-owned check maps back to a rule.
// ─────────────────────────────────────────────────────────────────────────────

interface ConstitutionRule {
  id: string;
  tier: "STRUCTURAL" | "BEHAVIORAL" | "CONTEXTUAL";
  enforcement: string;
  decision: string;
  line: string;
}

function parseConstitution(): ConstitutionRule[] {
  const text = read("architecture/constitution.md");
  const rules: ConstitutionRule[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const head = line.match(/^- \*\*(R\d+)\*\* \[(STRUCTURAL|BEHAVIORAL|CONTEXTUAL)\]/);
    if (!head) continue;
    const tail = line.match(/ — `([^`]+)` — \[(decisions\/[^\]]+)\]\([^)]+\)$/);
    if (!tail) {
      throw new Error(`Constitution line for ${head[1]} does not end with — \`check\` — [decisions/...](...): ${line}`);
    }
    rules.push({
      id: head[1],
      tier: head[2] as ConstitutionRule["tier"],
      enforcement: tail[1],
      decision: tail[2],
      line,
    });
  }
  return rules;
}

/**
 * Verifier table: enforcement-link id -> how to prove the check exists.
 * `depcruise` ids must name a rule in architecture/depcruise.cjs; `marker`
 * ids must find the marker string inside the named file; `script` entries
 * assert package.json wiring and referenced files.
 */
const CHECKS: Record<string, { file: string; markers: string[] }> = {
  "depcruise: domain-is-pure": { file: "architecture/depcruise.cjs", markers: ['name: "domain-is-pure"'] },
  "depcruise: domain-no-io": { file: "architecture/depcruise.cjs", markers: ['name: "domain-no-io"'] },
  "depcruise: web-anon-client-only": { file: "architecture/depcruise.cjs", markers: ['name: "web-anon-client-only"'] },
  "eslint: web-service-role-ban": { file: ".eslintrc.json", markers: ["Service-role DB client is forbidden"] },
  "eslint: test-only-exports": { file: ".eslintrc.json", markers: ["_getRegisteredProbeForTest", "_unregisterProbeForTest"] },
  "test: task write funnel guard": { file: "tests/cli/task-write-funnel-scan.test.ts", markers: ['describe("task write funnel guard"'] },
  "test: contract-conformance": { file: "tests/cli/contract-conformance.test.ts", markers: ['describe("taskops contract <-> CLI conformance"'] },
  "test: no-inference golden": { file: "tests/services/task-operations.test.ts", markers: ["never infers priority"] },
  "test: terminal-status goldens": { file: "tests/services/task-operations.test.ts", markers: ["rejects terminal statuses through update", "completeTaskOperation / cancelTaskOperation"] },
  "test: dedup goldens": { file: "tests/services/task-operations.test.ts", markers: ["refuses a near-duplicate open task", "never treats closed tasks as dedup candidates", "refuses an exact title match", "the exact-match gate still refuses when embed() throws"] },
  "test: append-only scan": { file: "tests/db/append-only-scan.test.ts", markers: ['describe("task_notes append-only application-layer guard"'] },
  "test: recorder goldens": { file: "tests/services/task-operations.test.ts", markers: ["records recordTaskGoalLinked"] },
  "ci: db:check-drift": { file: "package.json", markers: ['"db:check-drift"'] },
  "ci: db:check-safety": { file: "package.json", markers: ['"db:check-safety"'] },
  "test: dashboard health discovery": { file: "tests/cli/dashboard-launcher.test.ts", markers: ['describe("parseDashboardHealth"', 'describe("fetchDashboardHealth"'] },
  "behaviors: dashboard-start-non-blocking": { file: "architecture/tests/behaviors/dashboard-start-non-blocking.test.ts", markers: ['describe("behaviors: dashboard-start-non-blocking"'] },
  "behaviors: due-date-required": { file: "architecture/tests/behaviors/due-date-required.test.ts", markers: ['describe("behaviors: due-date-required"'] },
  "conventions: dashboard-loopback-only": { file: "architecture/tests/conventions.test.ts", markers: ['describe("conventions: dashboard-loopback-only"'] },
  "conventions: priority-meta-single-source": { file: "architecture/tests/conventions.test.ts", markers: ['describe("conventions: priority-meta-single-source"'] },
  "conventions: shared-interaction-primitives": { file: "architecture/tests/conventions.test.ts", markers: ['describe("conventions: shared-interaction-primitives"'] },
  "conventions: no-global-dark-remap": { file: "architecture/tests/conventions.test.ts", markers: ['describe("conventions: no-global-dark-remap"'] },
  "gates: test-pyramid": { file: "package.json", markers: ['"test:check-pyramid"', '"test:check-imports"', '"test:check-fast-reset"'] },
  "conventions: contracts-single-source": { file: "architecture/tests/conventions.test.ts", markers: ['describe("conventions: contracts-single-source"'] },
  "conventions: registry-completeness": { file: "architecture/tests/conventions.test.ts", markers: ['describe("conventions: registry-completeness"'] },
  "test: cli-help-skill-map": { file: "tests/cli/cli-help-skill-map.test.ts", markers: ['describe("CLI help skill command map"'] },
  "test: gate-events append-only scan": { file: "tests/db/append-only-scan.test.ts", markers: ['describe("gate_events append-only application-layer guard"'] },
  "conventions: bits-ui-single-library": { file: "architecture/tests/conventions.test.ts", markers: ['describe("conventions: bits-ui-single-library"'] },
};

describe("conventions: constitution-sync", () => {
  const rules = parseConstitution();

  it("parses a non-empty constitution within the size budget", () => {
    expect(rules.length).toBeGreaterThan(0);
    expect(rules.length).toBeLessThanOrEqual(30);
  });

  it("every rule links a decision file that exists", () => {
    const missing = rules
      .filter((rule) => !existsSync(join(ROOT, "architecture", rule.decision)))
      .map((rule) => `${rule.id} -> ${rule.decision}`);
    expect(missing).toEqual([]);
  });

  it("every STRUCTURAL and BEHAVIORAL rule names a check that exists", () => {
    const failures: string[] = [];
    for (const rule of rules) {
      if (rule.tier === "CONTEXTUAL") {
        if (rule.enforcement !== "context-only") {
          failures.push(`${rule.id} is CONTEXTUAL but its link is "${rule.enforcement}", not context-only`);
        }
        continue;
      }
      for (const checkId of rule.enforcement.split(" + ")) {
        const check = CHECKS[checkId];
        if (!check) {
          failures.push(`${rule.id} names unknown check "${checkId}" (no CHECKS entry)`);
          continue;
        }
        if (!existsSync(join(ROOT, check.file))) {
          failures.push(`${rule.id}: ${checkId} -> missing file ${check.file}`);
          continue;
        }
        const content = read(check.file);
        for (const marker of check.markers) {
          if (!content.includes(marker)) {
            failures.push(`${rule.id}: ${checkId} -> ${check.file} lost marker "${marker}"`);
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("every depcruise rule maps back to a constitution rule", () => {
    const referenced = new Set(rules.flatMap((rule) => rule.enforcement.split(" + ")));
    const config = read("architecture/depcruise.cjs");
    const names = [...config.matchAll(/name: "([a-z0-9-]+)"/g)].map((match) => match[1]);
    expect(names.length).toBeGreaterThan(0);
    const orphans = names.filter((name) => !referenced.has(`depcruise: ${name}`));
    expect(orphans).toEqual([]);
  });

  it("every architecture-owned test title maps back to a constitution rule", () => {
    const referenced = new Set(rules.flatMap((rule) => rule.enforcement.split(" + ")));
    referenced.add("conventions: constitution-sync"); // this meta-check itself
    // Line-anchored: real describes sit at column 0; this must not match the
    // marker strings inside the CHECKS table above.
    const titles = walkFiles(join(ROOT, "architecture", "tests"), [".test.ts"]).flatMap(
      (file) =>
        [...readFileSync(file, "utf8").matchAll(/^describe\("([^"]+)"/gm)].map(
          (match) => match[1],
        ),
    );
    expect(titles.length).toBeGreaterThan(0);
    const orphans = titles.filter((title) => !referenced.has(title));
    expect(orphans).toEqual([]);
  });
});

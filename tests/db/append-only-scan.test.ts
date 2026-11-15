import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

describe("task_notes append-only application-layer guard", () => {
  it("source files do not update or delete taskNotes", () => {
    const srcDir = join(process.cwd(), "src");
    if (!existsSync(srcDir)) {
      expect([]).toEqual([]);
      return;
    }

    const files = collectTsFiles(srcDir).filter(
      (file) => !file.endsWith(`${join("src", "db", "schema.ts")}`),
    );

    const offenders: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, "utf8");
      if (
        /\.update\(\s*taskNotes\s*\)|update\(\s*taskNotes\s*\)|\.delete\(\s*taskNotes\s*\)|delete\(\s*taskNotes\s*\)/.test(
          content,
        )
      ) {
        offenders.push(file);
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe("task_activities append-only application-layer guard", () => {
  it("source files do not update or delete taskActivities", () => {
    const srcDir = join(process.cwd(), "src");
    if (!existsSync(srcDir)) {
      expect([]).toEqual([]);
      return;
    }

    const files = collectTsFiles(srcDir).filter(
      (file) => !file.endsWith(`${join("src", "db", "schema.ts")}`),
    );

    const offenders: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, "utf8");
      if (
        /\.update\(\s*taskActivities\s*\)|update\(\s*taskActivities\s*\)|\.delete\(\s*taskActivities\s*\)|delete\(\s*taskActivities\s*\)/.test(
          content,
        )
      ) {
        offenders.push(file);
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe("gate_events append-only application-layer guard", () => {
  it("source files do not update or delete gateEvents", () => {
    const srcDir = join(process.cwd(), "src");
    if (!existsSync(srcDir)) {
      expect([]).toEqual([]);
      return;
    }

    const files = collectTsFiles(srcDir).filter(
      (file) => !file.endsWith(`${join("src", "db", "schema.ts")}`),
    );

    const offenders: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, "utf8");
      if (
        /\.update\(\s*gateEvents\s*\)|update\(\s*gateEvents\s*\)|\.delete\(\s*gateEvents\s*\)|delete\(\s*gateEvents\s*\)/.test(
          content,
        )
      ) {
        offenders.push(file);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("only src/db/helpers/gate-events.ts inserts into gateEvents (appendGateEvent is the single write path)", () => {
    const srcDir = join(process.cwd(), "src");
    if (!existsSync(srcDir)) {
      expect([]).toEqual([]);
      return;
    }

    const allowed = join("src", "db", "helpers", "gate-events.ts");
    const files = collectTsFiles(srcDir).filter(
      (file) =>
        !file.endsWith(`${join("src", "db", "schema.ts")}`) &&
        !file.endsWith(allowed),
    );

    const offenders: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, "utf8");
      if (/insert\(\s*gateEvents\s*\)/.test(content)) {
        offenders.push(file);
      }
    }

    expect(offenders).toEqual([]);
  });
});

function collectTsFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...collectTsFiles(full));
    if (entry.isFile() && entry.name.endsWith(".ts")) files.push(full);
  }
  return files;
}

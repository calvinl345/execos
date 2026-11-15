import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Command } from "commander";
import { buildProgram } from "../../src/cli/index.js";

function collectLeafCommands(command: Command, prefix: string[] = []): string[] {
  const children = command.commands.filter((child) => child.name() !== "help");
  if (children.length === 0) return [prefix.join(" ")];
  return children.flatMap((child) =>
    collectLeafCommands(child, [...prefix, child.name()]),
  );
}

function skillText(profile: "Developer" | "Production"): string {
  const suffix = profile === "Developer" ? "dev" : "prod";
  return readFileSync(
    join(
      process.cwd(),
      "Profiles",
      profile,
      "Skills",
      `cli-help-${suffix}`,
      "SKILL.md",
    ),
    "utf8",
  );
}

describe("CLI help skill command map", () => {
  const expectedCommands = collectLeafCommands(buildProgram())
    .filter(Boolean)
    .sort();

  it.each(["Developer", "Production"] as const)(
    "%s CLI help skill mentions every executable command",
    (profile) => {
      const text = skillText(profile);
      const missing = expectedCommands.filter(
        (command) => !text.includes(`\`${command}\``),
      );
      expect(missing).toEqual([]);
    },
  );
});

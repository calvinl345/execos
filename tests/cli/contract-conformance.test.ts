import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Command } from "commander";
import { buildProgram } from "../../src/cli/index.js";
import {
  loadTaskopsContract,
  loadTaskopsTemplate,
  type TaskopsOperation,
} from "../../src/cli/adapters/taskops-templates.js";

/**
 * Contract <-> CLI conformance for the taskops operational contract
 * (change-008, S2/A13b). Asserts a bijection between contract.yaml
 * operations and the Commander `execos taskops` subtree:
 *
 *   1. Every operation declared in contract.yaml has a CLI leaf command
 *      under `execos taskops`.
 *   2. Every taskops write leaf (everything except `hydrate` and the
 *      read-only leaves) has a contract.yaml operation entry with BOTH a
 *      hydrate template and a receipt template, and both template files
 *      resolve and are non-empty.
 *
 * Loads the authored contract from the repo-root OperationalContracts dir
 * (same convention as tests/cli/taskops.test.ts), the single source the
 * runtime loads directly. This test is a LOCKED gate; do not weaken it to
 * make it pass.
 */

const CONTRACT_DIR = join(process.cwd(), "OperationalContracts", "taskops");

// `hydrate` is the contract's entry point, not an operation of its own.
const NON_OPERATION_LEAVES = new Set(["hydrate"]);

// Read-only leaves: hydrate-only context reads with no write, hence no
// receipt requirement.
const READ_ONLY_LEAVES = new Set([
  "follow-ups",
  "draft-follow-ups",
  "show",
  "list",
]);

function collectLeafNames(command: Command, prefix: string[] = []): string[] {
  const children = command.commands.filter((child) => child.name() !== "help");
  if (children.length === 0) return [prefix.join(" ")];
  return children.flatMap((child) =>
    collectLeafNames(child, [...prefix, child.name()]),
  );
}

function taskopsLeaves(): string[] {
  const taskops = buildProgram().commands.find(
    (child) => child.name() === "taskops",
  );
  if (!taskops) {
    throw new Error("execos CLI has no `taskops` command family");
  }
  return collectLeafNames(taskops).filter(Boolean);
}

describe("taskops contract <-> CLI conformance", () => {
  it("every contract.yaml operation has a CLI leaf under execos taskops", () => {
    const contract = loadTaskopsContract(CONTRACT_DIR);
    const leaves = new Set(taskopsLeaves());

    const missingFromCli = Object.keys(contract.operations).filter(
      (operation) => !leaves.has(operation),
    );

    expect(missingFromCli).toEqual([]);
  });

  it("every taskops write leaf has a contract operation with hydrate and receipt templates", () => {
    const contract = loadTaskopsContract(CONTRACT_DIR);
    const writeLeaves = taskopsLeaves().filter(
      (leaf) => !NON_OPERATION_LEAVES.has(leaf) && !READ_ONLY_LEAVES.has(leaf),
    );

    // Guard against the walk silently returning nothing: the taskops family
    // must always expose at least the core write operations.
    expect(writeLeaves.length).toBeGreaterThan(0);

    const problems: string[] = [];
    for (const leaf of writeLeaves) {
      const spec = contract.operations[leaf];
      if (!spec) {
        problems.push(`${leaf}: no operation entry in contract.yaml`);
        continue;
      }
      if (!spec.hydrate?.template) {
        problems.push(`${leaf}: contract entry has no hydrate template`);
      } else {
        try {
          const template = loadTaskopsTemplate(
            leaf as TaskopsOperation,
            "hydrate",
            CONTRACT_DIR,
          );
          if (template.trim().length === 0) {
            problems.push(`${leaf}: hydrate template file is empty`);
          }
        } catch (error) {
          problems.push(`${leaf}: hydrate template unresolvable (${String(error)})`);
        }
      }
      if (!spec.receipt?.template) {
        problems.push(`${leaf}: contract entry has no receipt template`);
      } else {
        try {
          const template = loadTaskopsTemplate(
            leaf as TaskopsOperation,
            "receipt",
            CONTRACT_DIR,
          );
          if (template.trim().length === 0) {
            problems.push(`${leaf}: receipt template file is empty`);
          }
        } catch (error) {
          problems.push(`${leaf}: receipt template unresolvable (${String(error)})`);
        }
      }
    }

    expect(problems).toEqual([]);
  });
});

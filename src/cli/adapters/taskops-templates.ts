/**
 * Loader for the taskops operational-contract templates.
 *
 * The prompt templates and their command->template map are authored as
 * editable files under the repo-root `OperationalContracts/taskops/` dir,
 * the single authoritative copy shared by both profiles, and loaded from
 * there directly — no materialization step, edits take effect immediately.
 *
 * This module performs filesystem I/O, so it lives in the CLI/adapter layer,
 * not in src/domain. The pure renderer (compileHydrationPrompt) receives the
 * loaded template string and never touches the filesystem.
 */

import { readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

export type TaskopsOperation =
  | "create"
  | "update"
  | "complete"
  | "cancel"
  | "reopen"
  | "show"
  | "list"
  | "delegate"
  | "follow-up"
  | "defer"
  | "dependency-add"
  | "dependency-remove"
  | "flag-attention"
  | "unflag-attention"
  | "follow-ups"
  | "draft-follow-ups"
  | "re-rank";

/** The two kinds of return an operation can emit. */
export type TaskopsReturnKind = "hydrate" | "receipt";

export interface TaskopsReturnSpec {
  template: string;
  returns_subcommand?: boolean;
  hydrates?: string[];
}

export interface TaskopsOperationSpec {
  /** Human-only summary of the operation. Not consumed by the CLI. */
  description?: string;
  hydrate: TaskopsReturnSpec;
  receipt?: TaskopsReturnSpec;
}

export interface TaskopsContract {
  contract: string;
  operations: Record<string, TaskopsOperationSpec>;
}

function defaultContractDir(): string {
  // src/cli/adapters/* -> repo root is three levels up (mirrors dashboard.ts).
  // In a production build the same relative depth holds: dist/cli/adapters/*.
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(here, "..", "..", "..");
  return join(repoRoot, "OperationalContracts", "taskops");
}

const contractCache = new Map<string, TaskopsContract>();
const templateCache = new Map<string, string>();

export function loadTaskopsContract(contractDir: string = defaultContractDir()): TaskopsContract {
  const cached = contractCache.get(contractDir);
  if (cached) return cached;

  const manifestPath = join(contractDir, "contract.yaml");
  let raw: string;
  try {
    raw = readFileSync(manifestPath, "utf8");
  } catch {
    throw new Error(
      `taskops contract manifest not found at ${manifestPath}. ` +
        `The repo checkout is missing OperationalContracts/taskops/contract.yaml.`,
    );
  }

  const parsed = parseYaml(raw) as TaskopsContract | null;
  if (!parsed || typeof parsed !== "object" || typeof parsed.operations !== "object") {
    throw new Error(`taskops contract manifest at ${manifestPath} is malformed: missing 'operations' map.`);
  }

  contractCache.set(contractDir, parsed);
  return parsed;
}

export function loadTaskopsTemplate(
  operation: TaskopsOperation,
  kind: TaskopsReturnKind,
  contractDir: string = defaultContractDir(),
): string {
  const contract = loadTaskopsContract(contractDir);
  const operationSpec = contract.operations[operation];
  if (!operationSpec) {
    throw new Error(`taskops contract has no entry for operation '${operation}'.`);
  }
  const returnSpec = operationSpec[kind];
  if (!returnSpec || !returnSpec.template) {
    throw new Error(`taskops contract has no '${kind}' template for operation '${operation}'.`);
  }

  const templatePath = isAbsolute(returnSpec.template) ? returnSpec.template : join(contractDir, returnSpec.template);
  const cached = templateCache.get(templatePath);
  if (cached !== undefined) return cached;

  let text: string;
  try {
    text = readFileSync(templatePath, "utf8");
  } catch {
    throw new Error(
      `taskops template file not found: ${templatePath} (referenced by '${operation}.${kind}').`,
    );
  }

  templateCache.set(templatePath, text);
  return text;
}

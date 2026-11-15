/**
 * Command registry — every CLI command the `execos` binary exposes, with the
 * metadata the constitution cares about (R24, decisions/014-command-registry.md).
 *
 * Machine-checked by `conventions: registry-completeness`
 * (architecture/tests/conventions.test.ts): every Commander leaf must appear
 * here, every entry here must be a real Commander leaf, and `mutates` must
 * match how the registering command file actually reaches the database.
 *
 * - `operation` uses architecture/vocabulary.md terms.
 * - `mutates`: writes application data (directly or through services).
 * - `blocking`: holds the terminal as a long-lived foreground process.
 *   Agent-invoked commands must be non-blocking (R16).
 */
export interface CommandRecord {
  /** Exact space-joined Commander leaf path, e.g. "taskops create". */
  name: string;
  /** Business operation in vocabulary.md terms. */
  operation: string;
  status: "canonical" | "deprecated";
  /** Does it write to the database (directly or via services)? */
  mutates: boolean;
  /** Does it hold the terminal? Agent-invoked commands must be false. */
  blocking: boolean;
  notes?: string;
}

export const commandRegistry: CommandRecord[] = [
  // ── task (read-only surface; writes were removed by change-008 D1) ──
  { name: "task list", operation: "list tasks", status: "canonical", mutates: false, blocking: false },
  { name: "task show", operation: "inspect a task", status: "canonical", mutates: false, blocking: false },
  { name: "task dependency list", operation: "list task dependencies", status: "canonical", mutates: false, blocking: false },

  // ── taskops (the complete task write surface + hydration reads) ──
  { name: "taskops hydrate", operation: "hydrate an operation's packet", status: "canonical", mutates: false, blocking: false, notes: "repeated --op composes up to 8 work orders into one packet" },
  { name: "taskops create", operation: "create a task (intake, duplicate gate)", status: "canonical", mutates: true, blocking: false },
  { name: "taskops update", operation: "update task fields / goal link", status: "canonical", mutates: true, blocking: false },
  { name: "taskops complete", operation: "terminal status: done", status: "canonical", mutates: true, blocking: false, notes: "requires --yes (R8)" },
  { name: "taskops cancel", operation: "terminal status: cancelled", status: "canonical", mutates: true, blocking: false, notes: "requires --yes (R8)" },
  { name: "taskops reopen", operation: "reopen terminal task", status: "canonical", mutates: true, blocking: false },
  { name: "taskops delegate", operation: "delegation", status: "canonical", mutates: true, blocking: false },
  { name: "taskops follow-up", operation: "record a follow-up", status: "canonical", mutates: true, blocking: false },
  { name: "taskops defer", operation: "defer a task", status: "canonical", mutates: true, blocking: false },
  { name: "taskops dependency-add", operation: "add a task dependency", status: "canonical", mutates: true, blocking: false },
  { name: "taskops dependency-remove", operation: "remove a task dependency", status: "canonical", mutates: true, blocking: false },
  { name: "taskops flag-attention", operation: "set the attention flag", status: "canonical", mutates: true, blocking: false },
  { name: "taskops unflag-attention", operation: "clear the attention flag", status: "canonical", mutates: true, blocking: false },
  { name: "taskops follow-ups", operation: "hydrate due follow-ups", status: "canonical", mutates: false, blocking: false },
  { name: "taskops draft-follow-ups", operation: "hydrate follow-up drafts", status: "canonical", mutates: false, blocking: false },
  { name: "taskops show", operation: "hydrate one task's context", status: "canonical", mutates: false, blocking: false },
  { name: "taskops list", operation: "hydrate active tasks and goals", status: "canonical", mutates: false, blocking: false },
  { name: "taskops re-rank", operation: "execute a re-rank: replace the agent do-next queue", status: "canonical", mutates: true, blocking: false, notes: "packet via `taskops hydrate --operation re-rank`; optional --intent carries situational context" },

  // ── goal (writes are pre-contract; exceptions.md R2 ratchet) ──
  { name: "goal create", operation: "create a goal", status: "canonical", mutates: true, blocking: false, notes: "direct db write; exceptions.md R2 ratchet until goalops" },
  { name: "goal update", operation: "update a goal", status: "canonical", mutates: true, blocking: false, notes: "direct db write; exceptions.md R2 ratchet until goalops" },
  { name: "goal close-achieved", operation: "terminal goal status: achieved", status: "canonical", mutates: true, blocking: false, notes: "requires --yes; exceptions.md R2 ratchet" },
  { name: "goal close-dropped", operation: "terminal goal status: dropped", status: "canonical", mutates: true, blocking: false, notes: "requires --yes; exceptions.md R2 ratchet" },
  { name: "goal list", operation: "list goals", status: "canonical", mutates: false, blocking: false },
  { name: "goal show", operation: "inspect a goal", status: "canonical", mutates: false, blocking: false },
  { name: "goal linked-tasks", operation: "list a goal's linked tasks", status: "canonical", mutates: false, blocking: false },

  // ── memory (writes are pre-contract; exceptions.md R2 ratchet) ──
  { name: "memory save", operation: "save a memory (dedup bands)", status: "canonical", mutates: true, blocking: false, notes: "direct db write; exceptions.md R2 ratchet until memoryops" },
  { name: "memory recall", operation: "recall memories", status: "canonical", mutates: false, blocking: false },
  { name: "memory list", operation: "list memories", status: "canonical", mutates: false, blocking: false },
  { name: "memory forget", operation: "prune a memory", status: "canonical", mutates: true, blocking: false, notes: "requires --yes; exceptions.md R2 ratchet" },
  { name: "memory audit", operation: "audit a memory scope", status: "canonical", mutates: false, blocking: false },
  { name: "memory update", operation: "supersede a memory", status: "canonical", mutates: true, blocking: false, notes: "direct db write; exceptions.md R2 ratchet" },
  { name: "memory sync-to-notion", operation: "retry a memory's Notion sync", status: "canonical", mutates: false, blocking: false, notes: "stub: always not_configured" },

  // ── resource ──
  { name: "resource add", operation: "save a resource", status: "canonical", mutates: true, blocking: false, notes: "direct db + storage write; exceptions.md R2 ratchet" },

  // ── review ──
  { name: "review next", operation: "top prioritized task", status: "canonical", mutates: false, blocking: false },
  { name: "review morning", operation: "morning review", status: "canonical", mutates: false, blocking: false },
  { name: "review refresh-attention", operation: "refresh attention flags", status: "canonical", mutates: true, blocking: false, notes: "services: flag/unflag attention with silent audit" },
  { name: "review eod", operation: "end-of-day review", status: "canonical", mutates: false, blocking: false },
  { name: "review weekly", operation: "weekly review", status: "canonical", mutates: false, blocking: false },

  // ── health ──
  { name: "health", operation: "run health probes", status: "canonical", mutates: false, blocking: false },

  // ── dashboard ──
  { name: "dashboard start", operation: "start the dashboard", status: "canonical", mutates: false, blocking: false, notes: "detached spawn; returns the terminal (R16)" },
  { name: "dashboard stop", operation: "stop the dashboard", status: "canonical", mutates: false, blocking: false },
  { name: "dashboard status", operation: "report dashboard status", status: "canonical", mutates: false, blocking: false },
  { name: "dashboard serve", operation: "foreground dashboard server owner", status: "canonical", mutates: false, blocking: true, notes: "internal; invoked detached by `dashboard start`, never by agents directly" },
];

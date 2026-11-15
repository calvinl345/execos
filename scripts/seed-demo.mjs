#!/usr/bin/env node
/**
 * Seed a fresh database with fictional demo data for screenshots and videos.
 *
 * Everything goes through the real `execos` CLI, so IDs, embeddings, activity
 * logs, and dedup gates behave exactly as they do in normal use.
 *
 * Usage (against the active target, normally a local Supabase):
 *   node scripts/seed-demo.mjs
 *
 * Run it once on an empty database (after migrations + `db:seed:dev`).
 * Persona: Jordan Avery, founder of Northwind Studio. All names are fictional.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(import.meta.dirname, "execos.mjs");

function execos(...args) {
  const out = execFileSync(process.execPath, [CLI, "--format", "json", ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const json = out.slice(out.indexOf("{"));
  return JSON.parse(json);
}

function step(label, fn) {
  try {
    const r = fn();
    console.log(`  ok   ${label}`);
    return r;
  } catch (err) {
    const msg = String(err.stdout || err.stderr || err.message).split("\n").filter(Boolean).slice(-2).join(" ");
    console.log(`  skip ${label}: ${msg.slice(0, 160)}`);
    return null;
  }
}

const QUARTER = process.env.DEMO_QUARTER ?? "2026-Q4";

console.log("Goals");
const goals = {};
for (const [key, title, desc] of [
  ["beta", "Launch Beacon public beta", "Ship the Beacon SaaS beta to the first 50 design-partner accounts."],
  ["revenue", "Grow recurring revenue to $80k per month", "Convert two project clients to retainers and close Cedar & Co."],
  ["hire", "Hire a senior engineer", "Fill the senior full-stack role so Elena can step back from client delivery."],
  ["close", "Close the books within 5 days each month", "Tighten the month-end process with Priya so numbers are ready by day 5."],
]) {
  const r = step(`goal: ${title}`, () => execos("goal", "create", title, "-q", QUARTER, "-d", desc));
  if (r) goals[key] = r.goal.id;
}

console.log("Tasks");
const T = {};
// [key, title, category, priority, due, status, goal, description, extra flags]
const tasks = [
  ["larkspur", "Review Larkspur compliance checklist", "client", "P0", "tomorrow", "in_progress", null,
    "Go through the HIPAA compliance checklist from Larkspur Health and confirm every item before their audit.", ["--hard-deadline", "--effort", "M"]],
  ["onboarding", "Finish Beacon onboarding flow", "product", "P0", "thursday", "in_progress", "beta",
    "Complete the three-step onboarding flow: workspace setup, invite teammates, connect first data source.", ["--effort", "L"]],
  ["acme", "Send Acme phase 2 proposal", "client", "P1", "next tuesday", "triage", "revenue",
    "Draft and send the phase 2 proposal for the Acme Logistics warehouse dashboard, including retainer option.", []],
  ["close", "Run October month-end close", "business", "P1", "friday", "in_progress", "close",
    "Reconcile accounts, review AR aging, and send the October P&L to the partners.", ["--effort", "M"]],
  ["jd", "Draft senior engineer job description", "business", "P1", "tuesday", "in_progress", "hire",
    "Write the job description for the senior full-stack role, with salary band and interview loop.", ["--effort", "S"]],
  ["partners", "Interview 5 Beacon design partners", "product", "P1", "in 9 days", "in_progress", "beta",
    "Run 30-minute discovery calls with five design partners and capture onboarding pain points.", []],
  ["cedar", "Prep Cedar & Co. pitch deck", "client", "P1", "next friday", "backlog", "revenue",
    "Build the pitch deck for the Cedar & Co. website and booking app project.", ["--effort", "M"]],
  ["launchemail", "Write Beacon beta launch email", "product", "P1", "next friday", "backlog", "beta",
    "Write the announcement email for design partners with the beta signup link and what to expect.", ["--effort", "S"]],
  ["invoice", "Fix Larkspur October invoice discrepancy", "business", "P1", "wednesday", "triage", null,
    "Larkspur flagged a $1,200 difference on the October invoice. Find the cause and send a corrected invoice.", []],
  ["registration", "Renew car registration", "house", "P1", "nov 30", "backlog", null,
    "Registration expires at the end of the month. Renew online and print the new card.", ["--hard-deadline"]],
  ["demo", "Approve Acme sprint 14 demo build", "client", "P2", "monday", "review", null,
    "Review the sprint 14 demo build for Acme before Marcus shares it with the client.", []],
  ["analytics", "Pick analytics vendor for Beacon", "product", "P2", "in 2 weeks", "blocked", "beta",
    "Compare PostHog, Mixpanel, and Amplitude for Beacon product analytics once onboarding events are defined.", []],
  ["insurance", "Renew errors and omissions insurance", "business", "P2", "in 2 weeks", "backlog", null,
    "Policy renews next month. Get two competing quotes before accepting the renewal.", ["--hard-deadline"]],
  ["offsite", "Plan Q1 planning offsite", "business", "P2", "dec 5", "triage", null,
    "Pick a date and venue for the one-day Q1 planning offsite and send the agenda.", []],
  ["interviews", "Schedule first-round engineering interviews", "business", "P2", "in 10 days", "backlog", "hire",
    "Coordinate first-round interview slots for the senior engineer role.", []],
  ["furnace", "Book furnace maintenance", "house", "P2", "next monday", "triage", null,
    "Schedule the annual furnace tune-up before the first cold snap.", []],
  ["flights", "Book flights for December trip", "personal", "P2", "friday", "triage", null,
    "Book flights for the December family trip before prices go up.", []],
  ["physical", "Schedule annual physical", "personal", "P2", "in 2 weeks", "backlog", null,
    "Call the clinic to book the annual physical and bloodwork.", []],
  ["statuspage", "Set up Beacon status page", "product", "P3", "dec 10", "backlog", "beta",
    "Stand up a public status page for Beacon before the beta opens.", ["--allow-duplicate", "Distinct task (demo seed with test embeddings)"]],
  ["questionnaire", "Answer Larkspur security questionnaire", "client", "P2", "in 4 days", "backlog", null,
    "Complete the vendor security questionnaire Larkspur sent over.", []],
  ["vendors", "Clean up vendor list in accounting", "business", "P3", "in 3 weeks", "backlog", null,
    "Archive old vendors and merge duplicates in the accounting system.", []],
  ["gutters", "Get quotes for gutter cleaning", "house", "P3", "in 3 weeks", "backlog", null,
    "Get at least two quotes for gutter cleaning before winter.", []],
  ["book", "Finish reading The Mom Test", "personal", "P3", "in 4 weeks", "backlog", null,
    "Finish the book before the design partner interviews wrap up.", []],
  // Will be completed below so the Done column and activity log have history.
  ["kickoff", "Send Larkspur kickoff recap", "client", "P1", "tomorrow", "in_progress", null,
    "Send the kickoff recap with decisions, owners, and next milestones.", []],
  ["nda", "Sign Cedar & Co. NDA", "client", "P2", "tomorrow", "triage", "revenue",
    "Review and countersign the mutual NDA from Cedar & Co.", []],
  ["contractors", "Pay contractor invoices", "business", "P1", "tomorrow", "triage", "close",
    "Pay the three outstanding contractor invoices for October.", []],
];

for (const [key, title, category, priority, due, status, goal, desc, extra] of tasks) {
  const args = ["taskops", "create", title, "-c", category, "-p", priority, "--due", due, "-s", status, "-d", desc, ...extra];
  if (goal && goals[goal]) args.push("--goal-id", goals[goal]);
  const r = step(`task: ${title}`, () => execos(...args));
  if (r) T[key] = r.task.id;
}

console.log("Delegation, dependencies, attention");
const delegations = [
  ["invoice", "priya", "monday", "Priya has the October billing export. Ask her to reconcile against the SOW."],
  ["interviews", "priya", "tuesday", "Use the interview loop from the job description."],
  ["statuspage", "noah", "next friday", "Use the same provider as the client projects."],
  ["questionnaire", "elena", "today", "Elena owns the security answers; Jordan reviews before sending."],
  ["demo", "marcus", "monday", "Marcus to confirm the build is on staging before review."],
];
for (const [key, owner, followUp, note] of delegations) {
  if (!T[key]) continue;
  step(`delegate ${T[key]} -> ${owner}`, () =>
    execos("taskops", "delegate", "--task-id", T[key], "--owner", owner, "--follow-up", followUp, "--note", note));
}
if (T.analytics && T.onboarding) {
  step("dependency: analytics blocked by onboarding", () =>
    execos("taskops", "dependency-add", "--blocked", T.analytics, "--blocked-by", T.onboarding));
}
if (T.invoice) {
  step("flag attention: invoice", () =>
    execos("taskops", "flag-attention", "--task-id", T.invoice, "--reason", "Client is waiting on a corrected invoice."));
}

console.log("Completions");
for (const [key, note] of [
  ["kickoff", "Sent recap to Larkspur and Marcus."],
  ["nda", "Countersigned and filed."],
  ["contractors", "All three paid via ACH."],
]) {
  if (!T[key]) continue;
  step(`complete ${T[key]}`, () => execos("taskops", "complete", "--task-id", T[key], "--yes", "--note", note));
}

console.log("Do-next queue");
const queue = [
  ["larkspur", "Hard deadline tomorrow and the audit depends on it."],
  ["onboarding", "Blocks the analytics decision and the beta launch."],
  ["acme", "Largest revenue opportunity this quarter."],
  ["close", "Partners expect the October numbers Friday."],
  ["jd", "Hiring loop cannot start until this is posted."],
].filter(([k]) => T[k]);
if (queue.length) {
  const args = ["taskops", "re-rank"];
  for (const [k, why] of queue) args.push("--task", T[k], "--why", why);
  step("re-rank queue", () => execos(...args));
}

console.log("Resources");
const dir = mkdtempSync(join(tmpdir(), "execos-demo-"));
const docs = [
  ["Acme phase 2 proposal draft.md", "client", "acme",
    "# Acme Logistics: Phase 2 Proposal (Draft)\n\n## Scope\n- Real-time inventory dashboard\n- Driver mobile check-in\n- Monthly retainer for support\n\n## Timeline\n10 weeks from kickoff.\n"],
  ["Beacon beta launch plan.md", "product", "launchemail",
    "# Beacon Beta Launch Plan\n\n1. Finish onboarding flow\n2. Invite 50 design partners\n3. Weekly feedback calls\n4. Public launch in Q1\n"],
  ["Senior engineer interview loop.md", "business", "jd",
    "# Senior Engineer Interview Loop\n\n1. Intro call (30 min)\n2. Technical deep dive (60 min)\n3. Pairing session (90 min)\n4. Founder chat (30 min)\n"],
];
for (const [name, category, key, body] of docs) {
  const p = join(dir, name);
  writeFileSync(p, body);
  const args = ["resource", "add", p, "-c", category];
  if (T[key]) args.push("--task", T[key]);
  step(`resource: ${name}`, () => execos(...args));
}

console.log("Guardrails");
// Re-capture an existing task the way a voice note might. The dedup gate should
// refuse it, which records a gate event on the dashboard's Logs page.
try {
  execos("taskops", "create",
    "--title", "Fix Larkspur October invoice discrepancy",
    "-d", "Larkspur says the October invoice is off by 1,200 dollars and wants a corrected copy.",
    "-c", "business", "--due", "Friday");
  console.log("  warn duplicate create was NOT refused (dedup gate did not fire)");
} catch (err) {
  const refused = /refused/i.test(String(err.stdout || err.stderr || err.message));
  console.log(refused ? "  ok   gate: duplicate task refused" : `  skip gate demo: ${String(err.message).slice(0, 160)}`);
}

console.log(`\nDone. ${Object.keys(T).length} tasks, ${Object.keys(goals).length} goals.`);

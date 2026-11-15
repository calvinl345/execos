import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types.js";

const LEGACY_GOAL_PAGE_STATUSES = new Set(["active", "achieved", "dropped", "all"]);

/** `/goals` legacy route → dashboard Goals tab (Slice 04 follow-up consolidation). */
export const load: PageServerLoad = ({ url }) => {
  const q = new URLSearchParams(url.searchParams);
  const oldStatus = q.get("status");
  if (oldStatus !== null && LEGACY_GOAL_PAGE_STATUSES.has(oldStatus)) {
    if (oldStatus !== "active") q.set("gstatus", oldStatus);
    else q.delete("gstatus");
  }
  q.delete("status");
  const oldQ = q.get("quarter");
  if (oldQ !== null) {
    if (/^\d{4}-Q[1-4]$/.test(oldQ)) q.set("gq", oldQ);
    q.delete("quarter");
  }
  q.set("board", "goals");

  throw redirect(307, "/?" + q.toString());
};

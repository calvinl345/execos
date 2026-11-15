import type { PageServerLoad } from "./$types.js";
import { loadDashboardData } from "$lib/server/queries.js";
import type { DashboardData } from "$lib/types.js";

const lastGood = new Map<string, DashboardData>();

export const load: PageServerLoad = async ({ url }) => {
  const includeClosed = url.searchParams.get("closed") === "1";
  const goalIdFromUrl = url.searchParams.get("goal");
  const key = `${includeClosed}|${goalIdFromUrl ?? ""}`;
  try {
    const data = await loadDashboardData({
      goalIdFromUrl,
      includeClosed,
      now: new Date(),
    });
    lastGood.set(key, data);
    // recentlyDone and activeTasks are spread naturally into the returned payload.
    return { ...data, stale: false };
  } catch (err) {
    const cached = lastGood.get(key);
    if (cached) return { ...cached, stale: true };
    throw err;
  }
};

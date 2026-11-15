import { invalidateAll } from "$app/navigation";
import { startLiveRefreshLoop, LIVE_REFRESH_INTERVAL_MS } from "./live-refresh-timer.js";

/**
 * Shared refresh signal for components that fetch outside the SvelteKit loaders
 * (TaskDetailDrawer). Read `liveRefresh.tick` inside an effect to re-fetch each
 * poll. Mutate the property; never reassign the object.
 */
export const liveRefresh = $state({ tick: 0, suspended: false });

export function suspendLiveRefresh(): void {
  liveRefresh.suspended = true;
}

export function resumeLiveRefresh(): void {
  if (liveRefresh.suspended) {
    liveRefresh.suspended = false;
    liveRefresh.tick += 1;
    void invalidateAll();
  }
}

/** Start the global poll. Call from +layout.svelte onMount; return value tears down. */
export function startLiveRefresh(): () => void {
  return startLiveRefreshLoop({
    intervalMs: LIVE_REFRESH_INTERVAL_MS,
    refresh: () => invalidateAll(),
    onTick: () => {
      liveRefresh.tick += 1;
    },
    isVisible: () =>
      typeof document === "undefined" || document.visibilityState === "visible",
    isSuspended: () => liveRefresh.suspended,
    addVisibilityListener: (fn) =>
      typeof document !== "undefined" &&
      document.addEventListener("visibilitychange", fn),
    removeVisibilityListener: (fn) =>
      typeof document !== "undefined" &&
      document.removeEventListener("visibilitychange", fn),
  });
}

export const LIVE_REFRESH_INTERVAL_MS = 2000;

export interface LiveRefreshDeps {
  intervalMs?: number;
  /** Re-fetch data (default: SvelteKit invalidateAll, injected by the wrapper). */
  refresh: () => Promise<void> | void;
  /** Called once per accepted tick BEFORE refresh (used to bump the rune tick). */
  onTick?: () => void;
  /** True while the tab is visible. */
  isVisible?: () => boolean;
  /** True while the refresh should be temporarily suspended. */
  isSuspended?: () => boolean;
  /** Injectable for tests; defaults to the real timer functions. */
  setIntervalFn?: (fn: () => void, ms: number) => ReturnType<typeof setInterval>;
  clearIntervalFn?: (handle: ReturnType<typeof setInterval>) => void;
  addVisibilityListener?: (fn: () => void) => void;
  removeVisibilityListener?: (fn: () => void) => void;
}

/**
 * Starts the poll loop. Returns a teardown function.
 * - Skips a tick while the tab is hidden.
 * - Skips a tick if the previous refresh is still in flight (no pile-up).
 * - Refreshes immediately when the tab becomes visible again (catch up).
 */
export function startLiveRefreshLoop(deps: LiveRefreshDeps): () => void {
  const intervalMs = deps.intervalMs ?? LIVE_REFRESH_INTERVAL_MS;
  const isVisible = deps.isVisible ?? (() => true);
  const isSuspended = deps.isSuspended ?? (() => false);
  const setIntervalFn = deps.setIntervalFn ?? setInterval;
  const clearIntervalFn = deps.clearIntervalFn ?? clearInterval;

  let inFlight = false;
  const run = async () => {
    if (!isVisible() || inFlight || isSuspended()) return;
    inFlight = true;
    try {
      deps.onTick?.();
      await deps.refresh();
    } finally {
      inFlight = false;
    }
  };

  const handle = setIntervalFn(() => void run(), intervalMs);
  const onVisibility = () => {
    if (isVisible()) void run();
  };
  deps.addVisibilityListener?.(onVisibility);

  return () => {
    clearIntervalFn(handle);
    deps.removeVisibilityListener?.(onVisibility);
  };
}

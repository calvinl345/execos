import { describe, expect, it, vi } from "vitest";
import { startLiveRefreshLoop } from "../../src/web/lib/utils/live-refresh-timer.js";

describe("live-refresh-timer core loop", () => {
  it("calls refresh at the specified interval when visible", async () => {
    vi.useFakeTimers();
    let refreshCount = 0;
    let tickCount = 0;

    const stop = startLiveRefreshLoop({
      intervalMs: 1000,
      refresh: () => {
        refreshCount++;
      },
      onTick: () => {
        tickCount++;
      },
      isVisible: () => true,
    });

    expect(refreshCount).toBe(0);
    expect(tickCount).toBe(0);

    await vi.advanceTimersByTimeAsync(1000);
    expect(refreshCount).toBe(1);
    expect(tickCount).toBe(1);

    await vi.advanceTimersByTimeAsync(2000);
    expect(refreshCount).toBe(3);
    expect(tickCount).toBe(3);

    stop();
    vi.useRealTimers();
  });

  it("does not call refresh when hidden", async () => {
    vi.useFakeTimers();
    let refreshCount = 0;

    const stop = startLiveRefreshLoop({
      intervalMs: 1000,
      refresh: () => {
        refreshCount++;
      },
      isVisible: () => false,
    });

    await vi.advanceTimersByTimeAsync(3000);
    expect(refreshCount).toBe(0);

    stop();
    vi.useRealTimers();
  });

  it("prevents overlapping fetches if a refresh is in flight", async () => {
    vi.useFakeTimers();
    let refreshCount = 0;
    let resolveRefresh: (() => void) | null = null;

    const stop = startLiveRefreshLoop({
      intervalMs: 1000,
      refresh: () => {
        refreshCount++;
        return new Promise<void>((resolve) => {
          resolveRefresh = resolve;
        });
      },
      isVisible: () => true,
    });

    // Tick 1
    await vi.advanceTimersByTimeAsync(1000);
    expect(refreshCount).toBe(1);
    expect(resolveRefresh).toBeDefined();

    // Tick 2 happens while Tick 1 is still in flight (resolveRefresh has not been called)
    await vi.advanceTimersByTimeAsync(1000);
    expect(refreshCount).toBe(1); // Still 1! No new call started.

    // Resolve Tick 1
    resolveRefresh!();
    await vi.runAllTicks(); // let promise callbacks run

    // Tick 3 should now execute because Tick 1 finished
    await vi.advanceTimersByTimeAsync(1000);
    expect(refreshCount).toBe(2);

    stop();
    vi.useRealTimers();
  });

  it("refreshes immediately when visible listener fires and tab becomes visible", async () => {
    vi.useFakeTimers();
    let visibilityListener: (() => void) | null = null;
    let isVisibleVal = false;
    let refreshCount = 0;

    const stop = startLiveRefreshLoop({
      intervalMs: 1000,
      refresh: () => {
        refreshCount++;
      },
      isVisible: () => isVisibleVal,
      addVisibilityListener: (fn) => {
        visibilityListener = fn;
      },
      removeVisibilityListener: () => {
        visibilityListener = null;
      },
    });

    expect(visibilityListener).toBeDefined();
    expect(refreshCount).toBe(0);

    const listener = visibilityListener as (() => void) | null;
    expect(listener).not.toBeNull();

    // Visibility listener fires, but isVisible is still false
    if (listener) {
      listener();
    }
    await vi.runAllTicks();
    expect(refreshCount).toBe(0);

    // Tab becomes visible, visibility listener fires
    isVisibleVal = true;
    if (listener) {
      listener();
    }
    await vi.runAllTicks();
    expect(refreshCount).toBe(1);

    stop();
    expect(visibilityListener).toBeNull();
    vi.useRealTimers();
  });
});

import { describe, expect, it } from "vitest";
import { hasShortcutModifier } from "../../src/web/lib/utils/keyboard-shortcuts.js";

describe("keyboard shortcut modifier guard", () => {
  it("lets plain single-key shortcuts through", () => {
    expect(hasShortcutModifier({ ctrlKey: false, metaKey: false, altKey: false })).toBe(false);
  });

  it("blocks browser and OS modified shortcuts such as Ctrl+C and Cmd+C", () => {
    expect(hasShortcutModifier({ ctrlKey: true, metaKey: false, altKey: false })).toBe(true);
    expect(hasShortcutModifier({ ctrlKey: false, metaKey: true, altKey: false })).toBe(true);
  });

  it("blocks Alt-modified key chords from dashboard single-key shortcuts", () => {
    expect(hasShortcutModifier({ ctrlKey: false, metaKey: false, altKey: true })).toBe(true);
  });
});

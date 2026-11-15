export function hasShortcutModifier(event: Pick<KeyboardEvent, "ctrlKey" | "metaKey" | "altKey">): boolean {
  return event.ctrlKey || event.metaKey || event.altKey;
}

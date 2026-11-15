const SELF_KEY = "me";

const BASE_HUES = [356, 22, 42, 74, 142, 178, 207, 236, 266, 310];

export interface AssigneeTheme {
  key: string;
  background: string;
  border: string;
  text: string;
  ring: string;
  shadow: string;
  isSelf: boolean;
}

export function normalizeAssigneeKey(owner: string | null | undefined): string {
  const key = owner?.trim().toLowerCase();
  return key || SELF_KEY;
}

export function assigneeThemeFor(owner: string | null | undefined): AssigneeTheme {
  return buildAssigneeTheme(normalizeAssigneeKey(owner), 0);
}

export function assigneeThemeStyle(owner: string | null | undefined): string {
  return assigneeThemeToStyle(assigneeThemeFor(owner));
}

export function assigneeThemeStylesFor(owners: Array<string | null | undefined>): Record<string, string> {
  const styles: Record<string, string> = {};
  const usedBackgrounds = new Set<string>();

  for (const owner of owners) {
    const key = normalizeAssigneeKey(owner);
    if (styles[key]) continue;

    let salt = 0;
    let theme = buildAssigneeTheme(key, salt);
    while (usedBackgrounds.has(theme.background)) {
      salt += 1;
      theme = buildAssigneeTheme(key, salt);
    }

    styles[key] = assigneeThemeToStyle(theme);
    usedBackgrounds.add(theme.background);
  }

  return styles;
}

function buildAssigneeTheme(key: string, salt: number): AssigneeTheme {
  if (key === SELF_KEY) {
    return {
      key,
      background: "hsl(214 72% 42%)",
      border: "hsl(214 72% 58%)",
      text: "hsl(0 0% 100%)",
      ring: "hsl(214 76% 54% / 0.28)",
      shadow: "0 1px 4px hsl(214 72% 24% / 0.24)",
      isSelf: true,
    };
  }

  const hash = hashString(salt === 0 ? key : `${key}:${salt}`);
  const hue = BASE_HUES[hash % BASE_HUES.length];
  const saturation = 30 + (Math.floor(hash / BASE_HUES.length) % 10);
  const lightness = 34 + (Math.floor(hash / (BASE_HUES.length * 10)) % 7);

  return {
    key,
    background: `hsl(${hue} ${saturation}% ${lightness}%)`,
    border: `hsl(${hue} ${Math.min(saturation + 6, 48)}% 54%)`,
    text: "hsl(0 0% 98%)",
    ring: `hsl(${hue} ${Math.min(saturation + 4, 48)}% 48% / 0.26)`,
    shadow: `0 1px 3px hsl(${hue} ${saturation}% 18% / 0.18)`,
    isSelf: false,
  };
}

function assigneeThemeToStyle(theme: AssigneeTheme): string {
  return [
    `--assignee-bg: ${theme.background}`,
    `--assignee-border: ${theme.border}`,
    `--assignee-text: ${theme.text}`,
    `--assignee-ring: ${theme.ring}`,
    `--assignee-shadow: ${theme.shadow}`,
  ].join("; ");
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export const themeVariableNames = [
  "--color-scheme",
  "--app-bg",
  "--app-bg-gradient",
  "--grid-line",
  "--command-glass",
  "--command-glass-strong",
  "--glass-border",
  "--surface",
  "--surface-2",
  "--surface-3",
  "--surface-soft",
  "--border",
  "--border-strong",
  "--text",
  "--text-soft",
  "--muted",
  "--faint",
  "--accent",
  "--accent-strong",
  "--accent-muted",
  "--accent-ring",
  "--success",
  "--success-muted",
  "--warning",
  "--warning-muted",
  "--danger",
  "--reader",
  "--reader-text",
  "--reader-muted",
  "--reader-line",
  "--reader-panel",
  "--reader-accent",
  "--reader-font-scale",
  "--reader-line-height",
  "--reader-shadow",
  "--control-bg",
  "--control-bg-hover",
  "--code-bg",
  "--code-border",
  "--code-text",
  "--focus-ring",
  "--primary-border",
  "--primary-bg",
  "--shadow"
] as const;

export type ThemeVariable = (typeof themeVariableNames)[number];
export type ThemeId = "midnight" | "graphite" | "dawn" | "custom";
export type ThemeOverrides = Partial<Record<ThemeVariable, string>>;

export type ThemeDefinition = {
  id: Exclude<ThemeId, "custom">;
  label: string;
  description: string;
  variables: Record<ThemeVariable, string>;
};

export type CustomThemeField = {
  variable: ThemeVariable;
  label: string;
};

export const DEFAULT_THEME_ID: ThemeId = "midnight";

export const themePresets: ThemeDefinition[] = [
  {
    id: "midnight",
    label: "Midnight",
    description: "어두운 코드 리더",
    variables: {
      "--color-scheme": "dark",
      "--app-bg": "#080b10",
      "--app-bg-gradient": "linear-gradient(180deg, rgba(12, 15, 20, 0.96), #080b10)",
      "--grid-line": "rgba(114, 137, 160, 0.13)",
      "--command-glass": "rgba(18, 23, 31, 0.84)",
      "--command-glass-strong": "rgba(20, 26, 35, 0.96)",
      "--glass-border": "rgba(144, 166, 184, 0.24)",
      "--surface": "#111821",
      "--surface-2": "#17202b",
      "--surface-3": "#1d2935",
      "--surface-soft": "rgba(255, 255, 255, 0.045)",
      "--border": "#2c3a48",
      "--border-strong": "#46586a",
      "--text": "#edf4f7",
      "--text-soft": "#c9d6dd",
      "--muted": "#8d9aa6",
      "--faint": "#66737f",
      "--accent": "#3ed7e3",
      "--accent-strong": "#76f0f7",
      "--accent-muted": "rgba(62, 215, 227, 0.14)",
      "--accent-ring": "rgba(118, 240, 247, 0.72)",
      "--success": "#75d88f",
      "--success-muted": "rgba(117, 216, 143, 0.15)",
      "--warning": "#e7b65f",
      "--warning-muted": "rgba(231, 182, 95, 0.16)",
      "--danger": "#ff9cae",
      "--reader": "#121a24",
      "--reader-text": "#e9f1f5",
      "--reader-muted": "#a9b7c2",
      "--reader-line": "#334353",
      "--reader-panel": "rgba(255, 255, 255, 0.045)",
      "--reader-accent": "#76f0f7",
      "--reader-font-scale": "1",
      "--reader-line-height": "1.85",
      "--reader-shadow": "0 22px 48px rgba(0, 0, 0, 0.35), inset 10px 0 18px rgba(8, 13, 20, 0.22)",
      "--control-bg": "#0c1118",
      "--control-bg-hover": "rgba(255, 255, 255, 0.07)",
      "--code-bg": "#081018",
      "--code-border": "#202936",
      "--code-text": "#d8e6f2",
      "--focus-ring": "rgba(118, 240, 247, 0.72)",
      "--primary-border": "rgba(62, 215, 227, 0.56)",
      "--primary-bg": "linear-gradient(180deg, rgba(62, 215, 227, 0.28), rgba(62, 215, 227, 0.16))",
      "--shadow": "0 18px 42px rgba(0, 0, 0, 0.36)"
    }
  },
  {
    id: "graphite",
    label: "Graphite",
    description: "차분한 회색 작업대",
    variables: {
      "--color-scheme": "dark",
      "--app-bg": "#0d0f12",
      "--app-bg-gradient": "linear-gradient(180deg, rgba(21, 24, 27, 0.96), #0d0f12)",
      "--grid-line": "rgba(160, 166, 172, 0.12)",
      "--command-glass": "rgba(28, 31, 35, 0.86)",
      "--command-glass-strong": "rgba(31, 34, 38, 0.96)",
      "--glass-border": "rgba(175, 182, 188, 0.22)",
      "--surface": "#181b20",
      "--surface-2": "#20242a",
      "--surface-3": "#2a2f36",
      "--surface-soft": "rgba(255, 255, 255, 0.05)",
      "--border": "#343a42",
      "--border-strong": "#555d68",
      "--text": "#f0f3f5",
      "--text-soft": "#d0d6db",
      "--muted": "#9aa2aa",
      "--faint": "#727b84",
      "--accent": "#8ccfbd",
      "--accent-strong": "#b8eadc",
      "--accent-muted": "rgba(140, 207, 189, 0.14)",
      "--accent-ring": "rgba(184, 234, 220, 0.72)",
      "--success": "#91d39b",
      "--success-muted": "rgba(145, 211, 155, 0.15)",
      "--warning": "#d8bd74",
      "--warning-muted": "rgba(216, 189, 116, 0.16)",
      "--danger": "#f2a0a7",
      "--reader": "#171a1f",
      "--reader-text": "#eef2f4",
      "--reader-muted": "#b5bdc5",
      "--reader-line": "#3b424b",
      "--reader-panel": "rgba(255, 255, 255, 0.05)",
      "--reader-accent": "#b8eadc",
      "--reader-font-scale": "1",
      "--reader-line-height": "1.85",
      "--reader-shadow": "0 22px 48px rgba(0, 0, 0, 0.32), inset 10px 0 18px rgba(0, 0, 0, 0.18)",
      "--control-bg": "#101318",
      "--control-bg-hover": "rgba(255, 255, 255, 0.075)",
      "--code-bg": "#0c0f13",
      "--code-border": "#272d34",
      "--code-text": "#e1e6eb",
      "--focus-ring": "rgba(184, 234, 220, 0.72)",
      "--primary-border": "rgba(140, 207, 189, 0.56)",
      "--primary-bg": "linear-gradient(180deg, rgba(140, 207, 189, 0.25), rgba(140, 207, 189, 0.14))",
      "--shadow": "0 18px 42px rgba(0, 0, 0, 0.34)"
    }
  },
  {
    id: "dawn",
    label: "Dawn",
    description: "밝은 워크벤치",
    variables: {
      "--color-scheme": "light",
      "--app-bg": "#eef3f4",
      "--app-bg-gradient": "linear-gradient(180deg, rgba(246, 249, 249, 0.98), #eef3f4)",
      "--grid-line": "rgba(65, 86, 104, 0.11)",
      "--command-glass": "rgba(248, 251, 251, 0.86)",
      "--command-glass-strong": "rgba(250, 252, 252, 0.96)",
      "--glass-border": "rgba(78, 96, 112, 0.2)",
      "--surface": "#ffffff",
      "--surface-2": "#f6f9fa",
      "--surface-3": "#eaf0f2",
      "--surface-soft": "rgba(37, 50, 62, 0.045)",
      "--border": "#d2dee2",
      "--border-strong": "#b2c2c8",
      "--text": "#172028",
      "--text-soft": "#334350",
      "--muted": "#657582",
      "--faint": "#81909b",
      "--accent": "#0f8f9c",
      "--accent-strong": "#086a74",
      "--accent-muted": "rgba(15, 143, 156, 0.12)",
      "--accent-ring": "rgba(15, 143, 156, 0.45)",
      "--success": "#3a8f58",
      "--success-muted": "rgba(58, 143, 88, 0.13)",
      "--warning": "#a86f1b",
      "--warning-muted": "rgba(168, 111, 27, 0.13)",
      "--danger": "#b84050",
      "--reader": "#f8fbfb",
      "--reader-text": "#172028",
      "--reader-muted": "#4d5f6b",
      "--reader-line": "#d2dee2",
      "--reader-panel": "rgba(15, 32, 40, 0.045)",
      "--reader-accent": "#076f7b",
      "--reader-font-scale": "1",
      "--reader-line-height": "1.85",
      "--reader-shadow": "0 22px 46px rgba(41, 58, 72, 0.16), inset 10px 0 18px rgba(23, 32, 40, 0.04)",
      "--control-bg": "#f6f9fa",
      "--control-bg-hover": "rgba(15, 32, 40, 0.06)",
      "--code-bg": "#101820",
      "--code-border": "#263544",
      "--code-text": "#e6f0f4",
      "--focus-ring": "rgba(15, 143, 156, 0.48)",
      "--primary-border": "rgba(15, 143, 156, 0.38)",
      "--primary-bg": "linear-gradient(180deg, rgba(15, 143, 156, 0.14), rgba(15, 143, 156, 0.08))",
      "--shadow": "0 18px 42px rgba(42, 58, 72, 0.16)"
    }
  }
];

export const customThemeFields: CustomThemeField[] = [
  { variable: "--app-bg", label: "배경" },
  { variable: "--surface", label: "표면" },
  { variable: "--accent", label: "강조" },
  { variable: "--accent-strong", label: "강조 텍스트" },
  { variable: "--reader", label: "본문 배경" },
  { variable: "--reader-text", label: "본문 글자" }
];

const themeIds = new Set<ThemeId>(["midnight", "graphite", "dawn", "custom"]);

export function normalizeThemeId(value: unknown): ThemeId {
  return typeof value === "string" && themeIds.has(value as ThemeId) ? (value as ThemeId) : DEFAULT_THEME_ID;
}

export function getThemePreset(themeId: ThemeId): ThemeDefinition {
  return themePresets.find((theme) => theme.id === themeId) ?? themePresets[0];
}

export function normalizeThemeOverrides(value: unknown): ThemeOverrides {
  if (!value || typeof value !== "object") return {};
  const validVariables = new Set<string>(themeVariableNames);
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      ([key, entry]) => validVariables.has(key) && typeof entry === "string" && entry.length > 0 && entry.length < 120
    )
  ) as ThemeOverrides;
}

export function themeVariablesFor(themeId: ThemeId, customThemeOverrides: ThemeOverrides = {}): Record<ThemeVariable, string> {
  const baseTheme = getThemePreset(themeId === "custom" ? DEFAULT_THEME_ID : themeId);
  return {
    ...baseTheme.variables,
    ...(themeId === "custom" ? normalizeThemeOverrides(customThemeOverrides) : {})
  };
}

export function themeStyleFor(themeId: ThemeId, customThemeOverrides: ThemeOverrides = {}) {
  return themeVariablesFor(themeId, customThemeOverrides) as Record<string, string>;
}

export function colorInputValue(value: string, fallback = "#3ed7e3") {
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}

export function numericInputValue(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

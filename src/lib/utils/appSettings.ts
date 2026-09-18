/**
 * The rules of the viewer's settings, as data: what each app theme
 * setting means and which one the header toggle goes to next, which
 * editor theme Monaco gets, and which stored values are read back.
 */
import { MONACO_THEMES, type AppSettings, type MonacoTheme, type Theme } from '../types';

export type ThemeSetting = AppSettings['theme'];

/**
 * Every app theme setting, in the order the header toggle steps through
 * them: each click goes to `next`, so "system" can be chosen again.
 */
export const THEME_SETTINGS: Record<ThemeSetting, { label: string; next: ThemeSetting }> = {
  system: { label: 'System', next: 'light' },
  light: { label: 'Light', next: 'dark' },
  dark: { label: 'Dark', next: 'system' },
};

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  sidebarWidth: 280,
  monacoTheme: 'vs',
};

/** The setting the header toggle goes to from `current`. */
export function nextThemeSetting(current: ThemeSetting): ThemeSetting {
  return THEME_SETTINGS[current].next;
}

/** The theme a setting shows: "system" follows the operating system's preference. */
export function resolveTheme(setting: ThemeSetting, prefersDark: boolean): Theme {
  if (setting === 'system') return prefersDark ? 'dark' : 'light';
  return setting;
}

/**
 * The Monaco theme to apply. An editor theme whose base is "app" is
 * Monaco's light or dark VS theme, whichever matches the app; any other
 * is applied as it is.
 */
export function editorThemeFor(monacoTheme: MonacoTheme, appTheme: Theme): string {
  const entry = MONACO_THEMES.find((t) => t.id === monacoTheme);
  if (!entry || entry.base === 'app') return appTheme === 'dark' ? 'vs-dark' : 'vs';
  return monacoTheme;
}

/** Whether a stored value is a valid value of each setting. */
const IS_VALID: { [K in keyof AppSettings]: (value: unknown) => value is AppSettings[K] } = {
  theme: (value): value is ThemeSetting =>
    typeof value === 'string' && Object.prototype.hasOwnProperty.call(THEME_SETTINGS, value),
  sidebarWidth: (value): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value > 0,
  monacoTheme: (value): value is MonacoTheme => MONACO_THEMES.some((t) => t.id === value),
};

/**
 * Settings read back from storage. Each known setting keeps its stored
 * value when that value is valid and takes its default otherwise; keys
 * of settings that no longer exist are dropped.
 */
export function parseSettings(stored: unknown): AppSettings {
  const record =
    typeof stored === 'object' && stored !== null && !Array.isArray(stored)
      ? (stored as Record<string, unknown>)
      : {};
  const settings = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(IS_VALID) as (keyof AppSettings)[]) {
    const value = record[key];
    if (IS_VALID[key](value)) (settings as Record<keyof AppSettings, unknown>)[key] = value;
  }
  return settings;
}

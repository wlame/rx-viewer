import { writable, derived } from 'svelte/store';
import type { AppSettings, Theme } from '../types';
import { DEFAULT_SETTINGS, parseSettings, resolveTheme } from '../utils/appSettings';

const STORAGE_KEY = 'rx-settings';

/**
 * localStorage, or null where the browser refuses it. With site data
 * blocked, even reading the property throws, and the settings load with
 * the app's first modules, where a throw leaves a blank page.
 */
function settingsStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** The stored settings, or the defaults when nothing valid is stored or storage is refused. */
function loadSettings(): AppSettings {
  try {
    const stored = settingsStorage()?.getItem(STORAGE_KEY);
    return stored ? parseSettings(JSON.parse(stored)) : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** Keeps the settings for the next visit; where storage is refused they last for this page. */
function saveSettings(value: AppSettings): void {
  try {
    settingsStorage()?.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch (e) {
    console.warn('Settings could not be saved and last for this page only:', e);
  }
}

function createSettingsStore() {
  const { subscribe, update } = writable<AppSettings>(loadSettings());

  return {
    subscribe,
    update(updater: (settings: AppSettings) => AppSettings) {
      update((current) => {
        const updated = updater(current);
        saveSettings(updated);
        return updated;
      });
    },
  };
}

export const settings = createSettingsStore();

/** Whether the operating system asks for a dark theme. */
function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/**
 * The theme the operating system shows. Read again whenever the settings
 * change, which the system's change listener below triggers.
 */
export const systemTheme = derived(settings, (): Theme =>
  resolveTheme('system', systemPrefersDark()),
);

// Derived store for actual theme (resolves 'system' to 'light' or 'dark')
export const resolvedTheme = derived(settings, ($settings): Theme =>
  resolveTheme($settings.theme, systemPrefersDark()),
);

// Apply theme to document
if (typeof window !== 'undefined') {
  resolvedTheme.subscribe((theme) => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  });

  // Listen for system theme changes
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    settings.update((s) => ({ ...s })); // Trigger re-evaluation
  });
}

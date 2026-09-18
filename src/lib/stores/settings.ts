import { writable, derived } from 'svelte/store';
import type { AppSettings, Theme } from '../types';
import { DEFAULT_SETTINGS, parseSettings, resolveTheme } from '../utils/appSettings';

const STORAGE_KEY = 'rx-settings';

function loadSettings(): AppSettings {
  if (typeof localStorage === 'undefined') return DEFAULT_SETTINGS;
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return DEFAULT_SETTINGS;
  try {
    return parseSettings(JSON.parse(stored));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function createSettingsStore() {
  const { subscribe, set, update } = writable<AppSettings>(loadSettings());

  return {
    subscribe,
    set(value: AppSettings) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
      set(value);
    },
    update(updater: (settings: AppSettings) => AppSettings) {
      update((current) => {
        const updated = updater(current);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
        return updated;
      });
    },
    reset() {
      localStorage.removeItem(STORAGE_KEY);
      set(DEFAULT_SETTINGS);
    },
  };
}

export const settings = createSettingsStore();

// Derived store for actual theme (resolves 'system' to 'light' or 'dark')
export const resolvedTheme = derived(settings, ($settings): Theme => {
  const prefersDark =
    typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
  return resolveTheme($settings.theme, prefersDark);
});

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

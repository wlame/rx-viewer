import { afterEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { DEFAULT_SETTINGS } from '../utils/appSettings';

/** Makes every use of `localStorage` throw, as a browser that blocks site data does. */
function blockStorage() {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    },
  });
}

describe('settings', () => {
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
    vi.resetModules();
  });

  // The store loads with the app's first modules; a throw there leaves a
  // blank page.
  it('loads with the defaults when storage is refused', async () => {
    blockStorage();

    const { settings } = await import('./settings');

    expect(get(settings)).toEqual(DEFAULT_SETTINGS);
  });

  it('reads the chain mode chosen last back', async () => {
    const stored = JSON.stringify({ ...DEFAULT_SETTINGS, chainMode: true });
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { getItem: () => stored, setItem: () => {} },
    });

    const { settings } = await import('./settings');

    expect(get(settings).chainMode).toBe(true);
  });

  it('keeps a change for the page when storage refuses to save it', async () => {
    blockStorage();
    const { settings } = await import('./settings');

    settings.update((s) => ({ ...s, theme: 'dark' }));

    expect(get(settings).theme).toBe('dark');
  });
});

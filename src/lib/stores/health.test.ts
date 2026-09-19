import { afterEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

/** A `fetch` that answers `/health` for a backend on `contractVersion`. */
function serveHealth(contractVersion = '1.3') {
  const spy = vi.fn(async (_url: string) => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({ status: 'ok', contract_version: contractVersion }),
    text: async () => '',
  }));
  vi.stubGlobal('fetch', spy);
  return spy;
}

/** The globals a browser tab gives the store when it loads. */
function stubBrowser() {
  const stored = new Map<string, string>();
  vi.stubGlobal('window', {});
  vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh) Chrome/140' });
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
  });
}

describe('health', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  // No backend reads a client parameter, so the request carries none.
  it('asks /health with no query in a browser tab', async () => {
    stubBrowser();
    const fetchSpy = serveHealth();
    const { health } = await import('./health');

    await health.check();

    expect(fetchSpy.mock.calls[0][0]).toBe('/health');
  });

  // The cover over the app and the window-wide shortcuts read this.
  it.each([
    ['2.0', true],
    ['1.3', false],
  ])('says the contract is refused for a backend on %s: %s', async (version, refused) => {
    serveHealth(version);
    const { contractRefused, health } = await import('./health');

    await health.check();

    expect(get(contractRefused)).toBe(refused);
  });
});

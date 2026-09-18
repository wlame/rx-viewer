import { afterEach, describe, expect, it, vi } from 'vitest';

/** A `fetch` that answers `/health` for a backend on contract 1.3. */
function serveHealth() {
  const spy = vi.fn(async (_url: string) => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({ status: 'ok', contract_version: '1.3' }),
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
});

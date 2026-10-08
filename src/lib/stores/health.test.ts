import { afterEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

/**
 * A `fetch` that answers `/health` for a backend on `contractVersion`,
 * listing `features` when given and leaving the key out when not.
 */
function serveHealth(contractVersion = '1.3', features?: unknown) {
  const spy = vi.fn(async (_url: string) => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({
      status: 'ok',
      contract_version: contractVersion,
      ...(features === undefined ? {} : { features }),
    }),
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

describe('backendHas', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('says a feature the backend lists is there and one it does not list is absent', async () => {
    serveHealth('1.5', ['time_range', 'trace_matching_flags']);
    const { backendHas, health } = await import('./health');

    await health.check();

    expect(backendHas('time_range')).toBe(true);
    expect(backendHas('trace_matching_flags')).toBe(true);
    expect(backendHas('samples_index_build')).toBe(false);
  });

  // Every chain feature of the viewer asks for log_chains first.
  it('says whether the backend serves log chains', async () => {
    serveHealth('1.7', ['time_range', 'log_chains']);
    const { backendHas, health } = await import('./health');

    await health.check();

    expect(backendHas('log_chains')).toBe(true);
    expect(backendHas('log_chains', { features: ['time_range'] })).toBe(false);
  });

  it('reads the state it is given, so a component can pass $health', async () => {
    serveHealth('1.5', ['samples_index_build']);
    const { backendHas, health } = await import('./health');

    await health.check();

    expect(backendHas('samples_index_build', get(health))).toBe(true);
    expect(backendHas('time_range', get(health))).toBe(false);
  });

  it.each([
    ['leaves out the features key', undefined],
    ['sends features that are not a list', 'time_range'],
  ])('reads every feature as absent from a backend that %s', async (_name, features) => {
    serveHealth('1.5', features);
    const { backendHas, health } = await import('./health');

    await health.check();

    expect(backendHas('time_range')).toBe(false);
    expect(backendHas('trace_matching_flags')).toBe(false);
  });

  it('reads every feature as absent before /health answers and after it fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const { backendHas, health } = await import('./health');

    expect(backendHas('time_range')).toBe(false);
    await health.check();

    expect(get(health).connected).toBe(false);
    expect(backendHas('time_range')).toBe(false);
  });
});

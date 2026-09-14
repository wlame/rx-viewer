import { afterEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { api } from './api';
import { contractGate } from './contractGate';
import { BLOCKED_RECHECK_MS, health } from './stores/health';
import { isAbortError } from './utils/latestRequest';

/**
 * A backend whose `/health` reports `contractVersion` (changeable later)
 * and whose `/v1/tree` answers an empty tree. Every requested path is
 * recorded.
 */
function stubBackend(contractVersion: string) {
  const backend = { contractVersion, paths: [] as string[] };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const path = new URL(url, 'http://localhost').pathname;
      backend.paths.push(path);
      const body =
        path === '/health'
          ? { status: 'ok', contract_version: backend.contractVersion, app_version: 'test' }
          : { path: '/var/log', entries: [] };
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => body,
        text: async () => JSON.stringify(body),
      };
    }),
  );
  return backend;
}

const v1Paths = (paths: string[]) => paths.filter((p) => p.startsWith('/v1'));

/** Let pending promises run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('a backend on an unsupported contract major', () => {
  afterEach(() => {
    contractGate.reset();
    vi.unstubAllGlobals();
  });

  it('is refused: the health store says so and no /v1 request goes out', async () => {
    const backend = stubBackend('2.0');

    await health.check();
    const tree = api.getTree();
    await settle();

    expect(get(health).contract.kind).toBe('incompatible');
    expect(v1Paths(backend.paths)).toEqual([]);
    void tree;
  });

  it('lets the held requests go once the backend reports a supported contract', async () => {
    const backend = stubBackend('2.0');
    await health.check();
    const tree = api.getTree();
    await settle();

    backend.contractVersion = '1.3';
    await health.check();
    await tree;

    expect(get(health).contract.kind).toBe('ok');
    expect(v1Paths(backend.paths)).toEqual(['/v1/tree']);
  });

  it('holds a request made before the first health answer until that answer', async () => {
    const backend = stubBackend('2.0');
    contractGate.hold();

    void api.getTree();
    await settle();
    expect(backend.paths).toEqual([]);

    await health.check();
    await settle();
    expect(v1Paths(backend.paths)).toEqual([]);
  });

  it('rejects a held request with an AbortError when its signal is aborted', async () => {
    stubBackend('2.0');
    await health.check();
    const controller = new AbortController();

    const tree = api.getTree(undefined, { signal: controller.signal });
    controller.abort();

    await expect(tree).rejects.toSatisfy(isAbortError);
  });

  it('checks /health again soon while blocked, so the message clears on its own', async () => {
    vi.useFakeTimers();
    try {
      const backend = stubBackend('2.0');
      health.startPolling();
      await vi.advanceTimersByTimeAsync(0);
      const checksBefore = backend.paths.filter((p) => p === '/health').length;

      backend.contractVersion = '1.3';
      await vi.advanceTimersByTimeAsync(BLOCKED_RECHECK_MS);

      expect(backend.paths.filter((p) => p === '/health').length).toBeGreaterThan(checksBefore);
      expect(get(health).contract.kind).toBe('ok');
    } finally {
      health.stopPolling();
      vi.useRealTimers();
    }
  });

  it('lets requests through when /health fails, since nothing is known', async () => {
    const backend = stubBackend('1.3');
    contractGate.hold();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        backend.paths.push(new URL(url, 'http://localhost').pathname);
        if (url.startsWith('/health')) throw new TypeError('Failed to fetch');
        return { ok: true, status: 200, statusText: 'OK', json: async () => ({}) };
      }),
    );

    await health.check();
    await api.getTree();

    expect(v1Paths(backend.paths)).toEqual(['/v1/tree']);
  });
});

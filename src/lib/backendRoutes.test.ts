import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './api';
import { devProxy } from './backendRoutes';

const TARGET = 'http://localhost:8080';

/** Records the path of every request and answers each with `{}`. */
function recordRequests() {
  const paths: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      paths.push(new URL(url, 'http://localhost').pathname);
      return { ok: true, status: 200, statusText: 'OK', json: async () => ({}) };
    }),
  );
  return paths;
}

describe('devProxy', () => {
  afterEach(() => vi.unstubAllGlobals());

  // Without /health the dev server answers it with the app's own page,
  // the viewer reads that as a dead backend and disables the search toggles.
  it('forwards /health and /v1 to the backend', () => {
    const proxy = devProxy(TARGET);

    expect(proxy['/health']).toEqual({ target: TARGET, changeOrigin: true });
    expect(proxy['/v1']).toEqual({ target: TARGET, changeOrigin: true });
  });

  it('forwards every path the API client requests', async () => {
    const paths = recordRequests();
    await api.getHealth('client-1');
    await api.getTree();
    await api.getDetectors();

    const prefixes = Object.keys(devProxy(TARGET));
    for (const path of paths) {
      expect(prefixes.some((prefix) => path.startsWith(prefix))).toBe(true);
    }
  });
});

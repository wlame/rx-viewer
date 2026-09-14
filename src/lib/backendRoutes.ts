/**
 * The paths the viewer requests from its backend.
 *
 * In production the backend serves the viewer, so every path reaches it.
 * In `just dev` the Vite dev server serves the viewer, and only the
 * prefixes listed here are forwarded to the backend; anything else is
 * answered by the dev server itself. `vite.config.ts` builds its proxy
 * from `devProxy`, so a new backend path is added here once.
 */

/** Every versioned endpoint. */
export const API_BASE = '/v1';

/** The unversioned liveness and contract check. */
export const HEALTH_PATH = '/health';

/** The prefixes the dev server forwards to the backend. */
export const BACKEND_PATH_PREFIXES = [API_BASE, HEALTH_PATH] as const;

/** One proxy rule, in the shape Vite's `server.proxy` takes. */
export interface ProxyRule {
  target: string;
  changeOrigin: boolean;
}

/** The dev server's proxy: every backend prefix to `target`. */
export function devProxy(target: string): Record<string, ProxyRule> {
  return Object.fromEntries(
    BACKEND_PATH_PREFIXES.map((prefix) => [prefix, { target, changeOrigin: true }]),
  );
}

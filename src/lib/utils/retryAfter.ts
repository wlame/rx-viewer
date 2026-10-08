/**
 * How long to wait before asking again a backend that answered 503
 * (busy) with a `Retry-After` header: a number of seconds or an HTTP
 * date. A missing or unreadable header waits a few seconds; every wait is
 * at least a second and at most a minute, so a header cannot make the
 * viewer ask in a tight loop or never again.
 */

/** The wait without a header, or with one that is not a number of seconds or a date. */
export const DEFAULT_RETRY_MS = 5000;

const MIN_RETRY_MS = 1000;
export const MAX_RETRY_MS = 60_000;

/** Whole seconds, as `Retry-After: 5` gives them. */
const SECONDS = /^\d+$/;

/** The milliseconds to wait for the `Retry-After` value `header` at `nowMs`. */
export function retryAfterMs(header: string | null, nowMs: number): number {
  const value = header?.trim() ?? '';
  let wait: number | null = null;
  if (SECONDS.test(value)) {
    wait = Number(value) * 1000;
  } else if (value !== '' && !/^[-+]?\d/.test(value)) {
    const date = Date.parse(value);
    if (!Number.isNaN(date)) wait = date - nowMs;
  }
  if (wait === null) return DEFAULT_RETRY_MS;
  return Math.min(MAX_RETRY_MS, Math.max(MIN_RETRY_MS, wait));
}

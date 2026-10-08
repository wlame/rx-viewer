import { describe, expect, it } from 'vitest';
import { DEFAULT_RETRY_MS, MAX_RETRY_MS, retryAfterMs } from './retryAfter';

describe('retryAfterMs', () => {
  const NOW = Date.UTC(2026, 9, 8, 12, 0, 0);

  it('reads a number of seconds', () => {
    expect(retryAfterMs('5', NOW)).toBe(5000);
  });

  it('reads an HTTP date as the time until it', () => {
    expect(retryAfterMs(new Date(NOW + 12_000).toUTCString(), NOW)).toBe(12_000);
  });

  it('waits at least a second and at most a minute', () => {
    expect(retryAfterMs('0', NOW)).toBe(1000);
    expect(retryAfterMs(new Date(NOW - 60_000).toUTCString(), NOW)).toBe(1000);
    expect(retryAfterMs('86400', NOW)).toBe(MAX_RETRY_MS);
  });

  it('waits a few seconds without the header or for a value it cannot read', () => {
    expect(retryAfterMs(null, NOW)).toBe(DEFAULT_RETRY_MS);
    expect(retryAfterMs('soon', NOW)).toBe(DEFAULT_RETRY_MS);
    expect(retryAfterMs('-3', NOW)).toBe(DEFAULT_RETRY_MS);
  });
});

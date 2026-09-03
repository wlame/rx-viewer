import { describe, it, expect, vi, afterEach } from 'vitest';
import { formatSize, formatRelativeTime, formatNumber, truncatePath } from './format';

describe('formatSize', () => {
  it.each([
    [0, '0 B'],
    [1, '1 B'],
    [1023, '1023 B'],
    [1024, '1.0 KB'],
    [1536, '1.5 KB'],
    [1048576, '1.0 MB'],
    [1073741824, '1.0 GB'],
    [1099511627776, '1.0 TB'],
  ])('formats %i bytes as %s', (bytes, expected) => {
    expect(formatSize(bytes)).toBe(expected);
  });

  it('shows no decimal for whole bytes but one above', () => {
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(2048)).toBe('2.0 KB');
  });

  it('stops at TB rather than inventing a unit', () => {
    // rx is pointed at log archives; a petabyte-scale path is not absurd.
    expect(formatSize(1024 ** 5)).toBe('1024.0 TB');
  });
});

describe('formatRelativeTime', () => {
  afterEach(() => vi.useRealTimers());

  function at(now: string, then: string): string {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));
    return formatRelativeTime(then);
  }

  it('says "just now" under a minute', () => {
    expect(at('2026-09-03T12:00:00Z', '2026-09-03T11:59:30Z')).toBe('just now');
  });

  it('counts whole minutes under an hour', () => {
    expect(at('2026-09-03T12:00:00Z', '2026-09-03T11:15:00Z')).toBe('45m ago');
  });

  it('counts whole hours under a day', () => {
    expect(at('2026-09-03T12:00:00Z', '2026-09-03T04:00:00Z')).toBe('8h ago');
  });

  it('counts whole days under a week', () => {
    expect(at('2026-09-03T12:00:00Z', '2026-08-31T12:00:00Z')).toBe('3d ago');
  });

  it('falls back to a date past a week', () => {
    const out = at('2026-09-03T12:00:00Z', '2026-01-01T12:00:00Z');
    expect(out).not.toMatch(/ago|just now/);
  });

  it('does not report a future timestamp as an age', () => {
    expect(at('2026-09-03T12:00:00Z', '2026-09-03T12:00:30Z')).toBe('just now');
  });
});

describe('formatNumber', () => {
  it('groups thousands', () => {
    expect(formatNumber(1234567)).toBe((1234567).toLocaleString());
  });

  it('leaves small numbers alone', () => {
    expect(formatNumber(42)).toBe('42');
  });
});

describe('truncatePath', () => {
  it('returns a short path unchanged', () => {
    expect(truncatePath('/var/log/app.log')).toBe('/var/log/app.log');
  });

  it('keeps the last three segments by default', () => {
    expect(truncatePath('/a/b/c/d/e/f.log')).toBe('.../d/e/f.log');
  });

  it('honours an explicit segment count', () => {
    expect(truncatePath('/a/b/c/d/e/f.log', 2)).toBe('.../e/f.log');
  });

  it('ignores the empty segments a leading or double slash creates', () => {
    expect(truncatePath('//a//b//c.log')).toBe('//a//b//c.log');
  });

  it('handles a relative path', () => {
    expect(truncatePath('a/b/c/d.log')).toBe('.../b/c/d.log');
  });
});

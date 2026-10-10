import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import {
  formatSize,
  formatNumber,
  formatCount,
  formatFileTime,
  formatServerTime,
  formatStatistic,
} from './format';

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

describe('formatNumber', () => {
  it('groups thousands', () => {
    expect(formatNumber(1234567)).toBe((1234567).toLocaleString());
  });

  it('leaves small numbers alone', () => {
    expect(formatNumber(42)).toBe('42');
  });
});

describe('formatCount', () => {
  it.each([
    [0, 'file', undefined, '0 files'],
    [1, 'file', undefined, '1 file'],
    [2, 'file', undefined, '2 files'],
    [1, 'match', 'matches', '1 match'],
    [2461, 'match', 'matches', '2,461 matches'],
  ])('formats %i with %s (plural %s) as %s', (count, singular, plural, expected) => {
    expect(formatCount(count, singular, plural)).toBe(expected);
  });
});

describe('formatStatistic', () => {
  it.each([
    [42.25, '42.3'],
    [0, '0.0'],
    [1234.5, '1234.5'],
  ])('formats %d with one decimal as %s', (value, expected) => {
    expect(formatStatistic(value)).toBe(expected);
  });

  // The backend leaves a statistic null when it cannot compute it, for
  // example the spread of a file with no lines.
  it('shows a dash for a statistic the backend left null', () => {
    expect(formatStatistic(null)).toBe('—');
  });
});

describe('formatServerTime', () => {
  // rx-go writes UTC with a Z: the browser can show it in its own zone.
  it('shows a time with a zone in the browser zone', () => {
    const value = '2026-10-03T02:01:16.953961Z';
    expect(formatServerTime(value)).toBe(new Date(value).toLocaleString());
  });

  it.each(['2026-10-03T04:01:16+02:00', '2026-10-03T02:01:16-0000'])(
    'reads the offset of %s',
    (value) => {
      expect(formatServerTime(value)).toBe(new Date(value).toLocaleString());
    },
  );

  // rx-python writes the server's local time without a zone; the
  // browser cannot know that zone, so the time is shown as written.
  it('shows a time without a zone as the server wrote it', () => {
    expect(formatServerTime('2026-10-03T04:01:16.953961')).toBe(
      '2026-10-03 04:01:16 (server time)',
    );
  });

  it('shows text that is not a time unchanged', () => {
    expect(formatServerTime('yesterday')).toBe('yesterday');
  });
});

// The browser's zone is the process's here: `TZ` set at run time moves
// every local time of the dates made after it.
describe('formatFileTime', () => {
  const zoneBefore = process.env.TZ;
  const NOW = new Date('2026-06-01T12:00:00Z');

  function useZone(zone: string) {
    process.env.TZ = zone;
  }

  beforeEach(() => useZone('Europe/Berlin'));

  afterEach(() => {
    if (zoneBefore === undefined) delete process.env.TZ;
    else process.env.TZ = zoneBefore;
  });

  it('runs in the zone the test sets', () => {
    expect(new Date('2026-10-08T12:31:07Z').getTimezoneOffset()).toBe(-120);
  });

  it('shows a time of this year as month, day and minute, and the full time with its offset', () => {
    expect(formatFileTime('2026-10-08T12:31:07.123456Z', NOW)).toEqual({
      text: 'Oct 8 14:31',
      full: '2026-10-08 14:31:07 +02:00',
    });
  });

  it('shows a time of another year as its date', () => {
    expect(formatFileTime('2025-12-27T09:05:00.000000Z', NOW)).toEqual({
      text: '2025-12-27',
      full: '2025-12-27 10:05:00 +01:00',
    });
  });

  it("judges the year in the browser's zone", () => {
    expect(formatFileTime('2025-12-31T23:30:00Z', NOW).text).toBe('Jan 1 00:30');
  });

  it('writes an offset west of UTC with its minutes', () => {
    useZone('America/St_Johns');

    expect(formatFileTime('2026-10-08T12:31:07Z', NOW).full).toBe('2026-10-08 10:01:07 -02:30');
  });

  it.each(['', 'yesterday', '2026-13-45T99:00:00Z'])('shows nothing for %j', (value) => {
    expect(formatFileTime(value, NOW)).toEqual({ text: '', full: '' });
  });
});

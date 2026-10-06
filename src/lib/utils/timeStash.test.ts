import { describe, expect, it } from 'vitest';
import type { TimeRangeResponse } from '../types';
import {
  STASH_CAPACITY,
  STASH_REFUSALS,
  addToStash,
  normalizeStash,
  removeFromStash,
  stashAddRefusal,
  stashEntryState,
  type StashFile,
} from './timeStash';

/** 2025-12-10 07:00:00 UTC, the start of the playground's hour. */
const HOUR_START = Date.UTC(2025, 11, 10, 7, 0, 0);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

function range(firstMs: number | null, lastMs: number | null, format: string | null = 'iso') {
  return {
    path: 'x',
    format,
    has_zone: false,
    day_first: null,
    display_zone: 'UTC',
    example: format ? '2025-12-10 07:00:04.574' : null,
    first_ms: firstMs,
    last_ms: lastMs,
    source: 'scan',
    cli_command: 'rx time-range x',
  } as TimeRangeResponse;
}

function fileWith(name: string, timeRange: TimeRangeResponse | null): StashFile {
  return { name, timeRange };
}

/** Eight instants a minute apart, from the hour's start. */
const MINUTES = Array.from({ length: 8 }, (_, i) => HOUR_START + i * MINUTE);

describe('addToStash', () => {
  it('adds an instant in time order', () => {
    const first = addToStash([], MINUTES[2]);
    const second = addToStash(first.stash, MINUTES[0]);

    expect(first.outcome).toBe('added');
    expect(second).toEqual({ outcome: 'added', stash: [MINUTES[0], MINUTES[2]] });
  });

  it('refuses an instant the stash holds to the millisecond, and takes one a millisecond apart', () => {
    const stash = [MINUTES[0]];

    expect(addToStash(stash, MINUTES[0])).toEqual({ outcome: 'duplicate', stash });
    expect(addToStash(stash, MINUTES[0] + 1).stash).toEqual([MINUTES[0], MINUTES[0] + 1]);
  });

  it('refuses an eighth instant', () => {
    const full = MINUTES.slice(0, STASH_CAPACITY);

    expect(STASH_CAPACITY).toBe(7);
    expect(addToStash(full, MINUTES[7])).toEqual({ outcome: 'full', stash: full });
  });

  it('calls a duplicate in a full stash a duplicate', () => {
    const full = MINUTES.slice(0, STASH_CAPACITY);

    expect(addToStash(full, MINUTES[3]).outcome).toBe('duplicate');
  });
});

describe('removeFromStash', () => {
  it('removes the instant and keeps the order of the rest', () => {
    expect(removeFromStash([MINUTES[0], MINUTES[1], MINUTES[2]], MINUTES[1])).toEqual([
      MINUTES[0],
      MINUTES[2],
    ]);
  });

  it('leaves the stash as it is for an instant it does not hold', () => {
    expect(removeFromStash([MINUTES[0]], MINUTES[1])).toEqual([MINUTES[0]]);
  });
});

describe('stashAddRefusal', () => {
  it('names why an instant cannot be added, and nothing when it can', () => {
    const full = MINUTES.slice(0, STASH_CAPACITY);

    expect(stashAddRefusal([MINUTES[0]], MINUTES[1])).toBeNull();
    expect(stashAddRefusal([MINUTES[0]], MINUTES[0])).toBe('duplicate');
    expect(stashAddRefusal(full, MINUTES[7])).toBe('full');
  });

  it('has a message for each refusal', () => {
    expect(STASH_REFUSALS).toEqual({
      duplicate: 'The stash holds this time already',
      full: 'The stash is full: it keeps 7 moments. Remove one to add another',
    });
  });
});

describe('normalizeStash', () => {
  it('sorts, drops duplicates and keeps the seven earliest', () => {
    const shuffled = [MINUTES[7], MINUTES[1], MINUTES[1], ...MINUTES.slice(2, 7), MINUTES[0]];

    expect(normalizeStash(shuffled)).toEqual(MINUTES.slice(0, 7));
  });

  it('drops a value that is not a whole millisecond', () => {
    expect(normalizeStash([Number.NaN, Infinity, 1.5, MINUTES[0]])).toEqual([MINUTES[0]]);
  });
});

describe('stashEntryState', () => {
  const middleware = fileWith('middleware.log', range(HOUR_START + 4_574, HOUR_START + HOUR));

  it('enables an instant inside the range, its first and its last time included', () => {
    for (const ms of [HOUR_START + 4_574, HOUR_START + 30 * MINUTE, HOUR_START + HOUR]) {
      expect(stashEntryState(ms, middleware, true)).toEqual({ isEnabled: true });
    }
  });

  it.each([
    {
      case: 'an instant before the first time',
      ms: HOUR_START + 4_573,
      file: middleware,
      reason: 'Before the first time in middleware.log',
    },
    {
      case: 'an instant after the last time',
      ms: HOUR_START + HOUR + 1,
      file: middleware,
      reason: 'After the last time in middleware.log',
    },
    {
      case: 'a file without timestamps',
      ms: HOUR_START,
      file: fileWith('logs_stat.txt', range(null, null, null)),
      reason: 'logs_stat.txt has no timestamps',
    },
    {
      case: 'a file whose range was not read yet',
      ms: HOUR_START,
      file: fileWith('new.log', null),
      reason: 'The time range of new.log is not known yet',
    },
    {
      case: 'a file with a format and no first or last time',
      ms: HOUR_START,
      file: fileWith('core.log.gz', range(null, null)),
      reason: 'The time range of core.log.gz is not known yet',
    },
    {
      case: 'no open file',
      ms: HOUR_START,
      file: undefined,
      reason: 'Open a file to go to this time',
    },
  ])('disables $case and says why', ({ ms, file, reason }) => {
    expect(stashEntryState(ms, file, true)).toEqual({ isEnabled: false, reason });
  });

  it('disables every instant for a backend that cannot jump by time', () => {
    expect(stashEntryState(HOUR_START + 30 * MINUTE, middleware, false)).toEqual({
      isEnabled: false,
      reason: 'The backend cannot jump to a time',
    });
  });
});

import { describe, expect, it } from 'vitest';
import type { TimeRangeResponse } from '../types';
import { followsCursor, type CursorFollower, type TimeCursor } from './timeCursor';

const CURSOR_MS = Date.UTC(2025, 11, 10, 7, 30, 0);

function range(format: string | null): TimeRangeResponse {
  return {
    path: '/logs/b.log',
    format,
    has_zone: false,
    day_first: null,
    display_zone: 'UTC',
    example: format ? '2025-12-10 07:00:04.574' : null,
    first_ms: format ? CURSOR_MS - 60_000 : null,
    last_ms: format ? CURSOR_MS + 60_000 : null,
    source: 'scan',
    cli_command: 'rx time-range /logs/b.log',
  };
}

function file(overrides: Partial<CursorFollower> = {}): CursorFollower {
  return { path: '/logs/b.log', cursorVersion: 0, timeRange: range('iso'), ...overrides };
}

const cursor: TimeCursor = { query: CURSOR_MS, version: 2, instantMs: CURSOR_MS };

describe('followsCursor', () => {
  it('moves the active file to a cursor set after its last move', () => {
    expect(followsCursor(file({ cursorVersion: 1 }), cursor, '/logs/b.log')).toBe(true);
  });

  it('keeps a file whose place already answers the cursor where it is', () => {
    // It jumped to this cursor, or the user moved it by line after it was set.
    expect(followsCursor(file({ cursorVersion: 2 }), cursor, '/logs/b.log')).toBe(false);
  });

  it('moves nothing while no cursor is set', () => {
    expect(followsCursor(file(), null, '/logs/b.log')).toBe(false);
  });

  it('leaves a file in the background for when it is shown', () => {
    expect(followsCursor(file(), cursor, '/logs/a.log')).toBe(false);
  });

  it('waits for the time range of a file, and leaves a file without timestamps alone', () => {
    expect(followsCursor(file({ timeRange: null }), cursor, '/logs/b.log')).toBe(false);
    expect(followsCursor(file({ timeRange: range(null) }), cursor, '/logs/b.log')).toBe(false);
  });
});

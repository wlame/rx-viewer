import { describe, expect, it } from 'vitest';
import { CHAIN_T0, HOUR_MS, chainDescription, chainTabOf } from '../testing/chainDescription';
import type { ChainResponse, FileLine, TimeRangeResponse } from '../types';
import {
  effectiveTimeAt,
  fractionOf,
  hasTimeFormat,
  instantAt,
  isPointAxis,
  pendingIndexReason,
  sideOfAxis,
  steppedInstant,
  timeJumpFeature,
  timeLabelFor,
  timelineAxis,
  type TimelineFile,
} from './timeline';

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
    example: '2025-12-10 07:00:04.574',
    first_ms: firstMs,
    last_ms: lastMs,
    source: 'scan',
    cli_command: 'rx time-range x',
  } as TimeRangeResponse;
}

function timedFile(timeRange: TimeRangeResponse | null): TimelineFile {
  return { timeRange };
}

const middleware = timedFile(range(HOUR_START + 4_574, HOUR_START + HOUR));

describe('timelineAxis', () => {
  it('spans one file from its first to its last time', () => {
    expect(timelineAxis(middleware)).toEqual({
      startMs: HOUR_START + 4_574,
      endMs: HOUR_START + HOUR,
    });
  });

  it.each([
    ['no file', undefined],
    ['no range', timedFile(null)],
    ['no format', timedFile(range(null, null, null))],
    ['an unknown last time', timedFile(range(HOUR_START, null))],
    ['an unknown first time', timedFile(range(null, HOUR_START))],
  ])('is null for %s', (_name, file) => {
    expect(timelineAxis(file)).toBeNull();
  });

  it('is one point for a file whose first and last times are equal', () => {
    const axis = timelineAxis(timedFile(range(HOUR_START, HOUR_START)));

    expect(axis).toEqual({ startMs: HOUR_START, endMs: HOUR_START });
    expect(isPointAxis(axis!)).toBe(true);
  });
});

describe('instant and position on the axis', () => {
  const axis = { startMs: HOUR_START, endMs: HOUR_START + HOUR };

  it.each([
    [HOUR_START, 0],
    [HOUR_START + HOUR / 4, 0.25],
    [HOUR_START + HOUR, 1],
  ])('places %d at fraction %d', (ms, fraction) => {
    expect(fractionOf(ms, axis)).toBe(fraction);
  });

  it('keeps an instant outside the axis at its nearer end', () => {
    expect(fractionOf(HOUR_START - MINUTE, axis)).toBe(0);
    expect(fractionOf(HOUR_START + 2 * HOUR, axis)).toBe(1);
  });

  it('reads the instant under a point of a 600 px track to the millisecond', () => {
    expect(instantAt(150, 600, axis)).toBe(HOUR_START + 15 * MINUTE);
    expect(instantAt(1, 600, axis)).toBe(HOUR_START + 6_000);
    expect(instantAt(1, 7, axis)).toBe(HOUR_START + Math.round(HOUR / 7));
  });

  it('reads a point left or right of the track as the axis end', () => {
    expect(instantAt(-20, 600, axis)).toBe(HOUR_START);
    expect(instantAt(900, 600, axis)).toBe(HOUR_START + HOUR);
  });

  it('turns an instant into a position and back', () => {
    const ms = HOUR_START + 37 * MINUTE;
    expect(instantAt(fractionOf(ms, axis) * 600, 600, axis)).toBe(ms);
  });

  it('names the side of an instant outside the axis, and none for one on it', () => {
    expect(sideOfAxis(HOUR_START - 1, axis)).toBe('before');
    expect(sideOfAxis(HOUR_START + HOUR + 1, axis)).toBe('after');
    expect(sideOfAxis(HOUR_START, axis)).toBeNull();
    expect(sideOfAxis(HOUR_START + HOUR, axis)).toBeNull();
  });

  it('puts every instant of a point axis in the middle', () => {
    const point = { startMs: HOUR_START, endMs: HOUR_START };
    expect(fractionOf(HOUR_START, point)).toBe(0.5);
    expect(instantAt(17, 600, point)).toBe(HOUR_START);
  });
});

describe('steppedInstant', () => {
  // 200 s wide: a step is 1 s, a large step 10 s.
  const axis = { startMs: HOUR_START + 500, endMs: HOUR_START + 200_500 };
  const at = (seconds: number) => HOUR_START + seconds * 1000;

  it('steps 1/200 of the axis and lands on a whole second', () => {
    expect(steppedInstant(at(100) + 400, 'later', axis)).toBe(at(101));
    expect(steppedInstant(at(100) + 400, 'earlier', axis)).toBe(at(99));
  });

  it('steps 1/20 of the axis with the large steps', () => {
    expect(steppedInstant(at(100), 'muchLater', axis)).toBe(at(110));
    expect(steppedInstant(at(100), 'muchEarlier', axis)).toBe(at(90));
  });

  it('steps at least one second on a narrow axis', () => {
    const narrow = { startMs: HOUR_START, endMs: HOUR_START + 20_000 };
    expect(steppedInstant(at(10), 'later', narrow)).toBe(at(11));
  });

  it('stops at the axis ends, and goes to them with Home and End', () => {
    expect(steppedInstant(at(200), 'muchLater', axis)).toBe(axis.endMs);
    expect(steppedInstant(at(1), 'earlier', axis)).toBe(axis.startMs);
    expect(steppedInstant(at(100), 'start', axis)).toBe(axis.startMs);
    expect(steppedInstant(at(100), 'end', axis)).toBe(axis.endMs);
  });

  it('steps an hour-wide axis by 18 s', () => {
    const hour = { startMs: HOUR_START, endMs: HOUR_START + HOUR };
    expect(steppedInstant(HOUR_START, 'later', hour)).toBe(at(18));
  });
});

describe('effectiveTimeAt', () => {
  function lines(first: number, stamps: (number | null)[]): FileLine[] {
    return stamps.map((timestampMs, i) => ({
      lineNumber: first + i,
      content: `LINE ${first + i}`,
      timestampMs,
    }));
  }

  it("is the anchor line's own time", () => {
    expect(effectiveTimeAt(lines(10, [100, 200, 300]), 11)).toBe(200);
  });

  it('is the time of the nearest earlier timestamped line when the anchor has none', () => {
    expect(effectiveTimeAt(lines(10, [100, null, null]), 12)).toBe(100);
  });

  it('is unknown when no line up to the anchor has a time', () => {
    expect(effectiveTimeAt(lines(10, [null, null, 300]), 11)).toBeNull();
  });

  it('is unknown when the window does not hold the anchor', () => {
    expect(effectiveTimeAt(lines(10, [100, 200]), 50)).toBeNull();
  });

  it('is unknown for lines read without timestamps', () => {
    expect(effectiveTimeAt([{ lineNumber: 1, content: 'LINE 1' }], 1)).toBeNull();
  });

  // The thumb follows the anchor across a new window: the answer's
  // line_timestamps give the times of the lines it holds now.
  it('follows the anchor into a window loaded later', () => {
    const before = lines(1, [100, null, 300]);
    const after = lines(1001, [null, 5_000, null, 7_000]);

    expect(effectiveTimeAt(before, 2)).toBe(100);
    expect(effectiveTimeAt(after, 1003)).toBe(5_000);
    expect(effectiveTimeAt(after, 1001)).toBeNull();
  });
});

describe('timeLabelFor', () => {
  const instant = HOUR_START + 30 * MINUTE;

  it('writes an instant the way the file writes a time', () => {
    expect(timeLabelFor(instant, middleware)).toBe('2025-12-10 07:30:00.000');
  });

  it('writes ISO 8601 in UTC for a file without timestamps, with no range yet, or no file', () => {
    for (const file of [timedFile(range(null, null, null)), timedFile(null), undefined]) {
      expect(timeLabelFor(instant, file)).toBe('2025-12-10T07:30:00.000Z');
    }
  });
});

describe('pendingIndexReason', () => {
  it('names nothing for a file with its index or one that needs none', () => {
    expect(pendingIndexReason({ name: 'core.log', pendingIndex: null })).toBeNull();
  });

  it('says the line index is being built while it is', () => {
    expect(pendingIndexReason({ name: 'core.log', pendingIndex: 'building' })).toBe(
      'The line index of core.log is being built',
    );
  });

  it('says the line index could not be built after its build failed', () => {
    expect(pendingIndexReason({ name: 'core.log', pendingIndex: 'failed' })).toBe(
      'The line index of core.log could not be built',
    );
  });

  it('names nothing without a file', () => {
    expect(pendingIndexReason(undefined)).toBeNull();
  });
});

describe('the time helpers on a chain tab', () => {
  function chainTab(description: ChainResponse | null) {
    return {
      name: 'agent.log',
      pendingIndex: null,
      timeRange: null,
      chain: chainTabOf(description),
    };
  }
  const ready = chainTab(chainDescription());

  it("spans a ready chain from the chain's first to its last time", () => {
    expect(timelineAxis(ready)).toEqual({ startMs: CHAIN_T0, endMs: CHAIN_T0 + 2 * HOUR_MS });
  });

  it('has no axis and no format before the chain is described', () => {
    expect(timelineAxis(chainTab(null))).toBeNull();
    expect(hasTimeFormat(chainTab(null))).toBe(false);
  });

  it("writes an instant the way the chain's first part writes a time", () => {
    expect(hasTimeFormat(ready)).toBe(true);
    expect(timeLabelFor(CHAIN_T0 + 1_500, ready)).toBe('2026-10-01 00:00:01.500');
  });

  it('needs the log chain routes to jump a chain by time, and time queries to jump a file', () => {
    expect(timeJumpFeature(ready)).toBe('log_chains');
    expect(timeJumpFeature(timedFile(null))).toBe('samples_timestamps');
    expect(timeJumpFeature(undefined)).toBe('samples_timestamps');
  });

  it('says why a pending chain cannot jump by time, and names nothing once it is ready', () => {
    expect(pendingIndexReason(chainTab(chainDescription({ state: 'pending' })))).toBe(
      'agent.log is not ready: the line indexes of its parts are being built',
    );
    expect(pendingIndexReason(ready)).toBeNull();
  });
});

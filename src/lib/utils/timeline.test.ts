import { describe, expect, it } from 'vitest';
import type { FileLine, TimeRangeResponse } from '../types';
import {
  effectiveTimeAt,
  fractionOf,
  instantAt,
  isPointAxis,
  sideOfAxis,
  laneLayout,
  steppedInstant,
  timelineAxis,
  timelineBands,
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

function timedFile(path: string, timeRange: TimeRangeResponse | null): TimelineFile {
  return { path, name: path.split('/').pop() ?? path, timeRange };
}

const middleware = timedFile('/logs/middleware.log', range(HOUR_START + 4_574, HOUR_START + HOUR));
const postgresql = timedFile(
  '/logs/postgresql.log',
  range(HOUR_START + 30_000, HOUR_START + HOUR + 2_000),
);
/** A file of the next hour, so the axis has a gap between the two bands. */
const nextHour = timedFile('/logs/next.log', range(HOUR_START + 2 * HOUR, HOUR_START + 3 * HOUR));

describe('timelineAxis', () => {
  it('spans one file from its first to its last time', () => {
    expect(timelineAxis([middleware])).toEqual({
      startMs: HOUR_START + 4_574,
      endMs: HOUR_START + HOUR,
    });
  });

  it('spans the earliest first time to the latest last time of two files', () => {
    expect(timelineAxis([middleware, postgresql])).toEqual({
      startMs: HOUR_START + 4_574,
      endMs: HOUR_START + HOUR + 2_000,
    });
  });

  it.each([
    ['no range', timedFile('/a', null)],
    ['no format', timedFile('/a', range(null, null, null))],
    ['an unknown last time', timedFile('/a', range(HOUR_START, null))],
    ['an unknown first time', timedFile('/a', range(null, HOUR_START))],
  ])('leaves out a file with %s', (_name, file) => {
    expect(timelineAxis([file])).toBeNull();
    expect(timelineAxis([file, middleware])).toEqual(timelineAxis([middleware]));
  });

  it('is one point for a file whose first and last times are equal', () => {
    const axis = timelineAxis([timedFile('/one', range(HOUR_START, HOUR_START))]);

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

describe('timelineBands', () => {
  it('draws one file as one band across the axis, highlighted when active', () => {
    const axis = timelineAxis([middleware])!;

    expect(timelineBands([middleware], axis, '/logs/middleware.log')).toEqual([
      { path: '/logs/middleware.log', name: 'middleware.log', start: 0, width: 1, isActive: true },
    ]);
  });

  it('draws two files with a gap between them where no file has data', () => {
    const axis = timelineAxis([middleware, nextHour])!;
    const [first, second] = timelineBands([middleware, nextHour], axis, '/logs/next.log');

    expect(first.isActive).toBe(false);
    expect(second.isActive).toBe(true);
    expect(first.start).toBe(0);
    expect(second.start + second.width).toBeCloseTo(1);
    expect(second.start - (first.start + first.width)).toBeGreaterThan(0.3);
  });

  it('draws no band for a file without a known range', () => {
    const axis = timelineAxis([middleware])!;
    const bands = timelineBands([timedFile('/plain.txt', null), middleware], axis, null);

    expect(bands.map((b) => b.path)).toEqual(['/logs/middleware.log']);
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

describe('laneLayout', () => {
  it('gives one file a 3 px lane', () => {
    expect(laneLayout(1)).toEqual({ bandHeight: 3, tops: [0], height: 3 });
  });

  it('stacks files that share an hour in lanes with a gap', () => {
    expect(laneLayout(2)).toEqual({ bandHeight: 3, tops: [0, 5], height: 8 });
  });

  it('thins the lanes as files are added and stays under 20 px', () => {
    for (let count = 1; count <= 30; count++) {
      const { height, tops, bandHeight } = laneLayout(count);
      expect(height).toBeLessThanOrEqual(20);
      expect(tops).toHaveLength(count);
      expect(bandHeight).toBeGreaterThan(0);
    }
    expect(laneLayout(6).bandHeight).toBe(2);
  });

  it('puts the files past the last lane back in the first lanes', () => {
    const { tops } = laneLayout(12);
    expect(tops[10]).toBe(tops[0]);
    expect(tops[11]).toBe(tops[1]);
  });
});

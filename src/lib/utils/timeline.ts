import type { FileLine, OpenFile } from '../types';

/**
 * The geometry of the timeline bar: the time axis the open files span,
 * each file's band on it, the instant under a point of the track, the
 * keyboard's steps, and the time of the line a file is anchored on.
 *
 * Everything here is pure and takes the track's width as a number, so it
 * is tested without a layout engine.
 */

/** What the timeline needs to know of an open file. */
export type TimelineFile = Pick<OpenFile, 'path' | 'name' | 'timeRange'>;

/** The span of the axis, as UTC instants in ms; `startMs <= endMs`. */
export interface TimeAxis {
  startMs: number;
  endMs: number;
}

/** A file's first and last times, when both are known. */
function knownSpan(file: TimelineFile): TimeAxis | null {
  const range = file.timeRange;
  if (!range?.format || range.first_ms === null || range.last_ms === null) return null;
  return { startMs: range.first_ms, endMs: range.last_ms };
}

/** Whether a file has a timestamp format, so it can be moved by time. */
export function hasTimeFormat(file: Pick<TimelineFile, 'timeRange'> | undefined): boolean {
  return Boolean(file?.timeRange?.format);
}

/**
 * The axis from the earliest first time to the latest last time of the
 * files whose range is known, or null when no file's range is known.
 */
export function timelineAxis(files: readonly TimelineFile[]): TimeAxis | null {
  let axis: TimeAxis | null = null;
  for (const file of files) {
    const span = knownSpan(file);
    if (!span) continue;
    axis = axis
      ? {
          startMs: Math.min(axis.startMs, span.startMs),
          endMs: Math.max(axis.endMs, span.endMs),
        }
      : span;
  }
  return axis;
}

/** Whether the axis is a single instant: drawn as one point, with no scrubbing. */
export function isPointAxis(axis: TimeAxis): boolean {
  return axis.endMs <= axis.startMs;
}

/** Where `ms` is on the axis, from 0 (start) to 1 (end); the middle of a point axis. */
export function fractionOf(ms: number, axis: TimeAxis): number {
  if (isPointAxis(axis)) return 0.5;
  const fraction = (ms - axis.startMs) / (axis.endMs - axis.startMs);
  return Math.min(1, Math.max(0, fraction));
}

/** Which side of the axis an instant is on when it is outside it, or null when it is on it. */
export function sideOfAxis(ms: number, axis: TimeAxis): 'before' | 'after' | null {
  if (ms < axis.startMs) return 'before';
  if (ms > axis.endMs) return 'after';
  return null;
}

/**
 * The instant at `x` pixels from the left of a track `width` pixels
 * wide, to the millisecond. A point outside the track reads as its
 * nearer end.
 */
export function instantAt(x: number, width: number, axis: TimeAxis): number {
  if (isPointAxis(axis) || width <= 0) return axis.startMs;
  const fraction = Math.min(1, Math.max(0, x / width));
  return Math.round(axis.startMs + fraction * (axis.endMs - axis.startMs));
}

/** One file drawn on the axis: where its span starts and how wide it is, as fractions. */
export interface TimelineBand {
  path: string;
  name: string;
  start: number;
  width: number;
  isActive: boolean;
}

/** A band for each file whose range is known, in the order of the files. */
export function timelineBands(
  files: readonly TimelineFile[],
  axis: TimeAxis,
  activePath: string | null,
): TimelineBand[] {
  const bands: TimelineBand[] = [];
  for (const file of files) {
    const span = knownSpan(file);
    if (!span) continue;
    const start = fractionOf(span.startMs, axis);
    bands.push({
      path: file.path,
      name: file.name,
      start,
      width: fractionOf(span.endMs, axis) - start,
      isActive: file.path === activePath,
    });
  }
  return bands;
}

/** Where the bands sit, one lane per file: each lane's top and the height they take, in px. */
export interface LaneLayout {
  bandHeight: number;
  tops: number[];
  height: number;
}

/**
 * The lane sizes by the number of lanes: the bands thin as files are
 * added, so the lanes stay inside the bar. Files past the last row's
 * count share the lanes from the first one again.
 */
const LANE_SIZES: readonly { upTo: number; bandHeight: number; gap: number }[] = [
  { upTo: 3, bandHeight: 3, gap: 2 },
  { upTo: 6, bandHeight: 2, gap: 1 },
  { upTo: 10, bandHeight: 1, gap: 1 },
];

/**
 * The lanes of `count` bands. Files whose spans overlap, such as two
 * logs of the same hour, are each seen in a lane of their own.
 */
export function laneLayout(count: number): LaneLayout {
  const largest = LANE_SIZES[LANE_SIZES.length - 1];
  const size = LANE_SIZES.find((row) => count <= row.upTo) ?? largest;
  const lanes = Math.max(1, Math.min(count, largest.upTo));
  const pitch = size.bandHeight + size.gap;
  const tops = Array.from({ length: count }, (_, i) => (i % lanes) * pitch);
  return { bandHeight: size.bandHeight, tops, height: lanes * pitch - size.gap };
}

/** A keyboard move along the axis. */
export type TimelineStep = 'earlier' | 'later' | 'muchEarlier' | 'muchLater' | 'start' | 'end';

/** Each step that moves by a share of the axis: its direction and the share. */
const SHARE_STEPS: Record<
  Exclude<TimelineStep, 'start' | 'end'>,
  { direction: -1 | 1; share: number }
> = {
  earlier: { direction: -1, share: 1 / 200 },
  later: { direction: 1, share: 1 / 200 },
  muchEarlier: { direction: -1, share: 1 / 20 },
  muchLater: { direction: 1, share: 1 / 20 },
};

const SECOND_MS = 1000;

/**
 * The instant one keyboard step from `ms`. A step moves by its share of
 * the axis, at least one second, and lands on a whole second; it stops
 * at the axis ends, and `start` and `end` go to them.
 */
export function steppedInstant(ms: number, step: TimelineStep, axis: TimeAxis): number {
  if (step === 'start') return axis.startMs;
  if (step === 'end') return axis.endMs;

  const { direction, share } = SHARE_STEPS[step];
  const distance = Math.max(SECOND_MS, (axis.endMs - axis.startMs) * share);
  let next = Math.round((ms + direction * distance) / SECOND_MS) * SECOND_MS;
  // Rounding back onto the start must not leave the cursor where it was.
  if (next === ms) next += direction * SECOND_MS;
  return Math.min(axis.endMs, Math.max(axis.startMs, next));
}

/**
 * The time of `line` from the loaded lines: its own effective timestamp,
 * or that of the nearest earlier line that has one. Null when the lines
 * do not hold `line`, or no line up to it has a time.
 */
export function effectiveTimeAt(lines: readonly FileLine[], line: number): number | null {
  const first = lines[0]?.lineNumber;
  if (first === undefined) return null;
  const index = line - first;
  if (index < 0 || index >= lines.length || lines[index].lineNumber !== line) return null;
  for (let i = index; i >= 0; i--) {
    const stamp = lines[i].timestampMs;
    if (stamp !== undefined && stamp !== null) return stamp;
  }
  return null;
}

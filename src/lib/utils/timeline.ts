import type { BackendFeature } from '../stores/health';
import type { FileLine, OpenFile } from '../types';
import {
  chainRangeUnknownReason,
  chainTimeAxis,
  chainTimeLayout,
  chainTimeRefusal,
} from './chainTime';
import { formatInFileLayout, type FileTimeLayout } from './timeFormat';

/**
 * The geometry of the timeline bar: the time axis of the active tab,
 * the instant under a point of the track, the keyboard's steps, and the
 * time of the line a tab is anchored on.
 *
 * A file's times come from its time range. A log chain's tab reads them
 * from the chain's description (`chainTime.ts`): its axis once the chain
 * is ready, written the way its first part with timestamps writes them.
 *
 * Everything here is pure and takes the track's width as a number, so it
 * is tested without a layout engine.
 */

/** What the timeline needs to know of an open tab: a file's time range, or a chain. */
export type TimelineFile = Pick<OpenFile, 'timeRange' | 'chain'>;

/** What the time features read about a file's line index, or a chain's state. */
export type PendingIndexFile = Pick<OpenFile, 'name' | 'pendingIndex' | 'chain'>;

/** Why the time features are off while a file has no line index, by the reason. */
const PENDING_INDEX_REASONS: Record<
  NonNullable<OpenFile['pendingIndex']>,
  (name: string) => string
> = {
  building: (name) => `The line index of ${name} is being built`,
  failed: (name) => `The line index of ${name} could not be built`,
};

/**
 * Why the timeline, the Go to time box and the stash cannot jump `file`
 * yet: it wants a line index and has none; a chain's tab, until the chain
 * is ready (its parts' line indexes are built and every check passed).
 * Null when they can, and without a file.
 */
export function pendingIndexReason(file: PendingIndexFile | undefined): string | null {
  if (file?.chain) return chainTimeRefusal(file.name, file.chain);
  if (!file?.pendingIndex) return null;
  return PENDING_INDEX_REASONS[file.pendingIndex](file.name);
}

/**
 * The backend feature a tab's jumps by time need: a log chain's tab moves
 * through the log chain routes, which take times wherever they are
 * served; a file's tab needs time queries on `/v1/samples`.
 */
export function timeJumpFeature(file: Pick<OpenFile, 'chain'> | undefined): BackendFeature {
  return file?.chain ? 'log_chains' : 'samples_timestamps';
}

/** The span of the axis, as UTC instants in ms; `startMs <= endMs`. */
export interface TimeAxis {
  startMs: number;
  endMs: number;
}

/**
 * How a tab writes its times: a file's time range, a chain's first part
 * with timestamps; null while it is not known.
 */
export function timeLayoutOf(file: TimelineFile | undefined): FileTimeLayout | null {
  if (file?.chain) return file.chain.description ? chainTimeLayout(file.chain.description) : null;
  return file?.timeRange ?? null;
}

/** Whether a tab has a timestamp format, so it can be moved by time. */
export function hasTimeFormat(file: TimelineFile | undefined): boolean {
  return Boolean(timeLayoutOf(file)?.format);
}

/**
 * Whether the tab's time range has not been read yet: a file's range not
 * asked or not answered, a chain not described.
 */
export function isTimeRangeUnknown(file: TimelineFile | undefined): boolean {
  if (file?.chain) return file.chain.description === null;
  return file?.timeRange === null;
}

/**
 * `ms` written the way the tab writes a time, in the zone its lines
 * show, or ISO 8601 in UTC for a file without timestamps, without a
 * range yet, or no file.
 */
export function timeLabelFor(ms: number, file: TimelineFile | undefined): string {
  const layout = timeLayoutOf(file);
  return layout?.format ? formatInFileLayout(ms, layout) : new Date(ms).toISOString();
}

/**
 * The axis of one tab, from its first to its last time, or null while
 * either is unknown, the file has no timestamps, or the chain is not
 * ready.
 */
export function timelineAxis(file: TimelineFile | undefined): TimeAxis | null {
  if (file?.chain) return file.chain.description ? chainTimeAxis(file.chain.description) : null;
  const range = file?.timeRange;
  if (!range?.format || range.first_ms === null || range.last_ms === null) return null;
  return { startMs: range.first_ms, endMs: range.last_ms };
}

/**
 * Why a tab that has a timestamp format has no axis: a chain names the end
 * whose time is not known; a file's range is not known yet.
 */
export function timeRangeUnknownReason(file: TimelineFile & Pick<OpenFile, 'name'>): string {
  const chain = file.chain?.description;
  if (chain) return chainRangeUnknownReason(file.name, chain);
  return `The time range of ${file.name} is not known yet`;
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

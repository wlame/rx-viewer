/**
 * The marks a log chain draws on the timeline bar's axis: a tick where
 * each part starts, a band over each time gap, and a mark where missing
 * parts would be. Each is placed as a share of the axis (0 at the chain's
 * first time, 1 at its last) and carries the tooltip that names it.
 *
 * A chain may have 10,000 parts. Marks of one kind that fall into one of
 * `MAX_TIMELINE_MARKS` equal slices of the axis become one mark, so the
 * bar draws a bounded number of each whatever the chain. Everything here
 * is pure; the marks of a description are worked out once.
 */
import type { ChainPart, ChainResponse } from '../types';
import { isEmptyPart } from './chainParts';
import { chainTimeAxis, chainTimeLayout } from './chainTime';
import { missingPartsBefore } from './chainZones';
import { formatInFileLayout } from './timeFormat';
import { fractionOf, type TimeAxis } from './timeline';

/** The slices of the axis; marks of one kind in one slice are merged. */
export const MAX_TIMELINE_MARKS = 1000;

/** A tick where a part starts, or where several start close together. */
export interface TimelineTick {
  fraction: number;
  title: string;
}

/** A band over a time gap with no lines, or over several close together. */
export interface TimelineGapBand {
  fromFraction: number;
  toFraction: number;
  title: string;
}

/** A mark where missing numbered parts would be. */
export interface TimelineMissingMark {
  fraction: number;
  title: string;
}

export interface ChainTimelineMarks {
  ticks: TimelineTick[];
  gaps: TimelineGapBand[];
  missing: TimelineMissingMark[];
}

/** The slice of the axis a share of it falls into. */
function sliceOf(fraction: number): number {
  return Math.round(fraction * MAX_TIMELINE_MARKS);
}

/** Writes an instant the way the chain writes a time, or ISO 8601 in UTC without a format. */
function labeller(chain: ChainResponse): (ms: number) => string {
  const layout = chainTimeLayout(chain);
  return (ms) => (layout?.format ? formatInFileLayout(ms, layout) : new Date(ms).toISOString());
}

/** A part that starts at a known time: one with lines whose first time is known. */
type TimedPart = ChainPart & { first_ms: number };

function isTimed(part: ChainPart): part is TimedPart {
  return part.first_ms !== null && !isEmptyPart(part);
}

/** The ticks of the parts after the first one with lines, those in one slice merged. */
function partTicks(
  chain: ChainResponse,
  axis: TimeAxis,
  label: (ms: number) => string,
): TimelineTick[] {
  const groups: { slice: number; fraction: number; parts: TimedPart[] }[] = [];
  for (const part of chain.parts.filter(isTimed).slice(1)) {
    const fraction = fractionOf(part.first_ms, axis);
    const slice = sliceOf(fraction);
    const last = groups.at(-1);
    if (last?.slice === slice) last.parts.push(part);
    else groups.push({ slice, fraction, parts: [part] });
  }
  return groups.map(({ fraction, parts }) => {
    const first = parts[0];
    const last = parts[parts.length - 1];
    const title =
      parts.length === 1
        ? `${first.name} from ${label(first.first_ms)}`
        : `${first.name} … ${last.name}: ${parts.length} parts start here`;
    return { fraction, title };
  });
}

/** The bands of the time gaps, in time order; gaps whose slices meet are merged. */
function gapBands(chain: ChainResponse, axis: TimeAxis, label: (ms: number) => string) {
  const sorted = [...chain.gaps].sort((a, b) => a.from_ms - b.from_ms);
  const bands: { from: number; to: number; count: number }[] = [];
  for (const gap of sorted) {
    const last = bands.at(-1);
    if (last && sliceOf(fractionOf(gap.from_ms, axis)) <= sliceOf(fractionOf(last.to, axis))) {
      last.to = Math.max(last.to, gap.to_ms);
      last.count += 1;
    } else {
      bands.push({ from: gap.from_ms, to: gap.to_ms, count: 1 });
    }
  }
  return bands.map(({ from, to, count }): TimelineGapBand => ({
    fromFraction: fractionOf(from, axis),
    toFraction: fractionOf(to, axis),
    title:
      count === 1
        ? `No lines from ${label(from)} to ${label(to)}`
        : `${count} time gaps from ${label(from)} to ${label(to)}`,
  }));
}

/**
 * The instant between the part at `index` and the parts before it: the
 * middle of the last earlier part's highest time and the first time of
 * the part at `index` or after it; either one when the other is not
 * known; null when neither is.
 */
function edgeInstant(parts: readonly ChainPart[], index: number): number | null {
  let to: number | null = null;
  for (let i = index; i < parts.length && to === null; i++) {
    if (isTimed(parts[i])) to = parts[i].first_ms;
  }
  let from: number | null = null;
  for (let i = index - 1; i >= 0 && from === null; i--) {
    const part = parts[i];
    if (!isEmptyPart(part)) from = part.max_ms ?? part.last_ms ?? part.first_ms;
  }
  if (from !== null && to !== null) return Math.round((from + to) / 2);
  return to ?? from;
}

/** The marks of the missing parts, placed as the editor's zones place them; one slice, one mark. */
function missingMarks(chain: ChainResponse, axis: TimeAxis): TimelineMissingMark[] {
  const indexOf = new Map(chain.parts.map((part, index) => [part.name, index]));
  const bySlice = new Map<number, { fraction: number; names: string[] }>();
  for (const [before, names] of missingPartsBefore(chain)) {
    const ms = edgeInstant(chain.parts, indexOf.get(before) ?? chain.parts.length);
    if (ms === null) continue;
    const fraction = fractionOf(ms, axis);
    const slice = sliceOf(fraction);
    const held = bySlice.get(slice);
    if (held) held.names.push(...names);
    else bySlice.set(slice, { fraction, names: [...names] });
  }
  return [...bySlice.values()]
    .sort((a, b) => a.fraction - b.fraction)
    .map(({ fraction, names }) => ({ fraction, title: `Missing: ${names.join(', ')}` }));
}

const marksOf = new WeakMap<ChainResponse, ChainTimelineMarks | null>();

/**
 * The marks of a chain on its time axis: ticks where its parts start
 * (after the first part with lines), bands over its time gaps, and marks
 * for its missing parts. Null for a chain without an axis (not ready, or
 * an end time not known). The same object for the same description.
 */
export function chainTimelineMarks(chain: ChainResponse): ChainTimelineMarks | null {
  if (marksOf.has(chain)) return marksOf.get(chain) ?? null;
  const axis = chainTimeAxis(chain);
  let marks: ChainTimelineMarks | null = null;
  if (axis !== null) {
    const label = labeller(chain);
    marks = {
      ticks: partTicks(chain, axis, label),
      gaps: gapBands(chain, axis, label),
      missing: missingMarks(chain, axis),
    };
  }
  marksOf.set(chain, marks);
  return marks;
}

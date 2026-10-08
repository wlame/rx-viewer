/**
 * What the editor draws around a log chain's lines without adding a
 * line: a view zone above the first line of each part it holds (the
 * part's name, times and lines), above a part that follows a time gap,
 * and where a missing numbered part would be; and the gutter classes
 * that tell the parts apart and mute the part-local numbers of a chain
 * that is not ready.
 *
 * A view zone is space between two editor lines, not a line: it changes
 * no line number, no search mark and no jump target. Everything here is
 * pure, but for the memo of one pane's last zones;
 * `components/editor/viewZones.ts` hands the zones to Monaco.
 */
import type { ChainGap, ChainNumbering, ChainPart, ChainResponse, FileLine } from '../types';
import { formatInFileLayout, type FileTimeLayout } from './timeFormat';

/** One view zone: its text, what it marks, and the editor line it follows (0: above line 1). */
export interface EditorViewZone {
  afterLineNumber: number;
  kind: 'part' | 'gap' | 'missing';
  text: string;
}

/**
 * The layout a part writes its timestamps in, for `formatInFileLayout`,
 * shown in the zone its timestamps are read in (`assumed_zone`): the
 * zone chosen for the chain (`file_tz`) when one is, else `RX_LOG_TZ` for
 * a part whose lines write no zone, and UTC for one whose lines do (its
 * description does not give the offset its lines write).
 */
export function partTimeLayout(part: ChainPart): FileTimeLayout {
  const format = part.time_format;
  return {
    format: format?.format ?? null,
    example: part.example,
    day_first: part.day_first,
    display_zone: format?.assumed_zone ?? null,
  };
}

/** `ms` written the way `part` writes a timestamp, or ISO 8601 in UTC when its format is unknown. */
export function partTimeLabel(ms: number, part: ChainPart): string {
  return part.time_format
    ? formatInFileLayout(ms, partTimeLayout(part))
    : new Date(ms).toISOString();
}

/** `app.log.3.gz · 2026-10-01 00:00:00.000 – 2026-10-01 23:59:59.998 · 1,205 lines`, what is known of it. */
function partZoneText(part: ChainPart): string {
  const pieces = [part.name];
  if (part.first_ms !== null && part.max_ms !== null) {
    pieces.push(`${partTimeLabel(part.first_ms, part)} – ${partTimeLabel(part.max_ms, part)}`);
  }
  if (part.line_count !== null) {
    pieces.push(`${part.line_count.toLocaleString()} line${part.line_count === 1 ? '' : 's'}`);
  }
  return pieces.join(' · ');
}

const DIGITS = /^\d+$/;

/**
 * The number in a missing part's name: `{name}.{N}` for a numbered chain,
 * `{stem}{sep}{N}.{ext}` for a numbered-ext one; null for another shape.
 */
function missingNumber(missing: string, chainName: string): number | null {
  if (missing.startsWith(`${chainName}.`)) {
    const rest = missing.slice(chainName.length + 1);
    if (DIGITS.test(rest)) return Number(rest);
  }
  const dot = chainName.lastIndexOf('.');
  if (dot <= 0) return null;
  const stem = chainName.slice(0, dot);
  const ext = chainName.slice(dot);
  if (!missing.startsWith(stem) || !missing.endsWith(ext)) return null;
  const middle = missing.slice(stem.length, missing.length - ext.length);
  const number = middle.slice(1);
  return '.-_'.includes(middle[0] ?? 'x') && DIGITS.test(number) ? Number(number) : null;
}

/** A part's number in a numbered chain: its key when the key is all digits, else null. */
function partNumber(part: ChainPart): number | null {
  return part.key && DIGITS.test(part.key) ? Number(part.key) : null;
}

/**
 * The index of the part with the smallest number above `number`, the
 * first in the chain's order among parts of one number; -1 when no part
 * has a higher number. One pass over the parts' numbers.
 */
function nextHigherPart(numbers: readonly (number | null)[], number: number): number {
  let found = -1;
  for (let i = 0; i < numbers.length; i++) {
    const candidate = numbers[i];
    if (candidate === null || candidate <= number) continue;
    if (found < 0 || candidate < (numbers[found] as number)) found = i;
  }
  return found;
}

/**
 * The missing parts to show before each part, by that part's name, the
 * higher numbers first. A numbered chain's older parts have higher
 * numbers, so a missing number sits right after the present part with
 * the next higher number: before the part that follows it in the chain's
 * order. A name whose number cannot be read gets no zone. The work is
 * one pass over the parts per missing name.
 */
export function missingPartsBefore(chain: ChainResponse): Map<string, string[]> {
  const numbers = chain.parts.map(partNumber);
  const missing = chain.missing
    .map((name) => ({ name, number: missingNumber(name, chain.name) }))
    .filter((entry): entry is { name: string; number: number } => entry.number !== null)
    .sort((a, b) => b.number - a.number);
  const before = new Map<string, string[]>();
  for (const { name, number } of missing) {
    const older = nextHigherPart(numbers, number);
    const next = older < 0 ? undefined : chain.parts[older + 1];
    if (next === undefined) continue;
    const names = before.get(next.name);
    if (names) names.push(name);
    else before.set(next.name, [name]);
  }
  return before;
}

/** What the zones of a chain take from its description, worked out once for each description. */
interface ZonePlan {
  partsByName: Map<string, ChainPart>;
  gapBefore: Map<string, ChainGap>;
  missingBefore: Map<string, string[]>;
}

/** The plan of a description's zones: its parts and gaps by name, and where its missing parts go. */
function planZones(chain: ChainResponse): ZonePlan {
  return {
    partsByName: new Map(chain.parts.map((part) => [part.name, part])),
    gapBefore: new Map(chain.gaps.map((gap) => [gap.before, gap])),
    missingBefore: missingPartsBefore(chain),
  };
}

/** The zones of the held lines by a description's plan; see `chainViewZones`. */
function zonesOfPlan(lines: readonly FileLine[], plan: ZonePlan): EditorViewZone[] {
  const { partsByName, gapBefore, missingBefore } = plan;
  const zones: EditorViewZone[] = [];

  lines.forEach((line, index) => {
    const part = line.part === undefined ? undefined : partsByName.get(line.part);
    if (part === undefined || line.localLine !== 1) return;
    for (const missing of missingBefore.get(part.name) ?? []) {
      zones.push({ afterLineNumber: index, kind: 'missing', text: `missing: ${missing}` });
    }
    const gap = gapBefore.get(part.name);
    const partBefore = gap === undefined ? undefined : partsByName.get(gap.after);
    if (gap !== undefined && partBefore !== undefined) {
      const from = partTimeLabel(gap.from_ms, partBefore);
      const to = partTimeLabel(gap.to_ms, part);
      zones.push({ afterLineNumber: index, kind: 'gap', text: `no lines from ${from} to ${to}` });
    }
    zones.push({ afterLineNumber: index, kind: 'part', text: partZoneText(part) });
  });
  return zones;
}

/**
 * The view zones of the held lines: before the first line of each part
 * the editor holds, the missing parts that come before it, the time gap
 * before it, then the part's own zone. `afterLineNumber` counts editor
 * lines, which start at the first held line.
 */
export function chainViewZones(lines: readonly FileLine[], chain: ChainResponse): EditorViewZone[] {
  return zonesOfPlan(lines, planZones(chain));
}

/** The zones of a tab that shows no chain: one list, so the editor sees no change. */
export const NO_ZONES: readonly EditorViewZone[] = Object.freeze([]);

/**
 * `chainViewZones` for one editor pane, built again only when the held
 * lines or the description are other objects than at the last call.
 * Otherwise it gives the zones it gave then, the same list, so the
 * editor keeps the zones it shows: an update of the tab that changes
 * neither (an index task's progress, the anchor line after a scroll)
 * costs nothing. A description's missing parts are placed once.
 */
export function chainZonesMemo(): (
  lines: readonly FileLine[],
  chain: ChainResponse | null,
) => readonly EditorViewZone[] {
  let planned: { chain: ChainResponse; plan: ZonePlan } | null = null;
  let built: { lines: readonly FileLine[]; chain: ChainResponse; zones: EditorViewZone[] } | null =
    null;
  return (lines, chain) => {
    if (chain === null) return NO_ZONES;
    if (built?.lines === lines && built.chain === chain) return built.zones;
    if (planned?.chain !== chain) planned = { chain, plan: planZones(chain) };
    built = { lines, chain, zones: zonesOfPlan(lines, planned.plan) };
    return built.zones;
  };
}

/** A run of editor lines whose line numbers take one gutter class. */
export interface GutterRun {
  first: number;
  last: number;
  className: string;
}

/** The gutter class of a line of the part at `partIndex`, or none for the default look. */
function gutterClass(partIndex: number, numbering: ChainNumbering): string | null {
  const classes: string[] = [];
  if (numbering === 'local') classes.push('chain-gutter-local');
  if (partIndex % 2 === 1) classes.push('chain-gutter-alt');
  return classes.length > 0 ? classes.join(' ') : null;
}

/**
 * The gutter classes of the held lines, in runs of editor lines (from 1):
 * every second part of the chain's order in a second colour, and a
 * pending chain's part-local numbers muted.
 */
export function chainGutterRuns(
  lines: readonly FileLine[],
  parts: readonly ChainPart[],
  numbering: ChainNumbering,
): GutterRun[] {
  const indexOf = new Map(parts.map((part, index) => [part.name, index]));
  const runs: GutterRun[] = [];
  lines.forEach((line, i) => {
    const partIndex = line.part === undefined ? undefined : indexOf.get(line.part);
    const className = partIndex === undefined ? null : gutterClass(partIndex, numbering);
    if (className === null) return;
    const editorLine = i + 1;
    const last = runs.at(-1);
    if (last && last.className === className && last.last === editorLine - 1)
      last.last = editorLine;
    else runs.push({ first: editorLine, last: editorLine, className });
  });
  return runs;
}

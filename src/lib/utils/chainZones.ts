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
 * pure; `components/editor/viewZones.ts` hands the zones to Monaco.
 */
import type { ChainNumbering, ChainPart, ChainResponse, FileLine } from '../types';
import { formatInFileLayout, type FileTimeLayout } from './timeFormat';

/** One view zone: its text, what it marks, and the editor line it follows (0: above line 1). */
export interface EditorViewZone {
  afterLineNumber: number;
  kind: 'part' | 'gap' | 'missing';
  text: string;
}

/**
 * The layout a part writes its timestamps in, for `formatInFileLayout`. A
 * part whose timestamps carry a zone is shown in UTC, as ISO 8601: its
 * description does not give the offset its lines write.
 */
function layoutOf(part: ChainPart): FileTimeLayout {
  const format = part.time_format;
  return {
    format: format?.format ?? null,
    example: part.example,
    day_first: part.day_first,
    display_zone: format && !format.has_zone ? format.assumed_zone : null,
  };
}

/** `ms` written the way `part` writes a timestamp, or ISO 8601 in UTC when its format is unknown. */
export function partTimeLabel(ms: number, part: ChainPart): string {
  return part.time_format ? formatInFileLayout(ms, layoutOf(part)) : new Date(ms).toISOString();
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

/**
 * The missing parts to show before each part, by that part's name. A
 * numbered chain's older parts have higher numbers, so a missing number
 * sits right after the present part with the next higher number: before
 * the part that follows it in the chain's order. A name whose number
 * cannot be read gets no zone.
 */
function missingBeforeParts(chain: ChainResponse): Map<string, string[]> {
  const numbered = chain.parts
    .map((part, index) => ({
      index,
      number: part.key && DIGITS.test(part.key) ? Number(part.key) : null,
    }))
    .filter((entry): entry is { index: number; number: number } => entry.number !== null);
  const before = new Map<string, string[]>();
  for (const missing of chain.missing) {
    const number = missingNumber(missing, chain.name);
    if (number === null) continue;
    const older = numbered
      .filter((entry) => entry.number > number)
      .sort((a, b) => a.number - b.number)[0];
    const next = older === undefined ? undefined : chain.parts[older.index + 1];
    if (next === undefined) continue;
    before.set(next.name, [...(before.get(next.name) ?? []), missing]);
  }
  for (const names of before.values())
    names.sort((a, b) => (missingNumber(b, chain.name) ?? 0) - (missingNumber(a, chain.name) ?? 0));
  return before;
}

/**
 * The view zones of the held lines: before the first line of each part
 * the editor holds, the missing parts that come before it, the time gap
 * before it, then the part's own zone. `afterLineNumber` counts editor
 * lines, which start at the first held line.
 */
export function chainViewZones(lines: readonly FileLine[], chain: ChainResponse): EditorViewZone[] {
  const partsByName = new Map(chain.parts.map((part) => [part.name, part]));
  const gapBefore = new Map(chain.gaps.map((gap) => [gap.before, gap]));
  const missingBefore = missingBeforeParts(chain);
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

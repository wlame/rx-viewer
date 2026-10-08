/**
 * What a log chain's tab reads from the chain's description: whether it
 * counts as indexed, how far its index task has got, the lines each part
 * spans, the parts around a part, and what the line box takes.
 *
 * Everything here is pure, so it is tested without a backend.
 */
import type { ChainPart, ChainResponse } from '../types';

/** A part that holds no line: its file is empty. An empty file is never indexed, and needs no index. */
export function isEmptyPart(part: Pick<ChainPart, 'size'>): boolean {
  return part.size === 0;
}

/** The frozen parts that hold lines: the parts a ready chain needs an index of. */
function frozenPartsWithLines(parts: readonly ChainPart[]): ChainPart[] {
  return parts.filter((part) => !part.is_active && !isEmptyPart(part));
}

/**
 * Whether the chain shows `idx`: every frozen part that holds lines has
 * a current line index. An empty part needs none, and the active part's
 * index does not count (on a live log it is almost never current). A
 * chain whose parts are not listed (more than 10,000) is not indexed.
 */
export function isChainIndexed(parts: readonly ChainPart[]): boolean {
  return parts.length > 0 && frozenPartsWithLines(parts).every((part) => part.is_indexed);
}

/** What the parts list says of a part's index. */
export type PartIndexWord = 'empty' | 'indexed' | 'not indexed';

export function partIndexWord(part: Pick<ChainPart, 'size' | 'is_indexed'>): PartIndexWord {
  if (isEmptyPart(part)) return 'empty';
  return part.is_indexed ? 'indexed' : 'not indexed';
}

/**
 * The mark of a chain whose index task runs: `indexing 5/12 parts · 40%`.
 * The 12 is the frozen parts that hold lines. The 5 is those the
 * description found indexed, plus the task's share (`progress`, 0 to 1)
 * of the rest, rounded down; the share is left out while the task does
 * not report one.
 */
export function chainIndexingLabel(parts: readonly ChainPart[], progress: number | null): string {
  const needed = frozenPartsWithLines(parts);
  const indexed = needed.filter((part) => part.is_indexed).length;
  const done = indexed + Math.floor((progress ?? 0) * (needed.length - indexed));
  const label = `indexing ${done}/${needed.length} parts`;
  return progress === null ? label : `${label} · ${Math.floor(progress * 100)}%`;
}

/** The global lines a part spans; `last` is null while its line count is unknown. */
export interface PartLineRange {
  first: number;
  last: number | null;
}

/** The global lines of a part of a ready chain, or null before ready and for an empty part. */
export function partLineRange(
  part: Pick<ChainPart, 'global_start' | 'line_count' | 'size'>,
): PartLineRange | null {
  if (part.global_start === null || isEmptyPart(part)) return null;
  const last = part.line_count === null ? null : part.global_start + part.line_count - 1;
  return { first: part.global_start, last };
}

/**
 * The chain's length for the header: every line once the active part is
 * counted, else the frozen parts' lines followed by `…`; null before the
 * chain is ready.
 */
export function chainLinesLabel(
  chain: Pick<ChainResponse, 'state' | 'line_count' | 'frozen_line_count'>,
): string | null {
  if (chain.state !== 'ready') return null;
  if (chain.line_count !== null) return chain.line_count.toLocaleString();
  if (chain.frozen_line_count !== null) return `${chain.frozen_line_count.toLocaleString()}…`;
  return null;
}

function counted(count: number, word: string): string {
  return `${count.toLocaleString()} ${word}${count === 1 ? '' : 's'}`;
}

/** `2 gaps · 3 missing`: the time gaps and the missing parts of a chain, or null for neither. */
export function gapsAndMissingSummary(
  chain: Pick<ChainResponse, 'gaps' | 'missing_count'>,
): string | null {
  const pieces: string[] = [];
  if (chain.gaps.length > 0) pieces.push(counted(chain.gaps.length, 'gap'));
  if (chain.missing_count > 0) pieces.push(`${chain.missing_count.toLocaleString()} missing`);
  return pieces.length > 0 ? pieces.join(' · ') : null;
}

/** The caption of a chain's tab: `syslog [3/12]`, 3 the part of the top line, 12 the parts. */
export function chainCaption(name: string, partNumber: number, partCount: number): string {
  return `${name} [${partNumber}/${partCount}]`;
}

/**
 * The next part (`after`) or the previous one (`before`) of `name` in
 * the chain's order that holds lines, or, with no name, the first
 * (`after`) or the last (`before`) such part. A part holds no lines when
 * its file is empty or a read of it found none (`counts` 0). Null past
 * either end.
 */
export function neighbourPartWithLines(
  parts: readonly ChainPart[],
  name: string | null,
  direction: 'before' | 'after',
  counts: ReadonlyMap<string, number>,
): ChainPart | null {
  const step = direction === 'after' ? 1 : -1;
  const from = name === null ? -1 : parts.findIndex((part) => part.name === name);
  if (name !== null && from < 0) return null;
  let index = name === null ? (direction === 'after' ? 0 : parts.length - 1) : from + step;
  for (; index >= 0 && index < parts.length; index += step) {
    const part = parts[index];
    if (!isEmptyPart(part) && counts.get(part.name) !== 0) return part;
  }
  return null;
}

/** A line the line box names: a global line, or a line of a part. */
export type ChainLineTarget =
  { kind: 'global'; line: number } | { kind: 'local'; part: string; line: number };

/** What the line box read: a line to go to, or why the text names none. */
export type ChainLineInput = ChainLineTarget | { kind: 'invalid'; message: string };

const LINE_NUMBER = /^\d+$/;

/** Why each kind of text is refused. */
const REFUSALS = {
  notLine: 'Type a line number or part:line (app.log.3.gz:500)',
  notFromOne: 'Lines are numbered from 1',
  notReady: 'Global line numbers wait for the chain index; type part:line',
  unknownPart: (part: string) => `No part named ${part} in this chain`,
};

/**
 * Read the chain line box: a global line number (`123456`) once the
 * chain is ready, or a part's line as `part:line` (`syslog.3.gz:500`)
 * in any state. The text splits at its last colon, so a part name may
 * hold one; the part must be one of the chain's.
 */
export function parseChainLineTarget(
  text: string,
  chain: Pick<ChainResponse, 'state' | 'parts'>,
): ChainLineInput {
  const value = text.trim();
  if (LINE_NUMBER.test(value)) {
    const line = Number(value);
    if (line < 1) return { kind: 'invalid', message: REFUSALS.notFromOne };
    if (chain.state !== 'ready') return { kind: 'invalid', message: REFUSALS.notReady };
    return { kind: 'global', line };
  }

  const colon = value.lastIndexOf(':');
  const part = value.slice(0, colon);
  const number = value.slice(colon + 1);
  if (colon <= 0 || !LINE_NUMBER.test(number)) {
    return { kind: 'invalid', message: REFUSALS.notLine };
  }
  if (!chain.parts.some((p) => p.name === part)) {
    return { kind: 'invalid', message: REFUSALS.unknownPart(part) };
  }
  const line = Number(number);
  if (line < 1) return { kind: 'invalid', message: REFUSALS.notFromOne };
  return { kind: 'local', part, line };
}

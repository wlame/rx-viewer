/**
 * The lines a log chain's tab holds, read from `/v1/logs/samples`
 * answers, and the page each scroll asks for next.
 *
 * Each key of a chain samples answer holds pieces, one per part its
 * window touches. The tab flattens them into lines that keep their part
 * and their number in it. A ready chain numbers the lines by global line.
 * A pending chain has no global numbers: its pages stay in one part and
 * continue into the next or previous part at an edge, and the tab numbers
 * the lines it holds by positions, each part's line L at the part's base
 * plus L, so the held lines stay in order and one apart across an edge
 * (the editor counts on that). A part's base is set only once the line
 * count it depends on is known.
 *
 * Everything here is pure, so it is tested without a backend.
 */
import type { ChainAnchor, ChainPart, ChainPiece, ChainSamplesResponse, FileLine } from '../types';
import { neighbourPartWithLines } from './chainParts';
import { keySpan, type SampleWindow } from './sampleWindow';
import { LINES_PER_PAGE, STREAM_LINES_PER_PAGE } from './slidingWindow';

/**
 * The base of the first part a pending chain's tab reads. Paging back
 * subtracts the earlier parts' line counts from it, so it sits far above
 * any count; it stays far below the largest safe integer.
 */
export const LOCAL_NUMBERING_BASE = 1e12;

/** How the lines of an answer are numbered: by global line, or from each part's base. */
export type PieceNumbering =
  { kind: 'global' } | { kind: 'local'; bases: ReadonlyMap<string, number> };

/** The position of line `index` of `piece`. */
function positionOf(piece: ChainPiece, index: number, numbering: PieceNumbering): number {
  if (numbering.kind === 'global') return piece.first_global_line + index;
  const base = numbering.bases.get(piece.part);
  if (base === undefined) throw new Error(`No position is known for the part ${piece.part}`);
  return base + piece.first_local_line + index;
}

/** The lines of `pieces`, in order, each with its part, its line in it and its timestamp. */
export function flattenPieces(
  pieces: readonly ChainPiece[],
  numbering: PieceNumbering,
): FileLine[] {
  return pieces.flatMap((piece) =>
    piece.lines.map((content, i) => ({
      lineNumber: positionOf(piece, i, numbering),
      content,
      timestampMs: piece.line_timestamps?.[i] ?? null,
      part: piece.part,
      localLine: piece.first_local_line + i,
    })),
  );
}

/** Every piece of an answer, key by key. */
export function piecesOf(answer: Pick<ChainSamplesResponse, 'samples'>): ChainPiece[] {
  return Object.values(answer.samples).flatMap((pieces) => pieces ?? []);
}

/**
 * `counts` with the line count of each part a piece ends: the last line
 * a piece that reaches its part's end holds.
 */
export function learnCounts(
  counts: ReadonlyMap<string, number>,
  pieces: readonly ChainPiece[],
): Map<string, number> {
  const learned = new Map(counts);
  for (const piece of pieces) {
    if (piece.part_end && piece.lines.length > 0) {
      learned.set(piece.part, piece.first_local_line + piece.lines.length - 1);
    }
  }
  return learned;
}

/** The parts of an answer a ready chain's window is read from. */
type GlobalAnswer = Pick<ChainSamplesResponse, 'samples' | 'before_context' | 'after_context'>;

/**
 * Read the answer to a request by global line or range of a ready chain
 * into one window, as `readSamplesAnswer` reads a file's: a range `a-b`
 * covers lines a to b, a line `N` its context, and fewer lines than the
 * key asks for end the chain inside the window.
 */
export function readGlobalWindow(answer: GlobalAnswer): SampleWindow {
  const byNumber = new Map<number, FileLine>();
  let reachedStart = false;
  let reachedEnd = false;
  let lineCount: number | null = null;

  for (const [key, pieces] of Object.entries(answer.samples)) {
    const { first, last } = keySpan(key, answer.before_context, answer.after_context);
    const lines = flattenPieces(pieces ?? [], { kind: 'global' });
    for (const line of lines) byNumber.set(line.lineNumber, line);
    const isShort = lines.length < last - first + 1;
    reachedStart ||= first === 1;
    reachedEnd ||= isShort;
    if (isShort && lineCount === null) {
      lineCount = lines.length > 0 ? lines[lines.length - 1].lineNumber : first === 1 ? 0 : null;
    }
  }

  const lines = Array.from(byNumber.values()).sort((a, b) => a.lineNumber - b.lineNumber);
  return { lines, reachedStart, reachedEnd, lineCount };
}

/** What a chain time query found: its global line and the window around it, or no line. */
export type ChainTimeAnswer =
  { found: true; line: number; window: SampleWindow } | { found: false };

/**
 * Read the answer to one time query of a ready chain, as `readTimeAnswer`
 * reads a file's: the window filed under the value, read as its line's
 * (or, for a time range, its lines') own key would be.
 */
export function readChainTimeAnswer(
  answer: GlobalAnswer & Pick<ChainSamplesResponse, 'timestamps'>,
  value: string,
): ChainTimeAnswer {
  const line = answer.timestamps[value];
  if (line === undefined) throw new Error(`The samples answer does not list the time "${value}"`);
  if (line === -1) return { found: false };

  const pieces = answer.samples[value] ?? null;
  const count = (pieces ?? []).reduce((sum, piece) => sum + piece.lines.length, 0);
  const key = value.includes('..') ? `${line}-${line + Math.max(count, 1) - 1}` : String(line);
  return { found: true, line, window: readGlobalWindow({ ...answer, samples: { [key]: pieces } }) };
}

/** The compression formats whose parts are read as streams: from their start, or a checkpoint. */
const STREAM_FORMATS: ReadonlySet<string> = new Set(['gzip', 'bz2', 'xz', 'zstd']);

/**
 * How many lines one page of a chain loads when it touches the parts
 * `names`: 5,000 when one of them is a gzip, bzip2, xz or zstd part,
 * 1,000 otherwise. A part's description does not say whether its zstd is
 * seekable, so a zstd part pages as a stream; a seekable one only gets
 * larger pages.
 */
export function chainPageSize(parts: readonly ChainPart[], names: readonly string[]): number {
  const touchesStream = parts.some(
    (part) =>
      names.includes(part.name) &&
      part.compression_format !== null &&
      STREAM_FORMATS.has(part.compression_format),
  );
  return touchesStream ? STREAM_LINES_PER_PAGE : LINES_PER_PAGE;
}

/** The parts of a ready chain whose global lines meet `first` to `last`. */
function partsTouched(parts: readonly ChainPart[], first: number, last: number): string[] {
  return parts
    .filter((part) => {
      if (part.global_start === null || part.size === 0) return false;
      const end = part.line_count === null ? Infinity : part.global_start + part.line_count - 1;
      return part.global_start <= last && end >= first;
    })
    .map((part) => part.name);
}

/** A page of a ready chain: its global lines and its size. */
export interface GlobalPage {
  first: number;
  last: number;
  size: number;
}

/**
 * The page a ready chain's tab loads next to the held lines: the lines
 * after the last or before the first, 5,000 of them when the next 1,000
 * touch a stream part, else 1,000. A page before stops at line 1.
 */
export function globalPage(
  held: { startLine: number; endLine: number },
  direction: 'before' | 'after',
  parts: readonly ChainPart[],
): GlobalPage {
  const probe =
    direction === 'after'
      ? { first: held.endLine + 1, last: held.endLine + LINES_PER_PAGE }
      : { first: Math.max(1, held.startLine - LINES_PER_PAGE), last: held.startLine - 1 };
  const size = chainPageSize(parts, partsTouched(parts, probe.first, probe.last));
  if (direction === 'after') {
    return { first: held.endLine + 1, last: held.endLine + size, size };
  }
  return { first: Math.max(1, held.startLine - size), last: held.startLine - 1, size };
}

/** One page of a pending chain: lines of one part, as `part` and `lines` of a samples request. */
export interface PendingPage {
  part: string;
  /** A range of the part's own lines, or `-1` for its last line. */
  lines: string;
  beforeContext?: number;
  afterContext?: number;
}

/** The most context lines the backend serves on a side. */
const MAX_CONTEXT = 100;

/** A line of a part: the edge of the held lines a page continues from. */
export interface PartLine {
  part: string;
  localLine: number;
}

/**
 * The page a pending chain's tab loads next to the held lines, whose
 * edge in that direction is `edge`: more lines of the same part, or, at
 * the part's known end or start, the first or last lines of the next or
 * previous part with lines. The last part with lines may grow, so a page
 * after it always asks it again. A previous part whose count is unknown
 * gives its last 101 lines (`-1` with 100 lines of context before it),
 * which tells its count. Null at the chain's start.
 */
export function pendingPage(
  edge: PartLine,
  direction: 'before' | 'after',
  parts: readonly ChainPart[],
  counts: ReadonlyMap<string, number>,
): PendingPage | null {
  const sizeOf = (name: string) => chainPageSize(parts, [name]);

  if (direction === 'after') {
    const count = counts.get(edge.part);
    const next = neighbourPartWithLines(parts, edge.part, 'after', counts);
    if (next !== null && count !== undefined && edge.localLine >= count) {
      return { part: next.name, lines: `1-${sizeOf(next.name)}` };
    }
    const size = sizeOf(edge.part);
    return { part: edge.part, lines: `${edge.localLine + 1}-${edge.localLine + size}` };
  }

  if (edge.localLine > 1) {
    const first = Math.max(1, edge.localLine - sizeOf(edge.part));
    return { part: edge.part, lines: `${first}-${edge.localLine - 1}` };
  }
  const previous = neighbourPartWithLines(parts, edge.part, 'before', counts);
  if (previous === null) return null;
  const count = counts.get(previous.name);
  if (count === undefined) {
    return { part: previous.name, lines: '-1', beforeContext: MAX_CONTEXT, afterContext: 0 };
  }
  return {
    part: previous.name,
    lines: `${Math.max(1, count - sizeOf(previous.name) + 1)}-${count}`,
  };
}

/**
 * The base of the part a pending page read (`pagePart`), next to the held
 * lines whose edge is in `edgePart`: the same base in the same part; for
 * the next part, right after the edge part's last line; for the previous
 * part, right before the edge part's first line. Null while a count it
 * needs is unknown.
 */
export function pageBase(
  bases: ReadonlyMap<string, number>,
  counts: ReadonlyMap<string, number>,
  edgePart: string,
  pagePart: string,
  direction: 'before' | 'after',
): number | null {
  const edgeBase = bases.get(edgePart);
  if (edgeBase === undefined) return null;
  if (pagePart === edgePart) return edgeBase;
  const count = counts.get(direction === 'after' ? edgePart : pagePart);
  if (count === undefined) return null;
  return direction === 'after' ? edgeBase + count : edgeBase - count;
}

/**
 * Whether a pending chain's held lines reach its start (line 1 of its
 * first part with lines) and its end (the known last line of its last
 * part with lines).
 */
export function pendingEnds(
  lines: readonly FileLine[],
  parts: readonly ChainPart[],
  counts: ReadonlyMap<string, number>,
): { reachedStart: boolean; reachedEnd: boolean } {
  const first = lines[0];
  const last = lines.at(-1);
  const firstPart = neighbourPartWithLines(parts, null, 'after', counts);
  const lastPart = neighbourPartWithLines(parts, null, 'before', counts);
  const lastCount = last?.part === undefined ? undefined : counts.get(last.part);
  return {
    reachedStart: first !== undefined && first.part === firstPart?.name && first.localLine === 1,
    reachedEnd:
      last !== undefined &&
      last.part === lastPart?.name &&
      lastCount !== undefined &&
      (last.localLine ?? 0) >= lastCount,
  };
}

/**
 * The anchor the URL names for the held line at `position`: its part, its
 * line in it and its timestamp; null when the window does not hold it.
 * The held lines are one apart, so the line is found by its offset from
 * the first.
 */
export function anchorAt(
  lines: readonly FileLine[],
  startLine: number,
  position: number,
): ChainAnchor | null {
  const line = lines[position - startLine];
  if (line?.lineNumber !== position || line.part === undefined || line.localLine === undefined) {
    return null;
  }
  return { part: line.part, line: line.localLine, timeMs: line.timestampMs ?? null };
}

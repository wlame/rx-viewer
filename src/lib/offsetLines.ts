/**
 * Resolves the line numbers a search answer left unknown.
 *
 * A match always carries an absolute byte offset, even when the backend
 * could not say which file line it is on (see resolveMatchLine), and
 * `/v1/samples?offsets=` turns offsets into lines. Two kinds of lookup
 * happen: a batch for every unknown line as soon as results arrive, and a
 * single one when the user clicks a match the batch did not cover.
 *
 * Both are superseded often — a new search replaces the batch, a second
 * click replaces the first — so each runs in its own LatestRequest: the
 * superseded request is aborted and its answer is never reported.
 *
 * An offset the lookup cannot number comes back with the reason, so the
 * result list can say why a line stays unknown and a click on it can say
 * why it does not jump: the backend's own sentence when it refuses or
 * fails, or noLineAtOffset when its answer has no line at that byte.
 */
import { api } from './api';
import { resolveMatchLine } from './utils/matchLine';
import { LatestRequest, SUPERSEDED, isAbortError } from './utils/latestRequest';
import type { TraceResponse } from './types';

/**
 * At most this many offsets per file are resolved as soon as results
 * arrive. Both backends answer a whole batch from one pass over the file,
 * so the cap bounds the response, which carries a context window per
 * offset, rather than the scan. Anything beyond it resolves on click.
 */
export const EAGER_RESOLVE_LIMIT_PER_FILE = 200;

/** Lines found so far, keyed by offsetKey. */
export type ResolvedLines = Record<string, number>;

/** Why a match's line could not be found, keyed by offsetKey. */
export type UnresolvedReasons = Record<string, string>;

/** The answer to the lookup of one offset: its line, or why there is none. */
export type OffsetLookup = { line: number } | { reason: string };

/**
 * The reason given when the backend answers but names no line for the
 * offset, which is how it reports a byte past the end of the file.
 */
export function noLineAtOffset(offset: number): string {
  return `the file has no line at byte ${offset}; it may have changed since the search`;
}

/** The reason a lookup failed, in the backend's words when it gave any. */
function reasonForFailure(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'the line lookup failed';
}

/** The key of one match position: one lookup serves the list and the jump. */
export function offsetKey(filePath: string, offset: number): string {
  return `${filePath}:${offset}`;
}

/**
 * The offsets of matches whose line the answer does not give, grouped by
 * file path, at most `limitPerFile` distinct offsets per file.
 */
export function unresolvedOffsetsByFile(
  response: TraceResponse,
  limitPerFile: number = EAGER_RESOLVE_LIMIT_PER_FILE,
): Map<string, number[]> {
  const offsetsByFile = new Map<string, number[]>();
  for (const match of response.matches) {
    if (resolveMatchLine(match, response).kind === 'line') continue;
    const filePath = response.files[match.file] ?? match.file;
    const offsets = offsetsByFile.get(filePath) ?? [];
    if (offsets.length >= limitPerFile) continue;
    if (!offsets.includes(match.offset)) offsets.push(match.offset);
    offsetsByFile.set(filePath, offsets);
  }
  return offsetsByFile;
}

/**
 * Split a samples answer for `offsets` into the lines it gives and, for
 * every offset it gives none, the reason; both keyed by offsetKey.
 */
function lookupsFromAnswer(
  filePath: string,
  offsets: number[],
  answer: Record<string, number> | null | undefined,
): { lines: ResolvedLines; reasons: UnresolvedReasons } {
  const lines: ResolvedLines = {};
  const reasons: UnresolvedReasons = {};
  for (const offset of offsets) {
    const line = answer?.[String(offset)];
    if (typeof line === 'number' && line >= 1) lines[offsetKey(filePath, offset)] = line;
    else reasons[offsetKey(filePath, offset)] = noLineAtOffset(offset);
  }
  return { lines, reasons };
}

/** The same reason for every offset of one file. */
function sameReasonFor(filePath: string, offsets: number[], reason: string): UnresolvedReasons {
  return Object.fromEntries(offsets.map((offset) => [offsetKey(filePath, offset), reason]));
}

export class OffsetLineResolver {
  private batch = new LatestRequest();
  private single = new LatestRequest();

  /**
   * Resolve every unknown line of `response`, one request per file,
   * reporting each file's lines through `onLines` and the offsets it could
   * not number, with the reason, through `onUnresolved`, as each file's
   * answer arrives.
   *
   * Starting a batch aborts the previous batch and any click lookup, which
   * belonged to the previous search. A null response only cancels. A file
   * whose lookup fails reports the failure for each of its offsets; a
   * click retries.
   */
  async resolveAll(
    response: TraceResponse | null,
    onLines: (lines: ResolvedLines) => void,
    onUnresolved: (reasons: UnresolvedReasons) => void = () => {},
  ): Promise<void> {
    this.single.abort();
    if (!response) {
      this.batch.abort();
      return;
    }
    const offsetsByFile = unresolvedOffsetsByFile(response);
    if (offsetsByFile.size === 0) {
      this.batch.abort();
      return;
    }

    await this.batch.run((signal) =>
      Promise.all(
        [...offsetsByFile].map(async ([filePath, offsets]) => {
          try {
            const samples = await api.getSamplesByOffset(filePath, offsets, 0, { signal });
            if (signal.aborted) return;
            const { lines, reasons } = lookupsFromAnswer(filePath, offsets, samples.offsets);
            if (Object.keys(lines).length > 0) onLines(lines);
            if (Object.keys(reasons).length > 0) onUnresolved(reasons);
          } catch (error) {
            // An aborted lookup belongs to a search nobody is looking at.
            if (signal.aborted || isAbortError(error)) return;
            onUnresolved(sameReasonFor(filePath, offsets, reasonForFailure(error)));
          }
        }),
      ),
    );
  }

  /**
   * The line of one byte offset, for a click on a match, or the reason
   * there is none; SUPERSEDED when another click or a new search took
   * over first.
   */
  async resolveOne(filePath: string, offset: number): Promise<OffsetLookup | typeof SUPERSEDED> {
    try {
      const samples = await this.single.run((signal) =>
        api.getSamplesByOffset(filePath, [offset], 0, { signal }),
      );
      if (samples === SUPERSEDED) return SUPERSEDED;
      const key = offsetKey(filePath, offset);
      const { lines, reasons } = lookupsFromAnswer(filePath, [offset], samples.offsets);
      return key in lines ? { line: lines[key] } : { reason: reasons[key] };
    } catch (error) {
      return { reason: reasonForFailure(error) };
    }
  }

  /** Abort every lookup in flight, for when the results go away. */
  cancel(): void {
    this.batch.abort();
    this.single.abort();
  }
}

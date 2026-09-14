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
 */
import { api } from './api';
import { resolveMatchLine } from './utils/matchLine';
import { LatestRequest, SUPERSEDED } from './utils/latestRequest';
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

/** The valid lines a samples answer gives for `offsets`, keyed by offsetKey. */
function linesFromAnswer(
  filePath: string,
  offsets: number[],
  answer: Record<string, number> | null | undefined,
): ResolvedLines {
  const found: ResolvedLines = {};
  for (const offset of offsets) {
    const line = answer?.[String(offset)];
    if (typeof line === 'number' && line >= 1) found[offsetKey(filePath, offset)] = line;
  }
  return found;
}

export class OffsetLineResolver {
  private batch = new LatestRequest();
  private single = new LatestRequest();

  /**
   * Resolve every unknown line of `response`, one request per file,
   * reporting each file's lines through `onLines` as its answer arrives.
   *
   * Starting a batch aborts the previous batch and any click lookup, which
   * belonged to the previous search. A null response only cancels. A file
   * whose lookup fails is skipped: its matches keep showing the offset,
   * and a click retries.
   */
  async resolveAll(
    response: TraceResponse | null,
    onLines: (lines: ResolvedLines) => void,
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
            onLines(linesFromAnswer(filePath, offsets, samples.offsets));
          } catch {
            // Aborted, or the lookup failed: either way nothing to report.
          }
        }),
      ),
    );
  }

  /**
   * The line of one byte offset, for a click on a match. Null when the
   * backend cannot say; SUPERSEDED when another click or a new search
   * took over first.
   */
  async resolveOne(filePath: string, offset: number): Promise<number | null | typeof SUPERSEDED> {
    try {
      const samples = await this.single.run((signal) =>
        api.getSamplesByOffset(filePath, [offset], 0, { signal }),
      );
      if (samples === SUPERSEDED) return SUPERSEDED;
      return (
        linesFromAnswer(filePath, [offset], samples.offsets)[offsetKey(filePath, offset)] ?? null
      );
    } catch {
      // The jump still works from the offset's file window; a failed
      // lookup only costs the gutter number.
      return null;
    }
  }

  /** Abort every lookup in flight, for when the results go away. */
  cancel(): void {
    this.batch.abort();
    this.single.abort();
  }
}

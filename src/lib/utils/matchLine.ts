import type { TraceMatch, TraceResponse } from '../types';

/**
 * Where a match sits in its file.
 *
 * `line` is a 1-based absolute line number, safe to navigate to.
 * `unknown` means the response does not say which file line the match is
 * on; the byte offset is always absolute, so the caller resolves the line
 * through `/v1/samples`.
 */
export type MatchLine = { kind: 'line'; line: number } | { kind: 'unknown'; offset: number };

/** The backend did not know the absolute line number. */
const UNKNOWN_ABSOLUTE_LINE = -1;

/**
 * Work out which line of the file a match is on.
 *
 * Both backends scan large files as several chunks in parallel, and a
 * match's `relative_line_number` counts from the start of its chunk. It
 * equals the file line only when the file was scanned as a single chunk,
 * which `file_chunks[fileId] === 1` reports. Treating it as absolute
 * otherwise sends the editor to an unrelated line — the further into the
 * file the match is, the further off it lands.
 */
export function resolveMatchLine(match: TraceMatch, response: TraceResponse): MatchLine {
  if (match.absolute_line_number !== UNKNOWN_ABSOLUTE_LINE && match.absolute_line_number >= 1) {
    return { kind: 'line', line: match.absolute_line_number };
  }

  const chunks = response.file_chunks?.[match.file];
  if (chunks === 1 && match.relative_line_number != null && match.relative_line_number >= 1) {
    return { kind: 'line', line: match.relative_line_number };
  }

  return { kind: 'unknown', offset: match.offset };
}

import type { SearchResponse, TraceResponse } from '../types';
import { isChainSearchAnswer } from './chainSearch';

/** At most this many skipped files are listed under a search's summary. */
export const SKIPPED_FILES_SHOWN = 100;

/**
 * How many files a search covered. `files` holds every file the search
 * read, whether it was named in the request or found under a directory;
 * `scanned_files` holds only the second kind, so it reads 0 for a search
 * of named files.
 */
export function searchedFileCount(response: TraceResponse): number {
  return Object.keys(response.files).length;
}

/** A file a search left out, with the backend's reason, or null when it gave none. */
export interface SkippedEntry {
  path: string;
  reason: string | null;
}

/**
 * The files a search left out, in the answer's order, at most `limit` of
 * them, and how many more there are. `skip_reasons` gives one reason per
 * path of `skipped_files`, in the same order: a trace's reasons (a binary
 * file, a file that cannot be read) and, in a chain search,
 * `duplicate_part` for another encoding of a part the chain reads.
 */
export function skippedFiles(
  response: TraceResponse,
  limit: number = SKIPPED_FILES_SHOWN,
): { shown: SkippedEntry[]; more: number } {
  const paths = response.skipped_files ?? [];
  const reasons = new Map((response.skip_reasons ?? []).map((entry) => [entry.path, entry.reason]));
  const shown = paths.slice(0, limit).map((path) => ({ path, reason: reasons.get(path) ?? null }));
  return { shown, more: paths.length - shown.length };
}

/** How many log chains a search found: none for a trace's answer. */
export function chainCount(response: SearchResponse): number {
  return isChainSearchAnswer(response) ? Object.keys(response.chains).length : 0;
}

/**
 * `path` as it reads under the searched path that holds it: relative to
 * the deepest one, the name alone for a path the search named itself,
 * and whole when no searched path holds it.
 */
export function pathInSearch(path: string, searched: readonly string[]): string {
  let shortest = path;
  for (const root of searched) {
    if (root === path) return path.slice(path.lastIndexOf('/') + 1);
    const prefix = root.endsWith('/') ? root : `${root}/`;
    if (path.startsWith(prefix) && path.length - prefix.length < shortest.length) {
      shortest = path.slice(prefix.length);
    }
  }
  return shortest;
}

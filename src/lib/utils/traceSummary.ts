import type { TraceResponse } from '../types';

/**
 * How many files a search covered. `files` holds every file the search
 * read, whether it was named in the request or found under a directory;
 * `scanned_files` holds only the second kind, so it reads 0 for a search
 * of named files.
 */
export function searchedFileCount(response: TraceResponse): number {
  return Object.keys(response.files).length;
}

/**
 * Utility for managing application state in URL parameters
 */
import type { TraceMatchingFlags } from '../types';
import { SEARCH_TOGGLES } from './searchToggles';

export interface FileState {
  path: string;
  line: number;
  syntaxHighlighting: boolean;
}

/**
 * Update URL with current file state without reloading the page
 */
export function updateUrlState(state: FileState | null): void {
  if (typeof window === 'undefined') return;

  const url = new URL(window.location.href);

  if (state) {
    url.searchParams.set('file', state.path);
    url.searchParams.set('line', state.line.toString());
    url.searchParams.set('highlight', state.syntaxHighlighting ? '1' : '0');
  } else {
    // Clear file-related params
    url.searchParams.delete('file');
    url.searchParams.delete('line');
    url.searchParams.delete('highlight');
  }

  window.history.replaceState({}, '', url.toString());
}

/**
 * Read file state from URL parameters
 */
export function readUrlState(): FileState | null {
  if (typeof window === 'undefined') return null;

  const params = new URLSearchParams(window.location.search);
  const path = params.get('file');
  const lineStr = params.get('line');
  const highlightStr = params.get('highlight');

  if (!path) return null;

  const line = lineStr ? parseInt(lineStr, 10) : 1;
  const syntaxHighlighting = highlightStr === '1';

  return {
    path,
    line: isNaN(line) ? 1 : line,
    syntaxHighlighting,
  };
}

/** The cap the search panel starts with. */
export const DEFAULT_MAX_RESULTS = 100;

/** The highest cap the search panel accepts. */
const MAX_RESULTS_LIMIT = 10_000;

/** A search as the URL carries it: what the search panel needs to run it again. */
export interface SearchState {
  patterns: string[];
  maxResults: number;
  onlyOpenedFiles: boolean;
  /** Only the flags the panel's toggles can set. */
  flags: TraceMatchingFlags;
}

/** The flag parameters the search panel can set, named as /v1/trace names them. */
const SEARCH_FLAG_PARAMS = SEARCH_TOGGLES.map((spec) => spec.param);

/** Every parameter that belongs to the search, so a write can replace them all. */
const SEARCH_PARAMS = ['regexp', 'max_results', 'only_opened', ...SEARCH_FLAG_PARAMS];

/** A boolean URL parameter is on when it reads `1` or `true`. */
function isOn(value: string | null): boolean {
  return value === '1' || value === 'true';
}

/** A cap from the URL, or the default when it is not a whole number in range. */
function parseMaxResults(value: string | null): number {
  if (value === null || !/^\d+$/.test(value)) return DEFAULT_MAX_RESULTS;
  const cap = Number(value);
  return cap >= 1 && cap <= MAX_RESULTS_LIMIT ? cap : DEFAULT_MAX_RESULTS;
}

/**
 * Put the search in the URL, replacing the one there, under the names
 * /v1/trace uses. Values at their default are left out, so a link shows
 * what makes this search differ from a plain one. Null removes the
 * search and keeps the rest of the URL.
 */
export function updateSearchUrlState(search: SearchState | null): void {
  if (typeof window === 'undefined') return;

  const url = new URL(window.location.href);
  for (const name of SEARCH_PARAMS) url.searchParams.delete(name);

  if (search) {
    for (const pattern of search.patterns) url.searchParams.append('regexp', pattern);
    if (search.maxResults !== DEFAULT_MAX_RESULTS) {
      url.searchParams.set('max_results', String(search.maxResults));
    }
    if (search.onlyOpenedFiles) url.searchParams.set('only_opened', '1');
    for (const name of SEARCH_FLAG_PARAMS) {
      if (search.flags[name]) url.searchParams.set(name, '1');
    }
  }

  window.history.replaceState({}, '', url.toString());
}

/**
 * Read the search from the URL, or null when it names no pattern. The URL
 * is input like any other: an empty pattern is dropped, a cap out of
 * range falls back to the default, and a parameter the panel cannot set
 * is ignored.
 */
export function readSearchUrlState(): SearchState | null {
  if (typeof window === 'undefined') return null;

  const params = new URLSearchParams(window.location.search);
  const patterns = params.getAll('regexp').filter((pattern) => pattern.trim() !== '');
  if (patterns.length === 0) return null;

  const flags: TraceMatchingFlags = {};
  for (const name of SEARCH_FLAG_PARAMS) {
    if (isOn(params.get(name))) flags[name] = true;
  }

  return {
    patterns,
    maxResults: parseMaxResults(params.get('max_results')),
    onlyOpenedFiles: isOn(params.get('only_opened')),
    flags,
  };
}

/**
 * Debounce function for scroll events
 */
export function debounce<T extends (...args: any[]) => any>(
  fn: T,
  delay: number,
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return (...args: Parameters<T>) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      fn(...args);
    }, delay);
  };
}

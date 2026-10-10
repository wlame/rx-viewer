import { writable, type Writable } from 'svelte/store';
import {
  DEFAULT_SEARCH_TOGGLES,
  togglesFromFlags,
  type SearchToggles,
} from '../utils/searchToggles';
import { DEFAULT_MAX_RESULTS, MAX_RESULTS_LIMIT, type SearchState } from '../utils/urlState';

/**
 * The search panel's form as the user left it, sent or not: the
 * patterns, the match toggles, whether only the opened files are
 * searched, and the max box's text as typed. It outlives the panel, so
 * a panel switch keeps an unsent edit. A link fills it
 * (`draftFromSearch`); running the search writes `searchRequest` from
 * it, and the URL holds only that.
 */
export interface SearchDraft {
  patterns: string[];
  toggles: SearchToggles;
  onlyOpenedFiles: boolean;
  /** The max box's text; `parseMaxResults` reads it. */
  maxResults: string;
}

/** Digits only, at most as many as the highest cap has. */
const MAX_RESULTS_TEXT = /^[0-9]{1,5}$/;

/**
 * The cap the max box's `text` names: a whole number from 1 to 10,000
 * written in digits only, else null. A value out of range is refused,
 * never changed into one in range.
 */
export function parseMaxResults(text: string): number | null {
  if (!MAX_RESULTS_TEXT.test(text)) return null;
  const value = Number(text);
  return value >= 1 && value <= MAX_RESULTS_LIMIT ? value : null;
}

/** The form a link's `search` fills, or the empty form when it names none. */
export function draftFromSearch(search: SearchState | null): SearchDraft {
  if (!search) {
    return {
      patterns: [''],
      toggles: { ...DEFAULT_SEARCH_TOGGLES },
      onlyOpenedFiles: false,
      maxResults: String(DEFAULT_MAX_RESULTS),
    };
  }
  return {
    patterns: [...search.patterns],
    toggles: togglesFromFlags(search.flags),
    onlyOpenedFiles: search.onlyOpenedFiles,
    maxResults: String(search.maxResults),
  };
}

export const searchDraft: Writable<SearchDraft> = writable(draftFromSearch(null));

import { writable } from 'svelte/store';
import { api } from '../api';
import { LatestRequest, SUPERSEDED, isAbortError } from '../utils/latestRequest';
import type { TraceMatch, TraceMatchingFlags, TraceResponse } from '../types';
import type { SearchState } from '../utils/urlState';
import { commandLog } from './commands';
import { files } from './files';

/**
 * The search the user last ran, as the search panel's form held it, or
 * null for none. The URL carries it, and the panel reads its form from
 * it, so a link or Back can bring a search back.
 */
export const searchRequest = writable<SearchState | null>(null);

/** What a search asks the backend for besides paths and patterns. */
export interface SearchQuery {
  maxResults?: number;
  flags?: TraceMatchingFlags;
}

interface TraceState {
  query: string;
  searching: boolean;
  response: TraceResponse | null;
  error: string | null;
}

function createTraceStore() {
  const { subscribe, set, update } = writable<TraceState>({
    query: '',
    searching: false,
    response: null,
    error: null,
  });

  // Only the newest search may write to the store. Typing a query and
  // then refining it used to leave whichever response arrived last on
  // screen, which is not necessarily the one the user asked for.
  const latestSearch = new LatestRequest();

  async function search(paths: string[], patterns: string[], query: SearchQuery = {}) {
    if (patterns.length === 0) return;

    // The editor's match highlights belong to the previous search.
    files.clearMatches();
    update((s) => ({
      ...s,
      query: patterns.join(' | '),
      searching: true,
      error: null,
      response: null,
    }));

    try {
      const response = await latestSearch.run((signal) =>
        api.trace(paths, patterns, query, { signal }),
      );

      // A newer search is already running; leave the store to it rather
      // than flashing this query's results on the way past.
      if (response === SUPERSEDED) return null;

      commandLog.record(response.cli_command, 'search');
      update((s) => ({
        ...s,
        searching: false,
        response,
      }));

      return response;
    } catch (e) {
      // A cancelled search is not a failure the user should see.
      if (isAbortError(e)) return null;

      update((s) => ({
        ...s,
        searching: false,
        error: e instanceof Error ? e.message : 'Search failed',
      }));
      return null;
    }
  }

  function setQuery(query: string) {
    update((s) => ({ ...s, query }));
  }

  function clear() {
    latestSearch.abort();
    files.clearMatches();
    set({
      query: '',
      searching: false,
      response: null,
      error: null,
    });
  }

  /**
   * Get matches for a specific file path from the last search
   */
  function getMatchesForFile(filePath: string): TraceMatch[] {
    const matches: TraceMatch[] = [];

    const state = getState();
    if (!state.response) return matches;

    // Find the file ID for this path
    const fileId = Object.entries(state.response.files).find(([, path]) => path === filePath)?.[0];

    if (!fileId) return matches;

    // Filter matches for this file
    return state.response.matches.filter((m) => m.file === fileId);
  }

  // Helper to get current state synchronously
  function getState(): TraceState {
    let state: TraceState;
    subscribe((s) => (state = s))();
    return state!;
  }

  return {
    subscribe,
    search,
    setQuery,
    clear,
    getMatchesForFile,
  };
}

export const trace = createTraceStore();

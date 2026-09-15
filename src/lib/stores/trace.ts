import { writable } from 'svelte/store';
import { api } from '../api';
import { LatestRequest, SUPERSEDED, isAbortError } from '../utils/latestRequest';
import type { TraceMatchingFlags, TraceResponse } from '../types';
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
  searching: boolean;
  response: TraceResponse | null;
  error: string | null;
}

function createTraceStore() {
  const { subscribe, set, update } = writable<TraceState>({
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

  function clear() {
    latestSearch.abort();
    files.clearMatches();
    set({
      searching: false,
      response: null,
      error: null,
    });
  }

  return {
    subscribe,
    search,
    clear,
  };
}

export const trace = createTraceStore();

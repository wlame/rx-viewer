import { writable } from 'svelte/store';
import { api } from '../api';
import { LatestRequest, SUPERSEDED, isAbortError } from '../utils/latestRequest';
import type { SearchResponse, TraceMatchingFlags } from '../types';
import type { SearchState } from '../utils/urlState';
import { commandLog } from './commands';
import { files } from './files';

/**
 * The search the URL names: the one the user last ran, or the one a link
 * or Back brought in; null for none. The search panel's form is
 * `searchDraft`, which may hold edits not yet sent. A link or Back fills
 * the form with this search too, and the panel runs it when it has no
 * answer yet.
 */
export const searchRequest = writable<SearchState | null>(null);

/** What a search asks the backend for besides paths and patterns. */
export interface SearchQuery {
  maxResults?: number;
  flags?: TraceMatchingFlags;
}

interface TraceState {
  searching: boolean;
  /** The last answer: a trace's, or a chain search's (`utils/chainSearch.ts`). */
  response: SearchResponse | null;
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

  /**
   * Run one search, `request`, as the newest: the store shows its answer
   * or its failure, and a search started after it supersedes it.
   */
  async function run(request: (signal: AbortSignal) => Promise<SearchResponse>) {
    // The editor's match highlights belong to the previous search.
    files.clearMatches();
    update((s) => ({
      ...s,
      searching: true,
      error: null,
      response: null,
    }));

    try {
      const response = await latestSearch.run(request);

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

  /** Search files and directories (`/v1/trace`). */
  async function search(paths: string[], patterns: string[], query: SearchQuery = {}) {
    if (patterns.length === 0) return;
    return run((signal) => api.trace(paths, patterns, query, { signal }));
  }

  /**
   * Search in chain mode (`/v1/logs/trace`): a directory's rotated logs
   * and each handle are searched as log chains, each chain's parts in its
   * order, and each match names its chain and its line in it.
   */
  async function searchChains(paths: string[], patterns: string[], query: SearchQuery = {}) {
    if (patterns.length === 0) return;
    return run((signal) => api.logTrace(paths, patterns, query, { signal }));
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
    searchChains,
    clear,
  };
}

export const trace = createTraceStore();

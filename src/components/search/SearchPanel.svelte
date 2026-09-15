<script lang="ts">
  import { get } from 'svelte/store';
  import { trace, tree, files, health } from '$lib/stores';
  import { searchRequest } from '$lib/stores/trace';
  import { searchFocusRequested } from '$lib/stores/layout';
  import { contractSupports } from '$lib/utils/contractVersion';
  import { isShortcut } from '$lib/utils/shortcuts';
  import {
    DEFAULT_SEARCH_TOGGLES,
    matchingFlagParams,
    toggleForShortcut,
    togglesFromFlags,
    type SearchToggles as Toggles,
  } from '$lib/utils/searchToggles';
  import { DEFAULT_MAX_RESULTS, type SearchState } from '$lib/utils/urlState';
  import Spinner from '../common/Spinner.svelte';
  import SearchResults from './SearchResults.svelte';
  import SearchToggles from './SearchToggles.svelte';

  let searchPatterns: string[] = [''];
  let maxResults = DEFAULT_MAX_RESULTS;
  let showAdvanced = false;
  let onlyOpenedFiles = false; // Search only in currently opened files
  let toggles: Toggles = { ...DEFAULT_SEARCH_TOGGLES };
  let patternInputs: HTMLInputElement[] = [];

  // Cmd/Ctrl+K asks for the pattern field, possibly before this panel
  // existed; the request waits here until the field is there.
  $: if ($searchFocusRequested && patternInputs[0]) {
    patternInputs[0].focus();
    patternInputs[0].select();
    searchFocusRequested.set(false);
  }

  // A backend on an older contract ignores the matching flags, so the
  // toggles are disabled there rather than shown doing nothing.
  $: flagsSupported = contractSupports($health.contract, 'traceMatchingFlags');
  $: togglesUnavailable = flagsSupported
    ? null
    : 'This backend does not take match options (it needs API contract 1.3 or newer)';

  $: searchRoots = $tree.roots.map((r) => r.path);
  $: hasRoots = searchRoots.length > 0;

  // The form shows the current search. The panel is rebuilt each time
  // its tab opens, and a link or Back can set a search from outside it,
  // so the form follows `searchRequest`. A search that has no answer yet
  // (a link on page load, an entry Back moved to) runs once the
  // backend's health says which parameters it takes and the paths to
  // search are known.
  let restorePending = false;
  let shownRequest: SearchState | null = null;

  $: showRequest($searchRequest);

  function showRequest(request: SearchState | null) {
    if (request === shownRequest) return;
    shownRequest = request;
    if (!request) {
      searchPatterns = [''];
      restorePending = false;
      return;
    }
    searchPatterns = request.patterns;
    maxResults = request.maxResults;
    onlyOpenedFiles = request.onlyOpenedFiles;
    toggles = togglesFromFlags(request.flags);
    showAdvanced = request.onlyOpenedFiles || request.maxResults !== DEFAULT_MAX_RESULTS;
    const { response, searching } = get(trace);
    restorePending = response === null && !searching;
  }

  function runRestoredSearch() {
    restorePending = false;
    handleSearch();
  }

  $: pathsKnown = onlyOpenedFiles ? $files.openFiles.length > 0 : hasRoots;
  $: if (restorePending && !$health.loading && pathsKnown) runRestoredSearch();

  function addPattern() {
    searchPatterns = [...searchPatterns, ''];
  }

  function removePattern(index: number) {
    if (searchPatterns.length > 1) {
      searchPatterns = searchPatterns.filter((_, i) => i !== index);
    }
  }

  function updatePattern(index: number, value: string) {
    searchPatterns[index] = value;
  }

  async function handleSearch() {
    const validPatterns = searchPatterns.filter((p) => p.trim());
    if (validPatterns.length === 0) return;

    // Determine which paths to search
    let pathsToSearch: string[];
    if (onlyOpenedFiles) {
      // Search only in currently opened files
      pathsToSearch = $files.openFiles.map((f) => f.path);
      if (pathsToSearch.length === 0) {
        return; // No files open, nothing to search
      }
    } else {
      // Search in all search roots
      if (!hasRoots) return;
      pathsToSearch = searchRoots;
    }

    // The form already shows this search; only the URL needs it.
    shownRequest = {
      patterns: validPatterns,
      maxResults,
      onlyOpenedFiles,
      flags: matchingFlagParams(toggles),
    };
    searchRequest.set(shownRequest);

    // Search with all patterns
    await trace.search(pathsToSearch, validPatterns, {
      maxResults,
      flags: flagsSupported ? matchingFlagParams(toggles) : {},
    });
  }

  function handleKeydown(event: KeyboardEvent, _index: number) {
    const toggle = toggleForShortcut(event);
    if (toggle && flagsSupported) {
      event.preventDefault();
      toggles = { ...toggles, [toggle.key]: !toggles[toggle.key] };
      return;
    }
    if (isShortcut('runSearch', event)) {
      event.preventDefault();
      handleSearch();
    }
  }
</script>

<div class="flex flex-col h-full">
  <!-- Search patterns -->
  <div class="p-3 border-b border-gh-border-default dark:border-gh-border-dark-default">
    <!-- The fields stay usable during a search: a disabled field drops its
         focus, and a new search simply replaces the running one. -->
    <div class="space-y-2 mb-2">
      {#each searchPatterns as pattern, index (index)}
        <div class="flex gap-2">
          <input
            type="text"
            class="input flex-1 font-mono text-sm"
            placeholder="Regex pattern {index + 1}..."
            aria-label="Regex pattern {index + 1}"
            value={pattern}
            bind:this={patternInputs[index]}
            on:input={(e) => updatePattern(index, e.currentTarget.value)}
            on:keydown={(e) => handleKeydown(e, index)}
            disabled={!hasRoots}
          />
          {#if searchPatterns.length > 1}
            <button
              class="btn btn-secondary px-2"
              on:click={() => removePattern(index)}
              title="Remove pattern"
            >
              ✕
            </button>
          {/if}
        </div>
      {/each}
    </div>

    <div class="flex gap-2">
      <button class="btn btn-secondary text-xs" on:click={addPattern} disabled={!hasRoots}>
        + Add Pattern
      </button>
      <button
        class="btn btn-primary flex-1"
        on:click={handleSearch}
        disabled={$trace.searching ||
          searchPatterns.every((p) => !p.trim()) ||
          (!hasRoots && !onlyOpenedFiles) ||
          (onlyOpenedFiles && $files.openFiles.length === 0)}
      >
        {#if $trace.searching}
          <Spinner size="sm" />
        {:else}
          Search
        {/if}
      </button>
    </div>

    <!-- Advanced options toggle, and the match options, which apply to every pattern -->
    <div class="flex items-center justify-between mt-2">
      <button
        class="text-xs text-gh-accent-fg dark:text-gh-accent-dark-fg hover:underline"
        on:click={() => (showAdvanced = !showAdvanced)}
      >
        {showAdvanced ? '▼' : '▶'} Options
      </button>
      <SearchToggles bind:toggles disabled={!hasRoots} unavailableReason={togglesUnavailable} />
    </div>

    {#if showAdvanced}
      <div class="mt-3 space-y-2 text-sm">
        <!-- Max results -->
        <div class="flex items-center justify-between">
          <label for="max-results" class="text-gh-fg-muted dark:text-gh-fg-dark-muted">
            Max results
          </label>
          <input
            id="max-results"
            type="number"
            class="input w-24 text-sm"
            bind:value={maxResults}
            min="1"
            max="10000"
          />
        </div>

        <!-- Only opened files -->
        <div class="flex items-center gap-2">
          <input
            id="only-opened-files"
            type="checkbox"
            bind:checked={onlyOpenedFiles}
            class="rounded border-gh-border-default dark:border-gh-border-dark-default"
          />
          <label
            for="only-opened-files"
            class="text-gh-fg-muted dark:text-gh-fg-dark-muted cursor-pointer"
          >
            Only opened files
            {#if onlyOpenedFiles && $files.openFiles.length > 0}
              <span class="text-xs">({$files.openFiles.length})</span>
            {/if}
          </label>
        </div>
      </div>
    {/if}

    {#if !hasRoots && !onlyOpenedFiles}
      <p class="text-xs text-gh-fg-muted dark:text-gh-fg-dark-muted mt-2">
        No search roots available. Configure search roots or enable "Only opened files" to search.
      </p>
    {:else if onlyOpenedFiles && $files.openFiles.length === 0}
      <p class="text-xs text-gh-fg-muted dark:text-gh-fg-dark-muted mt-2">
        No files currently opened. Open some files to search in them.
      </p>
    {/if}
  </div>

  <SearchResults />
</div>

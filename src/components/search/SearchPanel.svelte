<script lang="ts">
  import { tick } from 'svelte';
  import { get } from 'svelte/store';
  import { trace, tree, files, health, backendHas } from '$lib/stores';
  import { searchRequest } from '$lib/stores/trace';
  import { chainModeOn } from '$lib/stores/chainMode';
  import { modalOpen, searchFocusRequested } from '$lib/stores/layout';
  import { parseMaxResults, searchDraft } from '$lib/stores/searchDraft';
  import {
    handleSearchPanelKey,
    isShortcut,
    type SearchPanelShortcutActions,
  } from '$lib/utils/shortcuts';
  import {
    SEARCH_TOGGLES,
    matchingFlagParams,
    type SearchToggles as Toggles,
  } from '$lib/utils/searchToggles';
  import type { SearchState } from '$lib/utils/urlState';
  import { chainSearchPaths, fileKeys } from '$lib/utils/tabKey';
  import Spinner from '../common/Spinner.svelte';
  import SearchOptionsBar from './SearchOptionsBar.svelte';
  import SearchResults from './SearchResults.svelte';

  let patternInputs: HTMLInputElement[] = [];
  let optionsBar: SearchOptionsBar;

  // Cmd/Ctrl+K or a panel key asks for the pattern field; the request
  // waits here until the field is there.
  $: if ($searchFocusRequested && patternInputs[0]) void focusFirstPattern();

  /**
   * Focus the first pattern field and select its text. The panel just
   * shown around the field is drawn in the update after this one, and a
   * field in a hidden panel takes no focus.
   */
  async function focusFirstPattern() {
    searchFocusRequested.set(false);
    await tick();
    patternInputs[0]?.focus();
    patternInputs[0]?.select();
  }

  // A backend that does not list the matching flags ignores them, so the
  // toggles are disabled there rather than shown doing nothing.
  $: flagsSupported = backendHas('trace_matching_flags', $health);
  $: togglesUnavailable = flagsSupported ? null : 'This backend does not take match options';

  $: searchRoots = $tree.roots.map((r) => r.path);
  $: hasRoots = searchRoots.length > 0;

  // A search of the open tabs: in chain mode a chain's tab by its handle,
  // which the chain search reads as the chain; otherwise the files only,
  // since a trace takes no chain.
  $: openTabKeys = $files.openFiles.map((f) => f.path);
  $: openTabPaths = $chainModeOn ? chainSearchPaths(openTabKeys) : fileKeys(openTabKeys);
  $: draftPaths = $searchDraft.onlyOpenedFiles ? openTabPaths : searchRoots;

  /** The paths a search reads: the open tabs, or every search root. */
  function pathsFor(onlyOpenedFiles: boolean): string[] {
    return onlyOpenedFiles ? openTabPaths : searchRoots;
  }

  // A link or Back sets a search from outside the panel, and has already
  // filled the form with it (`viewState.ts`). A search that has no answer
  // yet (a link on page load, an entry Back moved to) runs once the
  // backend's health says which parameters it takes and its paths are known.
  let seenRequest: SearchState | null = null;
  let pendingRequest: SearchState | null = null;

  $: noticeRequest($searchRequest);

  function noticeRequest(request: SearchState | null) {
    if (request === seenRequest) return;
    seenRequest = request;
    const { response, searching } = get(trace);
    pendingRequest = request !== null && response === null && !searching ? request : null;
  }

  $: pendingPathsKnown =
    pendingRequest !== null &&
    (pendingRequest.onlyOpenedFiles ? openTabPaths.length > 0 : hasRoots);
  $: if (pendingPathsKnown && !$health.loading) runPendingRequest();

  function runPendingRequest() {
    const request = pendingRequest;
    pendingRequest = null;
    if (request) void runRequest(request);
  }

  /** Run `request`; in chain mode rotated logs are searched as log chains. */
  async function runRequest(request: SearchState) {
    const paths = pathsFor(request.onlyOpenedFiles);
    if (paths.length === 0) return;
    const runSearch = $chainModeOn ? trace.searchChains : trace.search;
    await runSearch(paths, request.patterns, {
      maxResults: request.maxResults,
      flags: flagsSupported ? request.flags : {},
    });
  }

  /**
   * Run the form's search and make it the search the URL names. A max
   * the search cannot take refuses the run: nothing is sent, and the max
   * box says why and takes the focus.
   */
  async function handleSearch() {
    const patterns = $searchDraft.patterns.filter((p) => p.trim());
    if (patterns.length === 0) return;
    const maxResults = parseMaxResults($searchDraft.maxResults);
    if (maxResults === null) {
      optionsBar.refuseMax();
      return;
    }
    const { onlyOpenedFiles, toggles } = $searchDraft;
    if (pathsFor(onlyOpenedFiles).length === 0) return;

    const request = { patterns, maxResults, onlyOpenedFiles, flags: matchingFlagParams(toggles) };
    seenRequest = request;
    searchRequest.set(request);
    await runRequest(request);
  }

  function addPattern() {
    searchDraft.update((draft) => ({ ...draft, patterns: [...draft.patterns, ''] }));
  }

  function removePattern(index: number) {
    searchDraft.update((draft) =>
      draft.patterns.length > 1
        ? { ...draft, patterns: draft.patterns.filter((_, i) => i !== index) }
        : draft,
    );
  }

  function updatePattern(index: number, value: string) {
    searchDraft.update((draft) => ({
      ...draft,
      patterns: draft.patterns.map((pattern, i) => (i === index ? value : pattern)),
    }));
  }

  function handlePatternKeydown(event: KeyboardEvent) {
    if (!isShortcut('runSearch', event)) return;
    event.preventDefault();
    handleSearch();
  }

  // The toggles' buttons are disabled without a root to search or on a
  // backend that ignores the flags; a key does nothing then either.
  $: canSwitchToggles = hasRoots && flagsSupported;
  // Only opened files needs an open file to turn on; once on, it can
  // always be turned off, so the last tab closing does not trap the form.
  $: canSwitchOnlyOpened = openTabPaths.length > 0 || $searchDraft.onlyOpenedFiles;

  /** Switch the toggle `key`; returns whether it could. */
  function switchToggle(key: keyof Toggles): boolean {
    if (!canSwitchToggles) return false;
    searchDraft.update((draft) => ({
      ...draft,
      toggles: { ...draft.toggles, [key]: !draft.toggles[key] },
    }));
    return true;
  }

  /** Switch Only opened files; returns whether it could. */
  function switchOnlyOpened(): boolean {
    if (!canSwitchOnlyOpened) return false;
    searchDraft.update((draft) => ({ ...draft, onlyOpenedFiles: !draft.onlyOpenedFiles }));
    return true;
  }

  const panelActions: SearchPanelShortcutActions = {
    ...Object.fromEntries(
      SEARCH_TOGGLES.map((spec) => [`toggle:${spec.key}`, () => switchToggle(spec.key)]),
    ),
    toggleOnlyOpened: switchOnlyOpened,
  };

  // The panel hears the keys of every control inside it; a dialog that
  // owns the keyboard keeps them.
  function handlePanelKeydown(event: KeyboardEvent) {
    if ($modalOpen) return;
    handleSearchPanelKey(event, panelActions);
  }
</script>

<!-- The panel's keys work wherever the focus is inside it, so the panel
     itself hears them; it takes no focus of its own. -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div class="flex flex-col h-full" on:keydown={handlePanelKeydown}>
  <!-- Search patterns -->
  <div class="p-3 border-b border-gh-border-default dark:border-gh-border-dark-default">
    <!-- The fields stay usable during a search: a disabled field drops its
         focus, and a new search simply replaces the running one. -->
    <div class="space-y-2 mb-2">
      {#each $searchDraft.patterns as pattern, index (index)}
        <div class="flex gap-2">
          <input
            type="text"
            class="input flex-1 font-mono text-sm"
            placeholder="Regex pattern {index + 1}..."
            aria-label="Regex pattern {index + 1}"
            value={pattern}
            bind:this={patternInputs[index]}
            on:input={(e) => updatePattern(index, e.currentTarget.value)}
            on:keydown={handlePatternKeydown}
            disabled={!hasRoots}
          />
          {#if $searchDraft.patterns.length > 1}
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
          $searchDraft.patterns.every((p) => !p.trim()) ||
          draftPaths.length === 0}
      >
        {#if $trace.searching}
          <Spinner size="sm" />
        {:else}
          Search
        {/if}
      </button>
    </div>

    <SearchOptionsBar
      bind:this={optionsBar}
      togglesDisabled={!hasRoots}
      {togglesUnavailable}
      openCount={openTabPaths.length}
      onlyOpenedDisabled={!canSwitchOnlyOpened}
      on:run={handleSearch}
      on:switchOnlyOpened={switchOnlyOpened}
    />

    {#if !hasRoots && !$searchDraft.onlyOpenedFiles}
      <p class="text-xs text-gh-fg-muted dark:text-gh-fg-dark-muted mt-2">
        No search roots available. Configure search roots or enable "Only opened files" to search.
      </p>
    {:else if $searchDraft.onlyOpenedFiles && openTabPaths.length === 0}
      <p class="text-xs text-gh-fg-muted dark:text-gh-fg-dark-muted mt-2">
        No files currently opened. Open some files to search in them.
      </p>
    {/if}
  </div>

  <SearchResults />
</div>

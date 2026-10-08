<script lang="ts">
  import { onDestroy } from 'svelte';
  import { trace, tree, files } from '$lib/stores';
  import { chainModeOn } from '$lib/stores/chainMode';
  import { notifications } from '$lib/stores/notifications';
  import { searchShowsOffsets } from '$lib/stores/layout';
  import {
    OffsetLineResolver,
    offsetKey,
    unresolvedOffsetsByFile,
    type ResolvedLines,
    type UnresolvedReasons,
  } from '$lib/offsetLines';
  import { SUPERSEDED } from '$lib/utils/latestRequest';
  import { resolveMatchLine } from '$lib/utils/matchLine';
  import { chainCount, searchedFileCount, skippedFiles } from '$lib/utils/traceSummary';
  import {
    chainPlaceOf,
    chainPositionOf,
    chainTabMatches,
    noChainLineTitle,
    opensChainTab,
    type ChainMatchPlace,
  } from '$lib/utils/chainSearch';
  import { formatCount } from '$lib/utils/format';
  import { openChainAt, openFileAtLine } from '$lib/fileOpening';
  import type { SearchMatch, TraceMatch } from '$lib/types';
  import FileBadges from '../common/FileBadges.svelte';
  import SkippedFiles from './SkippedFiles.svelte';

  // Byte offset -> absolute line number, for matches whose line the
  // backend could not report, keyed by offsetKey.
  let resolvedLines: ResolvedLines = {};
  // Matches currently being resolved, so the row can say so.
  let resolving: Record<string, boolean> = {};
  // Why a match's line could not be resolved, keyed by offsetKey, so the
  // row says why instead of only "line unknown".
  let unresolved: UnresolvedReasons = {};

  const resolver = new OffsetLineResolver();
  onDestroy(() => resolver.cancel());

  /**
   * The line to navigate to, or null when it still has to be fetched.
   *
   * relative_line_number counts from the start of the match's chunk, so it
   * is only the file line when the file was scanned in one chunk. The byte
   * offset is always absolute, which is what /v1/samples resolves.
   */
  function displayLine(match: TraceMatch, filePath: string): number | null {
    if (!$trace.response) return null;
    const resolved = resolveMatchLine(match, $trace.response);
    if (resolved.kind === 'line') return resolved.line;
    return resolvedLines[offsetKey(filePath, resolved.offset)] ?? null;
  }

  // Resolve unknown lines as soon as results arrive, so the result list
  // shows real line numbers instead of making the user click to find
  // out. A new answer, or none, aborts the lookups of the previous one.
  $: resolveUnknownLines($trace.response);

  async function resolveUnknownLines(response: typeof $trace.response) {
    resolvedLines = {};
    unresolved = {};
    const pending: Record<string, boolean> = {};
    if (response) {
      for (const [filePath, offsets] of unresolvedOffsetsByFile(response)) {
        for (const offset of offsets) pending[offsetKey(filePath, offset)] = true;
      }
    }
    resolving = pending;

    await resolver.resolveAll(
      response,
      (found) => {
        resolvedLines = { ...resolvedLines, ...found };
      },
      (reasons) => {
        unresolved = { ...unresolved, ...reasons };
      },
    );
    if (response === $trace.response) resolving = {};
  }

  /**
   * Ask the backend which line a byte offset falls on. Null when another
   * click took over, or when there is no line: the reason is then in
   * `unresolved` and on screen.
   */
  async function resolveLineFromOffset(filePath: string, offset: number): Promise<number | null> {
    const key = offsetKey(filePath, offset);
    if (resolvedLines[key] !== undefined) return resolvedLines[key];

    resolving = { ...resolving, [key]: true };
    const lookup = await resolver.resolveOne(filePath, offset);
    const { [key]: _dropped, ...rest } = resolving;
    resolving = rest;
    if (lookup === SUPERSEDED) return null;
    if ('reason' in lookup) {
      unresolved = { ...unresolved, [key]: lookup.reason };
      notifications.error(`Cannot jump to the match at byte ${offset}: ${lookup.reason}`);
      return null;
    }
    const { [key]: _resolved, ...stillUnresolved } = unresolved;
    unresolved = stillUnresolved;
    resolvedLines = { ...resolvedLines, [key]: lookup.line };
    return lookup.line;
  }

  /** Highlight every match in this file whose line we already know. */
  function markFileMatches(filePath: string) {
    if (!$trace.response) return;
    const fileMatches = $trace.response.matches
      .filter((m) => getFilePath(m.file) === filePath)
      .map((m) => ({ line: displayLine(m, filePath), m }))
      .filter((entry): entry is { line: number; m: TraceMatch } => entry.line !== null)
      .map((entry) => ({
        lineNumber: entry.line,
        patternId: entry.m.pattern,
        pattern: getPattern(entry.m.pattern),
      }));
    files.setMatches(filePath, fileMatches);
  }

  /**
   * Show a match: in its log chain's tab while chain mode is on and the
   * chain can be read, else in its file's tab (a part of a chain is a
   * file of its own). The line is the part's own line, the one the
   * answer gives or the one its byte offset resolves to.
   */
  async function openMatch(match: SearchMatch, filePath: string) {
    const response = $trace.response;
    if (!response) return;
    const place = chainPlaceOf(match, response);
    const chain: ChainMatchPlace | null = opensChainTab(place, $chainModeOn) ? place : null;
    if (!chain) markFileMatches(filePath);

    let line = displayLine(match, filePath);
    if (line === null) {
      line = await resolveLineFromOffset(filePath, match.offset);
    }
    if (line === null) return;

    if (chain) {
      const marks = chainTabMatches(response, chain.handle, (m) =>
        displayLine(m, getFilePath(m.file)),
      );
      await openChainAt(chain.handle, chainPositionOf(chain, line), marks);
      return;
    }
    await openFileAtLine(filePath, line);
  }

  // Get file path from file ID
  function getFilePath(fileId: string): string {
    return $trace.response?.files[fileId] || fileId;
  }

  // Get pattern string from pattern ID
  function getPattern(patternId: string): string {
    return $trace.response?.patterns[patternId] || patternId;
  }

  // Get file metadata from tree store
  function getFileMetadata(filePath: string) {
    // Try to find the file in the tree
    const findInNodes = (nodes: any[]): any => {
      for (const node of nodes) {
        if (node.path === filePath && node.type === 'file') {
          return node;
        }
        if (node.children && node.children.length > 0) {
          const found = findInNodes(node.children);
          if (found) return found;
        }
      }
      return null;
    };

    return findInNodes($tree.roots);
  }
</script>

<!-- Results -->
<div class="flex-1 overflow-auto">
  {#if $trace.error}
    <div class="p-3 text-gh-danger-fg dark:text-gh-danger-dark-fg">
      <p class="font-medium">Search failed</p>
      <p class="text-sm mt-1">{$trace.error}</p>
    </div>
  {:else if $trace.response}
    <div class="p-3 border-b border-gh-border-default dark:border-gh-border-dark-default">
      <div class="flex items-center justify-between">
        <p class="text-sm text-gh-fg-muted dark:text-gh-fg-dark-muted">
          Found {formatCount($trace.response.matches.length, 'match', 'matches')} in {formatCount(
            searchedFileCount($trace.response),
            'file',
          )}{#if chainCount($trace.response) > 0}, {formatCount(
              chainCount($trace.response),
              'log chain',
            )}{/if}
          ({$trace.response.time.toFixed(2)}s)
          {#if $trace.response.max_results && $trace.response.matches.length >= $trace.response.max_results}
            <span class="text-gh-attention-fg dark:text-gh-attention-dark-fg">
              (limited to {$trace.response.max_results})
            </span>
          {/if}
        </p>
        <button
          class="text-xs px-2 py-1 rounded bg-gh-canvas-subtle dark:bg-gh-canvas-dark-subtle hover:bg-gh-canvas-default dark:hover:bg-gh-canvas-dark-default border border-gh-border-default dark:border-gh-border-dark-default"
          on:click={() => searchShowsOffsets.update((shown) => !shown)}
          title={$searchShowsOffsets ? 'Show line numbers' : 'Show byte offsets'}
        >
          {$searchShowsOffsets ? 'Lines' : 'Offsets'}
        </button>
      </div>
    </div>

    <SkippedFiles skipped={skippedFiles($trace.response)} searched={$trace.response.path} />

    {#if $trace.response.matches.length > 0}
      <ul class="divide-y divide-gh-border-default dark:divide-gh-border-dark-default">
        {#each $trace.response.matches as match (`${match.file}:${match.offset}:${match.pattern}`)}
          {@const filePath = getFilePath(match.file)}
          {@const lineNum = displayLine(match, filePath)}
          {@const isResolving = resolving[offsetKey(filePath, match.offset)]}
          {@const whyUnknown = unresolved[offsetKey(filePath, match.offset)]}
          {@const fileMetadata = getFileMetadata(filePath)}
          {@const place = chainPlaceOf(match, $trace.response)}
          <li>
            <button
              class="w-full text-left px-3 py-2 hover:bg-gh-canvas-subtle dark:hover:bg-gh-canvas-dark-subtle"
              on:click={() => openMatch(match, filePath)}
            >
              <div
                class="flex items-center gap-x-2 text-sm"
                class:flex-wrap={place && place.chainLine !== null}
              >
                {#if place && place.chainLine !== null}
                  <!-- A ready chain's match: its line in the chain, its part's own line
                       beside it. The row wraps rather than cut either label short. -->
                  <span
                    class="text-gh-accent-fg dark:text-gh-accent-dark-fg truncate max-w-full"
                    title={place.handle}
                  >
                    {place.name}:{place.chainLine}
                  </span>
                  <span
                    class="text-xs text-gh-fg-muted dark:text-gh-fg-dark-muted truncate max-w-full"
                    title={filePath}
                  >
                    {place.part}:{lineNum ?? '?'}
                  </span>
                  {#if fileMetadata}
                    <FileBadges
                      isCompressed={fileMetadata.is_compressed}
                      compressionFormat={fileMetadata.compression_format}
                      isIndexed={fileMetadata.is_indexed}
                    />
                  {/if}
                  <span class="text-xs text-gh-fg-muted dark:text-gh-fg-dark-muted">
                    {$searchShowsOffsets ? `@${match.offset}` : `(@${match.offset})`}
                  </span>
                {:else}
                  <span
                    class="text-gh-accent-fg dark:text-gh-accent-dark-fg truncate"
                    title={place ? noChainLineTitle(place) : undefined}
                  >
                    {filePath.split('/').pop()}
                  </span>
                  {#if fileMetadata}
                    <FileBadges
                      isCompressed={fileMetadata.is_compressed}
                      compressionFormat={fileMetadata.compression_format}
                      isIndexed={fileMetadata.is_indexed}
                    />
                  {/if}
                  {#if $searchShowsOffsets}
                    <span class="text-gh-fg-subtle dark:text-gh-fg-dark-subtle">
                      @{match.offset}
                    </span>
                    <span class="text-xs text-gh-fg-muted dark:text-gh-fg-dark-muted">
                      {#if lineNum !== null}(:{lineNum}){:else if isResolving}(resolving line…){:else if whyUnknown}(line
                        unknown: {whyUnknown}){/if}
                    </span>
                  {:else}
                    <span class="text-gh-fg-subtle dark:text-gh-fg-dark-subtle">
                      {#if lineNum !== null}
                        :{lineNum}
                      {:else if isResolving}
                        resolving line…
                      {:else}
                        line unknown{#if whyUnknown}: {whyUnknown}{/if}
                      {/if}
                    </span>
                    <span class="text-xs text-gh-fg-muted dark:text-gh-fg-dark-muted">
                      (@{match.offset})
                    </span>
                  {/if}
                {/if}
              </div>
              {#if match.line_text}
                <p class="text-xs text-gh-fg-default dark:text-gh-fg-dark-default mt-1 font-mono">
                  {match.line_text}
                </p>
              {/if}
            </button>
          </li>
        {/each}
      </ul>
    {:else}
      <div class="p-3 text-gh-fg-muted dark:text-gh-fg-dark-muted">No matches found</div>
    {/if}
  {:else if !$trace.searching}
    <div class="p-3 text-gh-fg-muted dark:text-gh-fg-dark-muted text-sm">
      Enter a search pattern and press Enter or click Search
    </div>
  {/if}
</div>

<script lang="ts">
  import { onDestroy } from 'svelte';
  import { trace, tree, files } from '$lib/stores';
  import { searchShowsOffsets } from '$lib/stores/layout';
  import {
    OffsetLineResolver,
    offsetKey,
    unresolvedOffsetsByFile,
    type ResolvedLines,
  } from '$lib/offsetLines';
  import { SUPERSEDED } from '$lib/utils/latestRequest';
  import { resolveMatchLine } from '$lib/utils/matchLine';
  import { searchedFileCount } from '$lib/utils/traceSummary';
  import { formatCount } from '$lib/utils/format';
  import type { TraceMatch } from '$lib/types';
  import FileBadges from '../common/FileBadges.svelte';

  // Byte offset -> absolute line number, for matches whose line the
  // backend could not report, keyed by offsetKey.
  let resolvedLines: ResolvedLines = {};
  // Matches currently being resolved, so the row can say so.
  let resolving: Record<string, boolean> = {};

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
    const pending: Record<string, boolean> = {};
    if (response) {
      for (const [filePath, offsets] of unresolvedOffsetsByFile(response)) {
        for (const offset of offsets) pending[offsetKey(filePath, offset)] = true;
      }
    }
    resolving = pending;

    await resolver.resolveAll(response, (found) => {
      resolvedLines = { ...resolvedLines, ...found };
    });
    if (response === $trace.response) resolving = {};
  }

  /** Ask the backend which line a byte offset falls on. */
  async function resolveLineFromOffset(filePath: string, offset: number): Promise<number | null> {
    const key = offsetKey(filePath, offset);
    if (resolvedLines[key] !== undefined) return resolvedLines[key];

    resolving = { ...resolving, [key]: true };
    const line = await resolver.resolveOne(filePath, offset);
    const { [key]: _dropped, ...rest } = resolving;
    resolving = rest;
    if (line === SUPERSEDED || line === null) return null;
    resolvedLines = { ...resolvedLines, [key]: line };
    return line;
  }

  async function openMatch(match: TraceMatch, filePath: string) {
    if (!$trace.response) return;

    // Highlight every match in this file whose line we already know.
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

    let line = displayLine(match, filePath);
    if (line === null) {
      line = await resolveLineFromOffset(filePath, match.offset);
    }
    if (line === null) return;

    files.jumpToLine(filePath, line);
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
          )} ({$trace.response.time.toFixed(2)}s)
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

    {#if $trace.response.matches.length > 0}
      <ul class="divide-y divide-gh-border-default dark:divide-gh-border-dark-default">
        {#each $trace.response.matches as match (`${match.file}:${match.offset}:${match.pattern}`)}
          {@const filePath = getFilePath(match.file)}
          {@const lineNum = displayLine(match, filePath)}
          {@const isResolving = resolving[offsetKey(filePath, match.offset)]}
          {@const fileMetadata = getFileMetadata(filePath)}
          <li>
            <button
              class="w-full text-left px-3 py-2 hover:bg-gh-canvas-subtle dark:hover:bg-gh-canvas-dark-subtle"
              on:click={() => openMatch(match, filePath)}
            >
              <div class="flex items-center gap-2 text-sm">
                <span class="text-gh-accent-fg dark:text-gh-accent-dark-fg truncate">
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
                    {#if lineNum !== null}(:{lineNum}){:else if isResolving}(resolving line…){/if}
                  </span>
                {:else}
                  <span class="text-gh-fg-subtle dark:text-gh-fg-dark-subtle">
                    {#if lineNum !== null}
                      :{lineNum}
                    {:else if isResolving}
                      resolving line…
                    {:else}
                      line unknown
                    {/if}
                  </span>
                  <span class="text-xs text-gh-fg-muted dark:text-gh-fg-dark-muted">
                    (@{match.offset})
                  </span>
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

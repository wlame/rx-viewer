<script lang="ts">
  import { trace, tree, files } from '$lib/stores';
  import { api } from '$lib/api';
  import { resolveMatchLine } from '$lib/utils/matchLine';
  import type { TraceMatch } from '$lib/types';
  import Spinner from '../common/Spinner.svelte';
  import FileBadges from '../common/FileBadges.svelte';

  let searchPatterns: string[] = [''];
  let maxResults = 100;
  let showAdvanced = false;
  let showOffsets = false; // Toggle between line numbers and byte offsets
  let onlyOpenedFiles = false; // Search only in currently opened files

  $: searchRoots = $tree.roots.map((r) => r.path);
  $: hasRoots = searchRoots.length > 0;

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

    // Search with all patterns
    await trace.search(pathsToSearch, validPatterns, maxResults);
  }

  function handleKeydown(event: KeyboardEvent, _index: number) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSearch();
    }
  }

  // Byte offset -> absolute line number, for matches whose line the
  // backend could not report. Keyed by "path:offset" so one lookup serves
  // both the result list and the jump.
  let resolvedLines: Record<string, number> = {};
  // Matches currently being resolved, so the row can say so.
  let resolving: Record<string, boolean> = {};

  function offsetKey(filePath: string, offset: number): string {
    return `${filePath}:${offset}`;
  }

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

  // Resolve unknown lines as soon as results arrive, one request per file,
  // so the result list shows real line numbers instead of making the user
  // click to find out. A stale response is dropped by sequence number.
  //
  // Both backends resolve one offset per scan of the file, so a batch of N
  // offsets on a large file costs N scans. The cap keeps that bounded;
  // anything beyond it resolves when the user clicks the result.
  const EAGER_RESOLVE_LIMIT_PER_FILE = 20;
  let resolveSequence = 0;
  $: resolveUnknownLines($trace.response);

  async function resolveUnknownLines(response: typeof $trace.response) {
    resolvedLines = {};
    resolving = {};
    if (!response) return;

    const sequence = ++resolveSequence;
    const offsetsByFile = new Map<string, number[]>();
    for (const match of response.matches) {
      if (resolveMatchLine(match, response).kind === 'line') continue;
      const filePath = response.files[match.file] ?? match.file;
      const offsets = offsetsByFile.get(filePath) ?? [];
      if (offsets.length >= EAGER_RESOLVE_LIMIT_PER_FILE) continue;
      if (!offsets.includes(match.offset)) offsets.push(match.offset);
      offsetsByFile.set(filePath, offsets);
    }
    if (offsetsByFile.size === 0) return;

    const pending: Record<string, boolean> = {};
    for (const [filePath, offsets] of offsetsByFile) {
      for (const offset of offsets) pending[offsetKey(filePath, offset)] = true;
    }
    resolving = pending;

    await Promise.all(
      [...offsetsByFile].map(async ([filePath, offsets]) => {
        try {
          const samples = await api.getSamplesByOffset(filePath, offsets, 0);
          if (sequence !== resolveSequence) return;
          const found: Record<string, number> = {};
          for (const offset of offsets) {
            const line = samples.offsets?.[String(offset)];
            if (typeof line === 'number' && line >= 1) {
              found[offsetKey(filePath, offset)] = line;
            }
          }
          resolvedLines = { ...resolvedLines, ...found };
        } catch {
          // Leave these matches showing the byte offset; clicking one
          // still retries the lookup.
        }
      }),
    );

    if (sequence === resolveSequence) resolving = {};
  }

  /** Ask the backend which line a byte offset falls on. */
  async function resolveLineFromOffset(filePath: string, offset: number): Promise<number | null> {
    const key = offsetKey(filePath, offset);
    if (resolvedLines[key] !== undefined) return resolvedLines[key];

    resolving = { ...resolving, [key]: true };
    try {
      const samples = await api.getSamplesByOffset(filePath, [offset], 0);
      const line = samples.offsets?.[String(offset)];
      if (typeof line === 'number' && line >= 1) {
        resolvedLines = { ...resolvedLines, [key]: line };
        return line;
      }
      return null;
    } catch {
      // The jump still works from the offset's file window; a failed
      // lookup only costs the gutter number.
      return null;
    } finally {
      const { [key]: _dropped, ...rest } = resolving;
      resolving = rest;
    }
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

<div class="flex flex-col h-full">
  <!-- Search patterns -->
  <div class="p-3 border-b border-gh-border-default dark:border-gh-border-dark-default">
    <div class="space-y-2 mb-2">
      {#each searchPatterns as pattern, index (index)}
        <div class="flex gap-2">
          <input
            type="text"
            class="input flex-1 font-mono text-sm"
            placeholder="Regex pattern {index + 1}..."
            value={pattern}
            on:input={(e) => updatePattern(index, e.currentTarget.value)}
            on:keydown={(e) => handleKeydown(e, index)}
            disabled={$trace.searching || !hasRoots}
          />
          {#if searchPatterns.length > 1}
            <button
              class="btn btn-secondary px-2"
              on:click={() => removePattern(index)}
              disabled={$trace.searching}
              title="Remove pattern"
            >
              ✕
            </button>
          {/if}
        </div>
      {/each}
    </div>

    <div class="flex gap-2">
      <button
        class="btn btn-secondary text-xs"
        on:click={addPattern}
        disabled={$trace.searching || !hasRoots}
      >
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

    <!-- Advanced options toggle -->
    <button
      class="text-xs text-gh-accent-fg dark:text-gh-accent-dark-fg hover:underline mt-2"
      on:click={() => (showAdvanced = !showAdvanced)}
    >
      {showAdvanced ? '▼' : '▶'} Options
    </button>

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
            Found {$trace.response.matches.length.toLocaleString()} matches in {$trace.response.scanned_files.length.toLocaleString()}
            files ({$trace.response.time.toFixed(2)}s)
            {#if $trace.response.max_results && $trace.response.matches.length >= $trace.response.max_results}
              <span class="text-gh-attention-fg dark:text-gh-attention-dark-fg">
                (limited to {$trace.response.max_results})
              </span>
            {/if}
          </p>
          <button
            class="text-xs px-2 py-1 rounded bg-gh-canvas-subtle dark:bg-gh-canvas-dark-subtle hover:bg-gh-canvas-default dark:hover:bg-gh-canvas-dark-default border border-gh-border-default dark:border-gh-border-dark-default"
            on:click={() => (showOffsets = !showOffsets)}
            title={showOffsets ? 'Show line numbers' : 'Show byte offsets'}
          >
            {showOffsets ? 'Lines' : 'Offsets'}
          </button>
        </div>
      </div>

      {#if $trace.response.matches.length > 0}
        <ul class="divide-y divide-gh-border-default dark:divide-gh-border-dark-default">
          {#each $trace.response.matches as match}
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
                  {#if showOffsets}
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
</div>

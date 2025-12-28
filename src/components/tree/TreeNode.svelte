<script lang="ts">
  import type { TreeNode as TreeNodeType, IndexData } from '$lib/types';
  import { tree, files, notifications } from '$lib/stores';
  import { api, ApiError } from '$lib/api';
  import FileIcon from './FileIcon.svelte';
  import Spinner from '../common/Spinner.svelte';
  import FileBadges from '../common/FileBadges.svelte';

  export let node: TreeNodeType;

  $: isSelected = $tree.selectedPath === node.path;
  $: indentPx = node.level * 16;

  let showContextMenu = false;
  let contextMenuX = 0;
  let contextMenuY = 0;

  // Analyze popup state
  let showAnalyzePopup = false;
  let analyzeLoading = false;
  let analyzeStatusMessage = ''; // Status message during analysis
  let analyzeResult: IndexData | null = null;
  let selectedAnomalyDetector: string | null = null; // Selected tab for anomaly detector

  function handleClick() {
    if (node.type === 'directory') {
      tree.toggleExpanded(node.path);
    } else {
      tree.selectPath(node.path);
      files.openFile(node.path, undefined, node.size, undefined, node.is_indexed ?? undefined);
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleClick();
    }
  }

  function formatSize(size: number | null): string {
    if (size === null) return '';
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
    return `${(size / 1024 / 1024 / 1024).toFixed(1)} GB`;
  }

  function handleContextMenu(event: MouseEvent) {
    event.preventDefault();
    contextMenuX = event.clientX;
    contextMenuY = event.clientY;
    showContextMenu = true;
  }

  function closeContextMenu() {
    showContextMenu = false;
  }

  /**
   * Poll a task until it completes or fails
   */
  async function pollTaskUntilComplete(taskId: string, intervalMs = 2000, maxAttempts = 300): Promise<IndexData> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const task = await api.getTaskStatus(taskId);

      if (task.status === 'completed' && task.result) {
        return task.result;
      }

      if (task.status === 'failed') {
        throw new Error(task.error || 'Task failed');
      }

      // Update status message
      analyzeStatusMessage = `Analyzing... (${task.status})`;

      // Still running, wait and poll again
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }

    throw new Error('Task polling timeout');
  }

  async function handleAnalyze() {
    closeContextMenu();
    analyzeLoading = true;
    showAnalyzePopup = true;
    analyzeResult = null;
    analyzeStatusMessage = 'Checking for cached index...';

    try {
      // Step 1: Try to get cached index data
      try {
        const indexData = await api.getIndex(node.path);
        console.log('Index data (cached):', indexData);
        analyzeResult = indexData;
        notifications.success(`Analysis loaded for ${node.name}`, 3000);
        analyzeLoading = false;
        return;
      } catch (e) {
        // If not 404, rethrow
        if (!(e instanceof ApiError && e.status === 404)) {
          throw e;
        }
        // 404 means no index exists, proceed to create one
        console.log('No cached index found, starting indexing task...');
      }

      // Step 2: Start indexing task with analyze=true
      analyzeStatusMessage = 'Starting analysis...';
      let taskResponse;
      try {
        taskResponse = await api.startIndex(node.path, { analyze: true });
      } catch (e) {
        // Handle 409 Conflict (task already in progress)
        if (e instanceof ApiError && e.status === 409) {
          // Extract task ID from error message if possible
          const errorText = e.message;
          const taskIdMatch = errorText.match(/task:\s*([a-f0-9-]+)/i);
          if (taskIdMatch) {
            analyzeStatusMessage = 'Joining existing analysis task...';
            const result = await pollTaskUntilComplete(taskIdMatch[1]);
            console.log('Index data (from existing task):', result);
            analyzeResult = result;
            notifications.success(`Analysis complete for ${node.name}`, 3000);
            analyzeLoading = false;
            return;
          }
        }
        throw e;
      }

      console.log('Task started:', taskResponse);
      analyzeStatusMessage = 'Analyzing file...';

      // Step 3: Poll until task completes
      const result = await pollTaskUntilComplete(taskResponse.task_id);
      console.log('Index data (from task):', result);
      analyzeResult = result;
      notifications.success(`Analysis complete for ${node.name}`, 3000);
    } catch (e) {
      const error = e instanceof Error ? e.message : 'Analysis failed';
      notifications.error(error, 5000);
      showAnalyzePopup = false;
    } finally {
      analyzeLoading = false;
      analyzeStatusMessage = '';
    }
  }

  function closeAnalyzePopup() {
    showAnalyzePopup = false;
    analyzeResult = null;
    analyzeStatusMessage = '';
    selectedAnomalyDetector = null;
  }

  // Group anomalies by detector
  function getAnomaliesByDetector(anomalies: any[]): Record<string, any[]> {
    if (!anomalies || !Array.isArray(anomalies)) return {};
    const grouped: Record<string, any[]> = {};
    for (const anomaly of anomalies) {
      const detector = anomaly.detector || 'unknown';
      if (!grouped[detector]) {
        grouped[detector] = [];
      }
      grouped[detector].push(anomaly);
    }
    return grouped;
  }

  // Get detector display name
  function getDetectorDisplayName(detector: string): string {
    const names: Record<string, string> = {
      'error': 'Errors',
      'traceback': 'Tracebacks',
      'format': 'Format Issues',
      'warning': 'Warnings',
      'exception': 'Exceptions',
      'unknown': 'Other'
    };
    return names[detector] || detector.charAt(0).toUpperCase() + detector.slice(1);
  }

  // Get severity color class
  function getSeverityColor(severity: number): string {
    if (severity >= 0.8) return 'text-red-600 dark:text-red-400';
    if (severity >= 0.5) return 'text-orange-500 dark:text-orange-400';
    if (severity >= 0.3) return 'text-yellow-600 dark:text-yellow-400';
    return 'text-gh-fg-muted dark:text-gh-fg-dark-muted';
  }

  // Handle clicking on an anomaly row to navigate to the line
  function handleAnomalyClick(anomaly: any) {
    closeAnalyzePopup();
    // Set highlighted lines for the anomaly range
    const endLine = anomaly.end_line || anomaly.start_line;
    files.setHighlightedLines(node.path, { start: anomaly.start_line, end: endLine });
    // Jump to the line - this properly loads content around the target line
    files.jumpToLine(node.path, anomaly.start_line);
  }

  // Helper to format file size
  function formatBytes(bytes: number | null | undefined): string {
    if (bytes === null || bytes === undefined) return 'N/A';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  }

  // Format build time
  function formatBuildTime(seconds: number | null | undefined): string {
    if (seconds === null || seconds === undefined) return 'N/A';
    if (seconds < 1) return `${(seconds * 1000).toFixed(0)} ms`;
    if (seconds < 60) return `${seconds.toFixed(2)} s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs.toFixed(0)}s`;
  }

  async function handleIndex() {
    closeContextMenu();
    try {
      const result = await api.startIndex(node.path, { force: false });
      console.log('Index result:', result);
      notifications.success(`Indexing started for ${node.name}`, 3000);
    } catch (e) {
      const error = e instanceof Error ? e.message : 'Indexing failed';
      notifications.error(error, 5000);
    }
  }
</script>

<div class="select-none">
  <div
    role="treeitem"
    tabindex="0"
    aria-expanded={node.type === 'directory' ? node.expanded : undefined}
    aria-selected={isSelected}
    class="flex items-center gap-1 px-2 py-0.5 cursor-pointer text-sm
           hover:bg-gh-canvas-subtle dark:hover:bg-gh-canvas-dark-subtle
           {isSelected
      ? 'bg-gh-accent-muted dark:bg-gh-accent-dark-muted'
      : ''}"
    style="padding-left: {indentPx + 8}px"
    on:click={handleClick}
    on:keydown={handleKeydown}
    on:contextmenu={handleContextMenu}
  >
    <!-- Expand/collapse chevron for directories -->
    {#if node.type === 'directory'}
      <span class="w-4 h-4 flex items-center justify-center flex-shrink-0">
        {#if node.loading}
          <Spinner size="sm" />
        {:else}
          <svg
            class="w-3 h-3 text-gh-fg-muted dark:text-gh-fg-dark-muted transition-transform
                   {node.expanded ? 'rotate-90' : ''}"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M9 18l6-6-6-6" />
          </svg>
        {/if}
      </span>
    {:else}
      <span class="w-4 h-4 flex-shrink-0" />
    {/if}

    <!-- File/folder icon -->
    <FileIcon {node} />

    <!-- Name -->
    <span
      class="truncate flex-1 {node.type === 'directory'
        ? 'font-medium'
        : node.is_text === false
        ? 'opacity-50'
        : ''}"
    >
      {node.name}
    </span>

    <!-- Badges for files -->
    {#if node.type === 'file'}
      <span class="flex items-center gap-1 flex-shrink-0">
        <FileBadges
          isCompressed={node.is_compressed}
          compressionFormat={node.compression_format}
          isIndexed={node.is_indexed}
        />
        {#if node.size !== null}
          <span
            class="text-xs text-gh-fg-subtle dark:text-gh-fg-dark-subtle ml-1"
          >
            {formatSize(node.size)}
          </span>
        {/if}
      </span>
    {:else if node.children_count !== null}
      <span class="text-xs text-gh-fg-subtle dark:text-gh-fg-dark-subtle">
        {node.children_count}
      </span>
    {/if}
  </div>

  <!-- Children -->
  {#if node.type === 'directory' && node.expanded && node.children.length > 0}
    <div role="group">
      {#each node.children as child (child.path)}
        <svelte:self node={child} />
      {/each}
    </div>
  {/if}
</div>

<!-- Context Menu -->
{#if showContextMenu}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div
    class="fixed inset-0 z-40"
    on:click={closeContextMenu}
    on:contextmenu|preventDefault={closeContextMenu}
  />
  <div
    class="fixed z-50 bg-gh-canvas-default dark:bg-gh-canvas-dark-subtle border border-gh-border-default dark:border-gh-border-dark-default rounded-lg shadow-xl py-1 min-w-40"
    style="left: {contextMenuX}px; top: {contextMenuY}px;"
  >
    {#if node.type === 'file'}
      <button
        class="w-full text-left px-3 py-2 text-sm text-gh-fg-default dark:text-gh-fg-dark-default hover:bg-gh-canvas-subtle dark:hover:bg-gh-canvas-dark-inset"
        on:click={handleAnalyze}
      >
        Analyze
      </button>
      {#if node.is_compressed}
        <button
          class="w-full text-left px-3 py-2 text-sm text-gh-fg-default dark:text-gh-fg-dark-default hover:bg-gh-canvas-subtle dark:hover:bg-gh-canvas-dark-inset"
          on:click={handleIndex}
        >
          {node.is_indexed ? 'Re-index' : 'Index'}
        </button>
      {/if}
    {:else}
      <button
        class="w-full text-left px-3 py-2 text-sm text-gh-fg-default dark:text-gh-fg-dark-default hover:bg-gh-canvas-subtle dark:hover:bg-gh-canvas-dark-inset"
        on:click={handleAnalyze}
      >
        Analyze
      </button>
    {/if}
  </div>
{/if}

<!-- Analyze Results Popup -->
{#if showAnalyzePopup}
  <div
    class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
    on:click={closeAnalyzePopup}
  >
    <div
      class="bg-gh-canvas-default dark:bg-gh-canvas-dark-default rounded-lg shadow-xl max-w-3xl w-full max-h-[80vh] flex flex-col overflow-hidden"
      on:click={(e) => e.stopPropagation()}
    >
      <!-- Header -->
      <div class="flex items-center justify-between px-6 py-4 border-b border-gh-border-default dark:border-gh-border-dark-default flex-shrink-0">
        <h2 class="text-lg font-semibold text-gh-fg-default dark:text-gh-fg-dark-default">
          Analysis: {node.name}
        </h2>
        <button
          class="p-1 rounded hover:bg-gh-canvas-subtle dark:hover:bg-gh-canvas-dark-subtle"
          on:click={closeAnalyzePopup}
          aria-label="Close"
        >
          <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <!-- Content -->
      <div class="flex-1 overflow-y-auto p-6">
        {#if analyzeLoading}
          <div class="flex flex-col items-center justify-center py-12">
            <Spinner size="lg" />
            <p class="mt-4 text-gh-fg-muted dark:text-gh-fg-dark-muted">{analyzeStatusMessage || 'Analyzing...'}</p>
          </div>
        {:else if analyzeResult}
          <div class="space-y-6">
            <!-- General Information -->
            <div>
              <h3 class="text-sm font-semibold text-gh-fg-default dark:text-gh-fg-dark-default mb-3 uppercase tracking-wide">
                General Information
              </h3>
              <div class="grid grid-cols-2 gap-4">
                <div>
                  <div class="text-xs text-gh-fg-muted dark:text-gh-fg-dark-muted mb-1">File Size</div>
                  <div class="text-sm font-medium">{formatBytes(analyzeResult.size_bytes)}</div>
                </div>
                <div>
                  <div class="text-xs text-gh-fg-muted dark:text-gh-fg-dark-muted mb-1">Type</div>
                  <div class="text-sm font-medium">{analyzeResult.file_type}</div>
                </div>
                <div>
                  <div class="text-xs text-gh-fg-muted dark:text-gh-fg-dark-muted mb-1">Indexed At</div>
                  <div class="text-sm font-medium">{new Date(analyzeResult.created_at).toLocaleString()}</div>
                </div>
                <div>
                  <div class="text-xs text-gh-fg-muted dark:text-gh-fg-dark-muted mb-1">Build Time</div>
                  <div class="text-sm font-medium">{formatBuildTime(analyzeResult.build_time_seconds)}</div>
                </div>
              </div>
            </div>

            <!-- Line Statistics -->
            {#if analyzeResult.line_count}
              <div>
                <h3 class="text-sm font-semibold text-gh-fg-default dark:text-gh-fg-dark-default mb-3 uppercase tracking-wide">
                  Line Statistics
                </h3>
                <div class="grid grid-cols-2 gap-4">
                  <div>
                    <div class="text-xs text-gh-fg-muted dark:text-gh-fg-dark-muted mb-1">Total Lines</div>
                    <div class="text-lg font-bold text-gh-accent-fg dark:text-gh-accent-dark-fg">
                      {analyzeResult.line_count.toLocaleString()}
                    </div>
                  </div>
                  {#if analyzeResult.empty_line_count !== null && analyzeResult.empty_line_count !== undefined}
                    <div>
                      <div class="text-xs text-gh-fg-muted dark:text-gh-fg-dark-muted mb-1">Empty Lines</div>
                      <div class="text-lg font-bold">
                        {analyzeResult.empty_line_count.toLocaleString()}
                      </div>
                    </div>
                  {/if}
                  {#if analyzeResult.line_ending}
                    <div>
                      <div class="text-xs text-gh-fg-muted dark:text-gh-fg-dark-muted mb-1">Line Ending</div>
                      <div class="text-sm font-medium font-mono">{analyzeResult.line_ending}</div>
                    </div>
                  {/if}
                  {#if analyzeResult.index_entries}
                    <div>
                      <div class="text-xs text-gh-fg-muted dark:text-gh-fg-dark-muted mb-1">Index Entries</div>
                      <div class="text-sm font-medium">{analyzeResult.index_entries.toLocaleString()}</div>
                    </div>
                  {/if}
                </div>

                <!-- Line Length Statistics -->
                {#if analyzeResult.line_length}
                  <div class="mt-4">
                    <div class="text-xs font-semibold text-gh-fg-muted dark:text-gh-fg-dark-muted mb-2">Line Length</div>
                    <div class="grid grid-cols-3 gap-3 text-sm">
                      <div>
                        <div class="text-xs text-gh-fg-muted dark:text-gh-fg-dark-muted">Max</div>
                        <div class="font-semibold">{analyzeResult.line_length.max}</div>
                        {#if analyzeResult.longest_line}
                          <div class="text-xs text-gh-fg-muted dark:text-gh-fg-dark-muted">Line {analyzeResult.longest_line.line_number.toLocaleString()}</div>
                        {/if}
                      </div>
                      <div>
                        <div class="text-xs text-gh-fg-muted dark:text-gh-fg-dark-muted">Average</div>
                        <div class="font-semibold">{analyzeResult.line_length.avg.toFixed(1)}</div>
                      </div>
                      <div>
                        <div class="text-xs text-gh-fg-muted dark:text-gh-fg-dark-muted">Median</div>
                        <div class="font-semibold">{analyzeResult.line_length.median.toFixed(1)}</div>
                      </div>
                      <div>
                        <div class="text-xs text-gh-fg-muted dark:text-gh-fg-dark-muted">95th %ile</div>
                        <div class="font-semibold">{analyzeResult.line_length.p95.toFixed(1)}</div>
                      </div>
                      <div>
                        <div class="text-xs text-gh-fg-muted dark:text-gh-fg-dark-muted">99th %ile</div>
                        <div class="font-semibold">{analyzeResult.line_length.p99.toFixed(1)}</div>
                      </div>
                      <div>
                        <div class="text-xs text-gh-fg-muted dark:text-gh-fg-dark-muted">Std Dev</div>
                        <div class="font-semibold">{analyzeResult.line_length.stddev.toFixed(1)}</div>
                      </div>
                    </div>
                  </div>
                {/if}
              </div>
            {/if}

            <!-- Compression Information -->
            {#if analyzeResult.compression_format}
              <div>
                <h3 class="text-sm font-semibold text-gh-fg-default dark:text-gh-fg-dark-default mb-3 uppercase tracking-wide">
                  Compression
                </h3>
                <div class="grid grid-cols-2 gap-4">
                  <div>
                    <div class="text-xs text-gh-fg-muted dark:text-gh-fg-dark-muted mb-1">Format</div>
                    <div class="text-sm font-medium uppercase">{analyzeResult.compression_format}</div>
                  </div>
                  {#if analyzeResult.compression_ratio !== null}
                    <div>
                      <div class="text-xs text-gh-fg-muted dark:text-gh-fg-dark-muted mb-1">Ratio</div>
                      <div class="text-sm font-medium">{analyzeResult.compression_ratio.toFixed(2)}x</div>
                    </div>
                  {/if}
                  {#if analyzeResult.decompressed_size_bytes !== null}
                    <div>
                      <div class="text-xs text-gh-fg-muted dark:text-gh-fg-dark-muted mb-1">Decompressed Size</div>
                      <div class="text-sm font-medium">{formatBytes(analyzeResult.decompressed_size_bytes)}</div>
                    </div>
                  {/if}
                </div>
              </div>
            {/if}

            <!-- Anomalies Detection -->
            {#if analyzeResult.anomalies && analyzeResult.anomalies.length > 0}
              {@const anomaliesByDetector = getAnomaliesByDetector(analyzeResult.anomalies)}
              {@const detectors = Object.keys(anomaliesByDetector)}
              {@const activeDetector = selectedAnomalyDetector || detectors[0]}
              <div>
                <h3 class="text-sm font-semibold text-gh-fg-default dark:text-gh-fg-dark-default mb-3 uppercase tracking-wide">
                  Anomalies Detection
                </h3>

                <!-- Summary line -->
                {#if analyzeResult.anomaly_summary}
                  <div class="mb-3 text-sm text-gh-fg-muted dark:text-gh-fg-dark-muted">
                    Found:
                    {#each Object.entries(analyzeResult.anomaly_summary) as [category, count], i}
                      <span class="font-medium text-gh-fg-default dark:text-gh-fg-dark-default">{count}</span> {category}{i < Object.entries(analyzeResult.anomaly_summary).length - 1 ? ', ' : ''}
                    {/each}
                  </div>
                {/if}

                <!-- Detector tabs -->
                <div class="flex flex-wrap border-b border-gh-border-default dark:border-gh-border-dark-default mb-3">
                  {#each detectors as detector}
                    <button
                      class="px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors
                             {activeDetector === detector
                               ? 'border-gh-accent-emphasis dark:border-gh-accent-dark-emphasis text-gh-accent-fg dark:text-gh-accent-dark-fg'
                               : 'border-transparent text-gh-fg-muted dark:text-gh-fg-dark-muted hover:text-gh-fg-default dark:hover:text-gh-fg-dark-default'}"
                      on:click={() => selectedAnomalyDetector = detector}
                    >
                      {getDetectorDisplayName(detector)}
                      <span class="ml-1.5 px-1.5 py-0.5 text-xs rounded-full bg-gh-canvas-subtle dark:bg-gh-canvas-dark-subtle">
                        {anomaliesByDetector[detector].length}
                      </span>
                    </button>
                  {/each}
                </div>

                <!-- Anomaly list for selected detector -->
                <div class="border border-gh-border-default dark:border-gh-border-dark-default rounded overflow-hidden">
                  <div class="max-h-[300px] overflow-y-auto">
                    <table class="w-full text-sm">
                      <thead class="bg-gh-canvas-subtle dark:bg-gh-canvas-dark-subtle sticky top-0">
                        <tr>
                          <th class="text-left px-3 py-2 font-medium text-gh-fg-muted dark:text-gh-fg-dark-muted">Line</th>
                          <th class="text-left px-3 py-2 font-medium text-gh-fg-muted dark:text-gh-fg-dark-muted">Description</th>
                          <th class="text-right px-3 py-2 font-medium text-gh-fg-muted dark:text-gh-fg-dark-muted">Severity</th>
                        </tr>
                      </thead>
                      <tbody>
                        {#each anomaliesByDetector[activeDetector] as anomaly}
                          <tr
                            class="border-t border-gh-border-default dark:border-gh-border-dark-default hover:bg-gh-canvas-subtle dark:hover:bg-gh-canvas-dark-subtle cursor-pointer"
                            on:click={() => handleAnomalyClick(anomaly)}
                          >
                            <td class="px-3 py-2 font-mono text-gh-accent-fg dark:text-gh-accent-dark-fg whitespace-nowrap">
                              {anomaly.start_line.toLocaleString()}
                              {#if anomaly.end_line && anomaly.end_line !== anomaly.start_line}
                                <span class="text-gh-fg-muted dark:text-gh-fg-dark-muted">-{anomaly.end_line.toLocaleString()}</span>
                              {/if}
                            </td>
                            <td class="px-3 py-2 truncate max-w-[300px]" title={anomaly.description}>
                              {anomaly.description}
                            </td>
                            <td class="px-3 py-2 text-right font-medium whitespace-nowrap {getSeverityColor(anomaly.severity)}">
                              {(anomaly.severity * 100).toFixed(0)}%
                            </td>
                          </tr>
                        {/each}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            {:else if analyzeResult.anomaly_summary}
              <!-- Show summary even if no detailed anomalies -->
              <div>
                <h3 class="text-sm font-semibold text-gh-fg-default dark:text-gh-fg-dark-default mb-3 uppercase tracking-wide">
                  Anomalies Summary
                </h3>
                <div class="text-sm text-gh-fg-muted dark:text-gh-fg-dark-muted">
                  Found:
                  {#each Object.entries(analyzeResult.anomaly_summary) as [category, count], i}
                    <span class="font-medium text-gh-fg-default dark:text-gh-fg-dark-default">{count}</span> {category}{i < Object.entries(analyzeResult.anomaly_summary).length - 1 ? ', ' : ''}
                  {/each}
                </div>
              </div>
            {/if}
          </div>
        {/if}
      </div>

      <!-- Footer -->
      <div class="flex items-center justify-end px-6 py-4 border-t border-gh-border-default dark:border-gh-border-dark-default flex-shrink-0">
        <button
          class="px-4 py-2 text-sm font-medium rounded bg-gh-accent-emphasis dark:bg-gh-accent-dark-emphasis text-white hover:bg-gh-accent-fg dark:hover:bg-gh-accent-dark-fg"
          on:click={closeAnalyzePopup}
        >
          Close
        </button>
      </div>
    </div>
  </div>
{/if}

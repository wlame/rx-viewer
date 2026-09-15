<script lang="ts">
  import type { IndexResponse } from '$lib/types';
  import { formatStatistic } from '$lib/utils/format';
  import AnomalyReport from './AnomalyReport.svelte';

  /** The index to describe, with or without an analysis. */
  export let result: IndexResponse;

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
</script>

<div class="space-y-6">
  <!-- General Information -->
  <div>
    <h3
      class="text-sm font-semibold text-gh-fg-default dark:text-gh-fg-dark-default mb-3 uppercase tracking-wide"
    >
      General Information
    </h3>
    <div class="grid grid-cols-2 gap-4">
      <div>
        <div class="text-xs text-gh-fg-muted dark:text-gh-fg-dark-muted mb-1">File Size</div>
        <div class="text-sm font-medium">{formatBytes(result.size_bytes)}</div>
      </div>
      <div>
        <div class="text-xs text-gh-fg-muted dark:text-gh-fg-dark-muted mb-1">Type</div>
        <div class="text-sm font-medium">{result.file_type}</div>
      </div>
      <div>
        <div class="text-xs text-gh-fg-muted dark:text-gh-fg-dark-muted mb-1">Indexed At</div>
        <div class="text-sm font-medium">
          {new Date(result.created_at).toLocaleString()}
        </div>
      </div>
      <div>
        <div class="text-xs text-gh-fg-muted dark:text-gh-fg-dark-muted mb-1">Build Time</div>
        <div class="text-sm font-medium">
          {formatBuildTime(result.build_time_seconds)}
        </div>
      </div>
    </div>
  </div>

  <!-- Line Statistics -->
  {#if result.line_count}
    <div>
      <h3
        class="text-sm font-semibold text-gh-fg-default dark:text-gh-fg-dark-default mb-3 uppercase tracking-wide"
      >
        Line Statistics
      </h3>
      <div class="grid grid-cols-2 gap-4">
        <div>
          <div class="text-xs text-gh-fg-muted dark:text-gh-fg-dark-muted mb-1">Total Lines</div>
          <div class="text-lg font-bold text-gh-accent-fg dark:text-gh-accent-dark-fg">
            {result.line_count.toLocaleString()}
          </div>
        </div>
        {#if result.empty_line_count !== null && result.empty_line_count !== undefined}
          <div>
            <div class="text-xs text-gh-fg-muted dark:text-gh-fg-dark-muted mb-1">Empty Lines</div>
            <div class="text-lg font-bold">
              {result.empty_line_count.toLocaleString()}
            </div>
          </div>
        {/if}
        {#if result.line_ending}
          <div>
            <div class="text-xs text-gh-fg-muted dark:text-gh-fg-dark-muted mb-1">Line Ending</div>
            <div class="text-sm font-medium font-mono">{result.line_ending}</div>
          </div>
        {/if}
        {#if result.index_entries}
          <div>
            <div class="text-xs text-gh-fg-muted dark:text-gh-fg-dark-muted mb-1">
              Index Entries
            </div>
            <div class="text-sm font-medium">
              {result.index_entries.toLocaleString()}
            </div>
          </div>
        {/if}
      </div>

      <!-- Line Length Statistics -->
      {#if result.line_length}
        <div class="mt-4">
          <div class="text-xs font-semibold text-gh-fg-muted dark:text-gh-fg-dark-muted mb-2">
            Line Length
          </div>
          <div class="grid grid-cols-3 gap-3 text-sm">
            <div>
              <div class="text-xs text-gh-fg-muted dark:text-gh-fg-dark-muted">Max</div>
              <div class="font-semibold">{result.line_length.max}</div>
              {#if result.longest_line}
                <div class="text-xs text-gh-fg-muted dark:text-gh-fg-dark-muted">
                  Line {result.longest_line.line_number.toLocaleString()}
                </div>
              {/if}
            </div>
            <div>
              <div class="text-xs text-gh-fg-muted dark:text-gh-fg-dark-muted">Average</div>
              <div class="font-semibold">{formatStatistic(result.line_length.avg)}</div>
            </div>
            <div>
              <div class="text-xs text-gh-fg-muted dark:text-gh-fg-dark-muted">Median</div>
              <div class="font-semibold">
                {formatStatistic(result.line_length.median)}
              </div>
            </div>
            <div>
              <div class="text-xs text-gh-fg-muted dark:text-gh-fg-dark-muted">95th %ile</div>
              <div class="font-semibold">{formatStatistic(result.line_length.p95)}</div>
            </div>
            <div>
              <div class="text-xs text-gh-fg-muted dark:text-gh-fg-dark-muted">99th %ile</div>
              <div class="font-semibold">{formatStatistic(result.line_length.p99)}</div>
            </div>
            <div>
              <div class="text-xs text-gh-fg-muted dark:text-gh-fg-dark-muted">Std Dev</div>
              <div class="font-semibold">
                {formatStatistic(result.line_length.stddev)}
              </div>
            </div>
          </div>
        </div>
      {/if}
    </div>
  {/if}

  <!-- Compression Information -->
  {#if result.compression_format}
    <div>
      <h3
        class="text-sm font-semibold text-gh-fg-default dark:text-gh-fg-dark-default mb-3 uppercase tracking-wide"
      >
        Compression
      </h3>
      <div class="grid grid-cols-2 gap-4">
        <div>
          <div class="text-xs text-gh-fg-muted dark:text-gh-fg-dark-muted mb-1">Format</div>
          <div class="text-sm font-medium uppercase">
            {result.compression_format}
          </div>
        </div>
        {#if result.compression_ratio !== null}
          <div>
            <div class="text-xs text-gh-fg-muted dark:text-gh-fg-dark-muted mb-1">Ratio</div>
            <div class="text-sm font-medium">
              {result.compression_ratio.toFixed(2)}x
            </div>
          </div>
        {/if}
        {#if result.decompressed_size_bytes !== null}
          <div>
            <div class="text-xs text-gh-fg-muted dark:text-gh-fg-dark-muted mb-1">
              Decompressed Size
            </div>
            <div class="text-sm font-medium">
              {formatBytes(result.decompressed_size_bytes)}
            </div>
          </div>
        {/if}
      </div>
    </div>
  {/if}

  <AnomalyReport {result} on:select />
</div>

<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { Anomaly, IndexData } from '$lib/types';

  /** An analysed index: its anomalies, their summary and their count. */
  export let result: IndexData;

  const dispatch = createEventDispatcher<{ select: Anomaly }>();

  let selectedAnomalyDetector: string | null = null; // Selected tab for anomaly detector

  // Group anomalies by detector
  function getAnomaliesByDetector(anomalies: Anomaly[]): Record<string, Anomaly[]> {
    if (!anomalies || !Array.isArray(anomalies)) return {};
    const grouped: Record<string, Anomaly[]> = {};
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
      error: 'Errors',
      traceback: 'Tracebacks',
      format: 'Format Issues',
      warning: 'Warnings',
      exception: 'Exceptions',
      unknown: 'Other',
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
</script>

<!-- Anomalies Detection -->
{#if result.anomalies && result.anomalies.length > 0}
  {@const anomaliesByDetector = getAnomaliesByDetector(result.anomalies)}
  {@const detectors = Object.keys(anomaliesByDetector)}
  {@const activeDetector = selectedAnomalyDetector || detectors[0]}
  <div>
    <h3
      class="text-sm font-semibold text-gh-fg-default dark:text-gh-fg-dark-default mb-3 uppercase tracking-wide"
    >
      Anomalies Detection
    </h3>

    <!-- Summary line -->
    {#if result.anomaly_summary}
      <div class="mb-3 text-sm text-gh-fg-muted dark:text-gh-fg-dark-muted">
        Found:
        {#each Object.entries(result.anomaly_summary) as [category, count], i (category)}
          <span class="font-medium text-gh-fg-default dark:text-gh-fg-dark-default">{count}</span>
          {category}{i < Object.entries(result.anomaly_summary).length - 1 ? ', ' : ''}
        {/each}
      </div>
    {/if}

    <!-- Detector tabs -->
    <div
      class="flex flex-wrap border-b border-gh-border-default dark:border-gh-border-dark-default mb-3"
    >
      {#each detectors as detector (detector)}
        <button
          class="px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors
                 {activeDetector === detector
            ? 'border-gh-accent-emphasis dark:border-gh-accent-dark-emphasis text-gh-accent-fg dark:text-gh-accent-dark-fg'
            : 'border-transparent text-gh-fg-muted dark:text-gh-fg-dark-muted hover:text-gh-fg-default dark:hover:text-gh-fg-dark-default'}"
          on:click={() => (selectedAnomalyDetector = detector)}
        >
          {getDetectorDisplayName(detector)}
          <span
            class="ml-1.5 px-1.5 py-0.5 text-xs rounded-full bg-gh-canvas-subtle dark:bg-gh-canvas-dark-subtle"
          >
            {anomaliesByDetector[detector].length}
          </span>
        </button>
      {/each}
    </div>

    <!-- Anomaly list for selected detector -->
    <div
      class="border border-gh-border-default dark:border-gh-border-dark-default rounded overflow-hidden"
    >
      <div class="max-h-[300px] overflow-y-auto">
        <table class="w-full text-sm">
          <thead class="bg-gh-canvas-subtle dark:bg-gh-canvas-dark-subtle sticky top-0">
            <tr>
              <th
                class="text-left px-3 py-2 font-medium text-gh-fg-muted dark:text-gh-fg-dark-muted"
                >Line</th
              >
              <th
                class="text-left px-3 py-2 font-medium text-gh-fg-muted dark:text-gh-fg-dark-muted"
                >Description</th
              >
              <th
                class="text-right px-3 py-2 font-medium text-gh-fg-muted dark:text-gh-fg-dark-muted"
                >Severity</th
              >
            </tr>
          </thead>
          <tbody>
            {#each anomaliesByDetector[activeDetector] as anomaly (`${anomaly.start_offset}:${anomaly.end_offset}`)}
              <tr
                class="border-t border-gh-border-default dark:border-gh-border-dark-default hover:bg-gh-canvas-subtle dark:hover:bg-gh-canvas-dark-subtle cursor-pointer"
                on:click={() => dispatch('select', anomaly)}
              >
                <td
                  class="px-3 py-2 font-mono text-gh-accent-fg dark:text-gh-accent-dark-fg whitespace-nowrap"
                >
                  {anomaly.start_line.toLocaleString()}
                  {#if anomaly.end_line && anomaly.end_line !== anomaly.start_line}
                    <span class="text-gh-fg-muted dark:text-gh-fg-dark-muted"
                      >-{anomaly.end_line.toLocaleString()}</span
                    >
                  {/if}
                </td>
                <td class="px-3 py-2 truncate max-w-[300px]" title={anomaly.description}>
                  {anomaly.description}
                </td>
                <td
                  class="px-3 py-2 text-right font-medium whitespace-nowrap {getSeverityColor(
                    anomaly.severity,
                  )}"
                >
                  {(anomaly.severity * 100).toFixed(0)}%
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  </div>
{:else if result.analysis_performed && !result.anomaly_count}
  <div>
    <h3
      class="text-sm font-semibold text-gh-fg-default dark:text-gh-fg-dark-default mb-3 uppercase tracking-wide"
    >
      Anomalies Detection
    </h3>
    <div class="text-sm text-gh-fg-muted dark:text-gh-fg-dark-muted">No anomalies found.</div>
  </div>
{:else if result.anomaly_summary}
  <!-- Show summary even if no detailed anomalies -->
  <div>
    <h3
      class="text-sm font-semibold text-gh-fg-default dark:text-gh-fg-dark-default mb-3 uppercase tracking-wide"
    >
      Anomalies Summary
    </h3>
    <div class="text-sm text-gh-fg-muted dark:text-gh-fg-dark-muted">
      Found:
      {#each Object.entries(result.anomaly_summary) as [category, count], i (category)}
        <span class="font-medium text-gh-fg-default dark:text-gh-fg-dark-default">{count}</span>
        {category}{i < Object.entries(result.anomaly_summary).length - 1 ? ', ' : ''}
      {/each}
    </div>
  </div>
{/if}

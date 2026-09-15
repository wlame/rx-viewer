<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { detectors } from '$lib/stores';
  import type { AnomalyRangeResult, IndexResponse, SeverityLevel } from '$lib/types';
  import {
    detectorLabel,
    severityClass,
    severityLevel,
    summaryEntries,
  } from '$lib/utils/anomalyLabels';

  /** An analysed index: its anomalies, their summary and their count. */
  export let result: IndexResponse;

  const dispatch = createEventDispatcher<{ select: AnomalyRangeResult }>();

  let selectedAnomalyDetector: string | null = null; // Selected tab for anomaly detector

  // Group anomalies by detector
  function getAnomaliesByDetector(
    anomalies: AnomalyRangeResult[],
  ): Record<string, AnomalyRangeResult[]> {
    if (!anomalies || !Array.isArray(anomalies)) return {};
    const grouped: Record<string, AnomalyRangeResult[]> = {};
    for (const anomaly of anomalies) {
      const detector = anomaly.detector || 'unknown';
      if (!grouped[detector]) {
        grouped[detector] = [];
      }
      grouped[detector].push(anomaly);
    }
    return grouped;
  }

  /** The severity's level on the backend's scale, as a tooltip. */
  function severityTitle(severity: number, scale: SeverityLevel[]): string {
    const level = severityLevel(severity, scale);
    return level ? `${level.label}: ${level.description}` : '';
  }

  $: summary = summaryEntries(result.anomaly_summary, $detectors.detectors);
</script>

<!-- Anomalies Detection -->
{#if result.anomalies && result.anomalies.length > 0}
  {@const anomaliesByDetector = getAnomaliesByDetector(result.anomalies)}
  {@const detectorNames = Object.keys(anomaliesByDetector)}
  {@const activeDetector = selectedAnomalyDetector || detectorNames[0]}
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
        {#each summary as entry, i (entry.name)}
          <span class="font-medium text-gh-fg-default dark:text-gh-fg-dark-default"
            >{entry.count}</span
          >
          <span class="whitespace-nowrap" title={entry.description}>{entry.name}</span
          >{#if entry.category}&nbsp;<span class="text-xs whitespace-nowrap"
              >({entry.category})</span
            >{/if}{i < summary.length - 1 ? ', ' : ''}
        {/each}
      </div>
    {/if}

    <!-- Detector tabs -->
    <div
      class="flex flex-wrap border-b border-gh-border-default dark:border-gh-border-dark-default mb-3"
    >
      {#each detectorNames as detector (detector)}
        {@const label = detectorLabel(detector, $detectors.detectors)}
        <button
          title={label.description}
          class="px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors
                 {activeDetector === detector
            ? 'border-gh-accent-emphasis dark:border-gh-accent-dark-emphasis text-gh-accent-fg dark:text-gh-accent-dark-fg'
            : 'border-transparent text-gh-fg-muted dark:text-gh-fg-dark-muted hover:text-gh-fg-default dark:hover:text-gh-fg-dark-default'}"
          on:click={() => (selectedAnomalyDetector = detector)}
        >
          {label.name}
          {#if label.category}
            <span class="ml-1 text-xs font-normal text-gh-fg-muted dark:text-gh-fg-dark-muted"
              >{label.category}</span
            >
          {/if}
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
                  class="px-3 py-2 text-right font-medium whitespace-nowrap {severityClass(
                    anomaly.severity,
                    $detectors.severityScale,
                  )}"
                  title={severityTitle(anomaly.severity, $detectors.severityScale)}
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
      {#each summary as entry, i (entry.name)}
        <span class="font-medium text-gh-fg-default dark:text-gh-fg-dark-default"
          >{entry.count}</span
        >
        <span class="whitespace-nowrap" title={entry.description}>{entry.name}</span
        >{#if entry.category}&nbsp;<span class="text-xs whitespace-nowrap">({entry.category})</span
          >{/if}{i < summary.length - 1 ? ', ' : ''}
      {/each}
    </div>
  </div>
{/if}

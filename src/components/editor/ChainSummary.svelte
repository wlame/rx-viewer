<script lang="ts">
  /**
   * What the editor header says about a log chain: its state, its lines
   * (the frozen parts' with `…` while the active part is not counted), its
   * time range, how far its index task has got, its time gaps and missing
   * parts, why it is invalid, and the list of its parts, which goes to a
   * part's first line.
   */
  import { createEventDispatcher } from 'svelte';
  import type { ChainTab } from '$lib/types';
  import {
    chainIndexingLabel,
    chainLinesLabel,
    gapsAndMissingSummary,
    isEmptyPart,
    type ChainLineTarget,
  } from '$lib/utils/chainParts';
  import { partTimeLabel } from '$lib/utils/chainZones';
  import ChainPartsPopover from './ChainPartsPopover.svelte';

  export let chain: ChainTab;

  const dispatch = createEventDispatcher<{ goto: ChainLineTarget }>();

  /** What each state lets the tab do, for the state's tooltip. */
  const STATE_TITLES: Record<string, string> = {
    pending:
      'Some parts have no line index yet: each part shows its own line numbers until the index task ends',
    ready: 'Every part is indexed and every check passed: the parts read as one text',
    invalid: 'A check failed: the parts cannot be read as one text',
  };

  $: description = chain.description;
  $: parts = description?.parts ?? [];
  $: linesLabel = description ? chainLinesLabel(description) : null;
  $: partsWithLines = parts.filter((part) => !isEmptyPart(part));
  $: timeRange =
    description && description.first_ms !== null && description.last_ms !== null
      ? `${partTimeLabel(description.first_ms, partsWithLines[0] ?? parts[0])} – ${partTimeLabel(
          description.last_ms,
          partsWithLines.at(-1) ?? parts[0],
        )}`
      : null;
  $: summary = description ? gapsAndMissingSummary(description) : null;
  $: summaryTitle = description
    ? [
        ...description.gaps.map((gap) => `no lines between ${gap.after} and ${gap.before}`),
        ...description.missing.map((name) => `missing: ${name}`),
      ].join('\n')
    : '';
  $: reasonCodes = description?.reasons.map((reason) => reason.code) ?? [];
  $: reasonsTitle = description?.reasons.map((reason) => reason.message).join('\n') ?? '';
</script>

{#if description}
  <span class="flex items-center gap-2 text-xs text-gh-fg-muted dark:text-gh-fg-dark-muted min-w-0">
    <span class="badge text-[10px] py-0" title={STATE_TITLES[description.state] ?? ''}>
      {description.state}
    </span>
    {#if linesLabel}
      <span class="tabular-nums" title="The chain's lines">{linesLabel} lines</span>
    {/if}
    {#if timeRange}
      <span class="truncate" title="The chain's first and last time">{timeRange}</span>
    {/if}
    {#if description.state === 'pending' && chain.indexTask}
      <span class="badge badge-warning text-[10px] py-0 tabular-nums" data-indexing>
        {chainIndexingLabel(parts, chain.indexTask.progress)}
      </span>
    {/if}
    {#if description.state === 'pending' && !chain.indexTask && chain.buildRefused}
      <span class="badge badge-warning text-[10px] py-0" title={chain.buildRefused}>
        waiting for an index task
      </span>
    {/if}
    {#if chain.indexProblem}
      <span class="badge badge-warning text-[10px] py-0" title={chain.indexProblem}>
        index task
      </span>
    {/if}
    {#if summary}
      <span title={summaryTitle}>{summary}</span>
    {/if}
    {#if reasonCodes.length > 0}
      <span class="text-gh-danger-fg dark:text-gh-danger-dark-fg" title={reasonsTitle}>
        invalid: {reasonCodes.join(', ')}
      </span>
    {/if}
    {#if parts.length > 0}
      <ChainPartsPopover {parts} on:goto={(e) => dispatch('goto', e.detail)} />
    {/if}
  </span>
{/if}

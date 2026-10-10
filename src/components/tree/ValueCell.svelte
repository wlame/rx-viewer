<!--
  The value a files panel row shows right of its name, in a column of one
  width: its size, or its modification time in the browser's zone with
  the full time in its tooltip. A row without the value shows an empty
  cell, so the column stays aligned.
-->
<script lang="ts">
  import { tooltip } from '$lib/actions/tooltip';
  import { formatFileTime } from '$lib/utils/format';
  import type { ValueColumn } from '$lib/utils/urlState';

  export let show: ValueColumn;
  /** The row's size as the column shows it (`12.4 MB`, `24 items`), or '' without one. */
  export let size: string;
  /** The row's modification time as the listing writes it, or null without one. */
  export let modifiedAt: string | null;

  // Tailwind reads the width from this text, so it is a literal class. The
  // column header's value button (`TreeHeader.svelte`) is this wide plus
  // its own padding: change the two together.
  const CELL_CLASS =
    'w-[11ch] flex-shrink-0 text-right text-xs tabular-nums whitespace-nowrap overflow-hidden ' +
    'text-gh-fg-subtle dark:text-gh-fg-dark-subtle';

  $: time = show === 'date' && modifiedAt !== null ? formatFileTime(modifiedAt) : null;
</script>

{#if time !== null && time.text !== ''}
  <span data-value-cell class={CELL_CLASS} use:tooltip={{ label: time.full }}>{time.text}</span>
{:else}
  <span data-value-cell class={CELL_CLASS}>{show === 'size' ? size : ''}</span>
{/if}

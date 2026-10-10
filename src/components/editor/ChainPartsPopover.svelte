<script lang="ts">
  /**
   * The parts of a log chain in its order, from a button in the editor
   * header: each part's real name, its compression, the global lines it
   * holds (its own line count before the chain is ready) and whether it
   * is indexed. A click goes to the part's first line; an empty part has
   * none. Escape closes the list.
   */
  import { createEventDispatcher } from 'svelte';
  import type { ChainPart } from '$lib/types';
  import {
    isEmptyPart,
    partIndexWord,
    partLineRange,
    type ChainLineTarget,
  } from '$lib/utils/chainParts';
  import { isShortcut } from '$lib/utils/shortcuts';

  /** The chain's parts, in its order. */
  export let parts: readonly ChainPart[];

  const dispatch = createEventDispatcher<{ goto: ChainLineTarget }>();

  let isOpen = false;

  /** The lines a part holds: its global lines once the chain is ready, else its count. */
  function linesOf(part: ChainPart): string {
    const range = partLineRange(part);
    if (range !== null && range.last !== null) {
      return `lines ${range.first.toLocaleString()}–${range.last.toLocaleString()}`;
    }
    if (range !== null) return `lines from ${range.first.toLocaleString()}`;
    if (part.line_count !== null && !isEmptyPart(part)) {
      return `${part.line_count.toLocaleString()} lines`;
    }
    return '';
  }

  function goTo(part: ChainPart) {
    isOpen = false;
    dispatch('goto', { kind: 'local', part: part.name, line: 1 });
  }

  /** Escape closes the list, unless the control with the focus already acted on it. */
  function handleKeydown(event: KeyboardEvent) {
    if (event.defaultPrevented) return;
    if (isOpen && isShortcut('closeChainParts', event)) isOpen = false;
  }
</script>

<svelte:window on:keydown={handleKeydown} />

<span class="relative">
  <button
    type="button"
    class="hover:text-gh-accent-fg dark:hover:text-gh-accent-dark-fg hover:underline"
    aria-expanded={isOpen}
    aria-controls="chain-parts-list"
    title="The parts of the chain, in its order"
    on:click={() => (isOpen = !isOpen)}
  >
    {parts.length.toLocaleString()} parts
  </button>
  {#if isOpen}
    <ul
      id="chain-parts-list"
      aria-label="Parts of the chain"
      class="absolute left-0 top-full mt-1 z-20 max-h-80 w-max max-w-[36rem] overflow-auto rounded shadow-lg
             bg-gh-canvas-default dark:bg-gh-canvas-dark-default
             border border-gh-border-default dark:border-gh-border-dark-default text-xs"
    >
      {#each parts as part (part.name)}
        <li>
          <button
            type="button"
            class="w-full grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-3 px-3 py-1 text-left
                   enabled:hover:bg-gh-canvas-subtle dark:enabled:hover:bg-gh-canvas-dark-subtle
                   disabled:opacity-60"
            disabled={isEmptyPart(part)}
            title={isEmptyPart(part)
              ? `${part.name} is empty`
              : `Go to the first line of ${part.name}`}
            on:click={() => goTo(part)}
          >
            <span class="font-mono truncate">{part.name}</span>
            <span>{part.compression_format ?? 'plain'}</span>
            <span class="tabular-nums">{linesOf(part)}</span>
            <span>{partIndexWord(part)}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</span>

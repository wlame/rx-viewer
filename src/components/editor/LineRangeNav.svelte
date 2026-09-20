<script lang="ts">
  /**
   * The editor header's position readout: the first and last loaded
   * lines and the file's length, each a button that jumps there, with a
   * go-to-line box between them.
   */
  import { createEventDispatcher } from 'svelte';
  import { isShortcut } from '$lib/utils/shortcuts';

  /** First and last file line the editor holds. */
  export let startLine: number;
  export let endLine: number;
  /** The file's line count, or null when it is not known yet. */
  export let totalLines: number | null;

  const dispatch = createEventDispatcher<{
    jump: { line: number };
    goto: { line: number };
    jumpToEnd: void;
  }>();

  let gotoVisible = false;
  let gotoValue = '';
  let gotoInputEl: HTMLInputElement;

  /** Opens the go-to-line box, prefilled with the middle of the loaded window. */
  export function openGoto() {
    gotoValue = Math.round((startLine + endLine) / 2).toString();
    gotoVisible = true;
    setTimeout(() => {
      gotoInputEl?.focus();
      gotoInputEl?.select();
    }, 0);
  }

  function closeGoto() {
    gotoVisible = false;
    gotoValue = '';
  }

  // The keys are rows of the shortcut table, which leaves a key press to
  // an input method while it composes.
  function handleGotoKeyDown(e: KeyboardEvent) {
    if (isShortcut('gotoJump', e)) {
      e.preventDefault();
      const line = parseInt(gotoValue, 10);
      if (!isNaN(line) && line > 0) {
        dispatch('goto', { line });
        closeGoto();
      }
    } else if (isShortcut('gotoClose', e)) {
      e.preventDefault();
      closeGoto();
    }
  }
</script>

<span class="text-sm text-gh-fg-muted dark:text-gh-fg-dark-muted flex items-center gap-1.5">
  <span>lines</span>
  <button
    class="font-bold hover:text-gh-accent-fg dark:hover:text-gh-accent-dark-fg hover:underline"
    on:click={() => dispatch('jump', { line: startLine })}
    title="Jump to line {startLine}"
  >
    {startLine.toLocaleString()}
  </button>
  {#if gotoVisible}
    <input
      bind:this={gotoInputEl}
      bind:value={gotoValue}
      on:keydown={handleGotoKeyDown}
      on:blur={closeGoto}
      type="number"
      class="text-sm bg-gh-canvas-default dark:bg-gh-canvas-dark-default border border-gh-border-default dark:border-gh-border-dark-default rounded px-2 py-0.5 outline-none w-32 text-center font-bold"
    />
  {:else}
    <button
      class="font-bold hover:text-gh-accent-fg dark:hover:text-gh-accent-dark-fg hover:underline px-1"
      on:click={openGoto}
      title="Jump to line..."
    >
      —
    </button>
  {/if}
  <button
    class="font-bold hover:text-gh-accent-fg dark:hover:text-gh-accent-dark-fg hover:underline"
    on:click={() => dispatch('jump', { line: endLine })}
    title="Jump to line {endLine}"
  >
    {endLine.toLocaleString()}
  </button>
  <span class="text-gh-fg-subtle dark:text-gh-fg-dark-subtle">/</span>
  {#if totalLines !== null}
    {@const lastLine = totalLines}
    <button
      class="font-bold hover:text-gh-accent-fg dark:hover:text-gh-accent-dark-fg hover:underline"
      on:click={() => dispatch('jump', { line: lastLine })}
      title="Jump to last line ({lastLine.toLocaleString()})"
    >
      {lastLine.toLocaleString()}
    </button>
  {:else}
    <button
      class="font-bold hover:text-gh-accent-fg dark:hover:text-gh-accent-dark-fg hover:underline"
      on:click={() => dispatch('jumpToEnd')}
      title="Jump to end of file"
    >
      ⋯
    </button>
  {/if}
</span>

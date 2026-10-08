<script lang="ts">
  /**
   * The editor header's position readout: the first and last loaded
   * lines and the file's length, each a button that jumps there, with a
   * go-to-line box between them.
   *
   * In a log chain's tab the box takes a global line or `part:line`
   * (`readChainTarget` reads it and says why a text names no line), and
   * a chain that is not ready shows its lines as `part:line` (`labels`).
   */
  import { createEventDispatcher } from 'svelte';
  import type { ChainLineInput, ChainLineTarget } from '$lib/utils/chainParts';
  import { isShortcut } from '$lib/utils/shortcuts';

  /** First and last file line the editor holds. */
  export let startLine: number;
  export let endLine: number;
  /** The file's line count, or null when it is not known yet. */
  export let totalLines: number | null;
  /** The first, middle and last held lines as shown in place of their numbers, or null. */
  export let labels: { start: string; middle: string; end: string } | null = null;
  /** Reads the go-to box of a chain's tab; null for a file's line number box. */
  export let readChainTarget: ((text: string) => ChainLineInput) | null = null;

  const dispatch = createEventDispatcher<{
    jump: { line: number };
    goto: { line: number };
    gotoChain: ChainLineTarget;
    jumpToEnd: void;
  }>();

  let gotoVisible = false;
  let gotoValue = '';
  let gotoError: string | null = null;
  let gotoInputEl: HTMLInputElement;

  /** Opens the go-to-line box, prefilled with the middle of the loaded window. */
  export function openGoto() {
    gotoValue = labels?.middle ?? Math.round((startLine + endLine) / 2).toString();
    gotoError = null;
    gotoVisible = true;
    setTimeout(() => {
      gotoInputEl?.focus();
      gotoInputEl?.select();
    }, 0);
  }

  function closeGoto() {
    gotoVisible = false;
    gotoValue = '';
    gotoError = null;
  }

  /** Go to the typed line: a line number in a file, a global line or part:line in a chain. */
  function submitGoto() {
    if (readChainTarget) {
      const input = readChainTarget(String(gotoValue));
      if (input.kind === 'invalid') {
        gotoError = input.message;
        return;
      }
      dispatch('gotoChain', input);
      closeGoto();
      return;
    }
    const line = parseInt(String(gotoValue), 10);
    if (!isNaN(line) && line > 0) {
      dispatch('goto', { line });
      closeGoto();
    }
  }

  // The keys are rows of the shortcut table, which leaves a key press to
  // an input method while it composes.
  function handleGotoKeyDown(e: KeyboardEvent) {
    if (isShortcut('gotoJump', e)) {
      e.preventDefault();
      submitGoto();
    } else if (isShortcut('gotoClose', e)) {
      e.preventDefault();
      closeGoto();
    }
  }

  const inputClass =
    'text-sm bg-gh-canvas-default dark:bg-gh-canvas-dark-default border border-gh-border-default dark:border-gh-border-dark-default rounded px-2 py-0.5 outline-none text-center font-bold';
</script>

<span class="text-sm text-gh-fg-muted dark:text-gh-fg-dark-muted flex items-center gap-1.5">
  <span>lines</span>
  <button
    class="font-bold hover:text-gh-accent-fg dark:hover:text-gh-accent-dark-fg hover:underline"
    on:click={() => dispatch('jump', { line: startLine })}
    title="Jump to line {labels?.start ?? startLine}"
  >
    {labels?.start ?? startLine.toLocaleString()}
  </button>
  {#if gotoVisible && readChainTarget}
    <input
      bind:this={gotoInputEl}
      bind:value={gotoValue}
      on:keydown={handleGotoKeyDown}
      on:input={() => (gotoError = null)}
      on:blur={closeGoto}
      type="text"
      aria-label="Go to a global line, or part:line"
      aria-invalid={gotoError !== null}
      aria-describedby="chain-goto-error"
      placeholder="line or part:line"
      class="{inputClass} w-56"
    />
    <span
      id="chain-goto-error"
      role="alert"
      class="text-xs text-gh-danger-fg dark:text-gh-danger-dark-fg">{gotoError ?? ''}</span
    >
  {:else if gotoVisible}
    <input
      bind:this={gotoInputEl}
      bind:value={gotoValue}
      on:keydown={handleGotoKeyDown}
      on:blur={closeGoto}
      type="number"
      aria-label="Go to line"
      class="{inputClass} w-32"
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
    title="Jump to line {labels?.end ?? endLine}"
  >
    {labels?.end ?? endLine.toLocaleString()}
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

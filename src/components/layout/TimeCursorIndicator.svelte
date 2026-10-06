<script lang="ts">
  /**
   * The time cursor at the right edge of the tab row: its time, written
   * the way the active file writes a timestamp and in the zone its lines
   * show (ISO 8601 in UTC when the active file has no timestamps), a `+`
   * that adds the cursor to the timestamps stash and a `×` that clears
   * it. Nothing shows while no cursor is set.
   */
  import type { OpenFile } from '$lib/types';
  import { formatInFileLayout } from '$lib/utils/timeFormat';
  import { hasTimeFormat } from '$lib/utils/timeline';

  /** The time cursor (UTC ms), or null when none is set. */
  export let cursorMs: number | null;
  /** The file the editor shows; the time is written its way. */
  export let activeFile: OpenFile | undefined;
  /** Add the cursor's instant to the stash, or null while there is nothing to add. */
  export let addToStash: ((instantMs: number) => void) | null;
  /** Clear the time cursor. */
  export let clearCursor: () => void;

  $: label = cursorMs === null ? '' : labelOf(cursorMs, activeFile);

  /** `ms` in the file's layout, or ISO 8601 in UTC for a file without timestamps. */
  function labelOf(ms: number, file: OpenFile | undefined): string {
    return file?.timeRange && hasTimeFormat(file)
      ? formatInFileLayout(ms, file.timeRange)
      : new Date(ms).toISOString();
  }

  function add() {
    if (cursorMs !== null) addToStash?.(cursorMs);
  }

  const BUTTON_CLASS = `p-0.5 rounded outline-none
    text-gh-fg-muted dark:text-gh-fg-dark-muted
    enabled:hover:text-gh-fg-default dark:enabled:hover:text-gh-fg-dark-default
    enabled:hover:bg-gh-canvas-inset dark:enabled:hover:bg-gh-canvas-dark-inset
    disabled:opacity-40 disabled:cursor-not-allowed
    focus-visible:ring-1 focus-visible:ring-gh-accent-emphasis dark:focus-visible:ring-gh-accent-dark-emphasis`;
</script>

{#if cursorMs !== null}
  <div
    data-time-cursor
    role="group"
    aria-label="Time cursor"
    title="Time cursor: the time of the last jump by time"
    class="flex items-center gap-1 h-6 pl-2 pr-0.5 shrink-0 rounded text-xs
           font-mono tabular-nums whitespace-nowrap
           border border-gh-attention-emphasis/50 dark:border-gh-attention-dark-fg/50
           text-gh-attention-fg dark:text-gh-attention-dark-fg"
  >
    <span
      aria-hidden="true"
      class="w-1.5 h-1.5 mr-0.5 rotate-45 bg-gh-attention-emphasis dark:bg-gh-attention-dark-fg"
    />
    <span data-time-cursor-label class="hidden sm:inline">{label}</span>
    <button
      type="button"
      aria-label="Add the time cursor to the stash"
      title="Add the time cursor to the stash"
      disabled={addToStash === null}
      on:click={add}
      class={BUTTON_CLASS}
    >
      <svg
        class="w-3 h-3"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        aria-hidden="true"
      >
        <path d="M12 5v14M5 12h14" />
      </svg>
    </button>
    <button
      type="button"
      aria-label="Clear the time cursor"
      title="Clear the time cursor"
      on:click={clearCursor}
      class={BUTTON_CLASS}
    >
      <svg
        class="w-3 h-3"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        aria-hidden="true"
      >
        <path d="M18 6L6 18M6 6l12 12" />
      </svg>
    </button>
  </div>
{/if}

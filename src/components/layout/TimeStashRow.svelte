<script lang="ts">
  /**
   * The timestamps stash, a row above the tabs: each saved moment written
   * the way the active file writes a time (ISO 8601 in UTC for a file
   * without timestamps), a button that jumps the active file to it, and a
   * `×` that removes it. An entry outside the active file's range, or for
   * a file without timestamps or with its range not known yet, is dimmed
   * and does not jump; its tooltip says why, and its `×` still removes it.
   * A hint shows while the stash is empty.
   *
   * The row has one fixed height, entries or hint, and the entries scroll
   * sideways inside it, so the editor below never moves when the stash
   * changes.
   */
  import type { OpenFile } from '$lib/types';
  import type { TimeJumpOutcome } from '$lib/stores/files';
  import { notifications } from '$lib/stores/notifications';
  import { timeLabelFor } from '$lib/utils/timeline';
  import { stashEntryState } from '$lib/utils/timeStash';

  /** The stash: instants (UTC ms) in time order. */
  export let stash: readonly number[];
  /** The file an entry jumps; entries are written its way. */
  export let activeFile: OpenFile | undefined;
  /** Whether the backend answers time queries (`samples_timestamps`). */
  export let canJump: boolean;
  /** Move the active file to an instant. */
  export let jump: (instantMs: number) => Promise<TimeJumpOutcome>;
  /** Remove an instant from the stash. */
  export let remove: (instantMs: number) => void;

  $: entries = stash.map((instantMs) => ({
    instantMs,
    label: timeLabelFor(instantMs, activeFile),
    state: stashEntryState(instantMs, activeFile, canJump),
  }));

  async function go(instantMs: number, label: string) {
    const fileName = activeFile?.name ?? '';
    const outcome = await jump(instantMs);
    if (outcome.kind === 'refused') {
      notifications.error(`Cannot go to ${label} in ${fileName}: ${outcome.message}`, 5000);
    }
  }

  const BUTTON_CLASS = `rounded outline-none
    focus-visible:ring-1 focus-visible:ring-gh-accent-emphasis dark:focus-visible:ring-gh-accent-dark-emphasis`;
</script>

<div
  data-time-stash
  class="flex items-center gap-2 h-7 px-2 shrink-0 text-xs
         bg-gh-canvas-subtle dark:bg-gh-canvas-dark-subtle
         border-b border-gh-border-default dark:border-gh-border-dark-default"
>
  <svg
    class="w-3.5 h-3.5 shrink-0 text-gh-fg-muted dark:text-gh-fg-dark-muted"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    aria-hidden="true"
  >
    <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" />
  </svg>
  {#if entries.length === 0}
    <span class="text-gh-fg-subtle dark:text-gh-fg-dark-subtle whitespace-nowrap truncate">
      + on the cursor saves a moment here
    </span>
  {:else}
    <ul
      aria-label="Timestamps stash"
      class="flex-1 min-w-0 flex items-center gap-1 overflow-x-auto scrollbar-hide"
    >
      {#each entries as entry (entry.instantMs)}
        <li
          data-stash-entry
          title={entry.state.isEnabled
            ? `Go to ${entry.label} in ${activeFile?.name ?? ''}`
            : entry.state.reason}
          class="flex items-center h-5 shrink-0 rounded font-mono tabular-nums whitespace-nowrap
                 border border-gh-border-default dark:border-gh-border-dark-default
                 bg-gh-canvas-default dark:bg-gh-canvas-dark-default"
        >
          <button
            type="button"
            data-go
            aria-label={entry.state.isEnabled
              ? `Go to ${entry.label}`
              : `${entry.label}: ${entry.state.reason}`}
            disabled={!entry.state.isEnabled}
            on:click={() => go(entry.instantMs, entry.label)}
            class="{BUTTON_CLASS} h-full pl-1.5 pr-1
                   text-gh-fg-default dark:text-gh-fg-dark-default
                   enabled:hover:text-gh-accent-fg dark:enabled:hover:text-gh-accent-dark-fg
                   disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {entry.label}
          </button>
          <button
            type="button"
            data-remove
            aria-label="Remove {entry.label} from the stash"
            title="Remove from the stash"
            on:click={() => remove(entry.instantMs)}
            class="{BUTTON_CLASS} p-0.5 mr-0.5
                   text-gh-fg-muted dark:text-gh-fg-dark-muted
                   hover:text-gh-danger-fg dark:hover:text-gh-danger-dark-fg
                   hover:bg-gh-danger-subtle dark:hover:bg-gh-danger-dark-subtle"
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
        </li>
      {/each}
    </ul>
  {/if}
</div>

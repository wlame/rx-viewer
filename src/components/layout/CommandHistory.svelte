<script lang="ts">
  /**
   * The recent commands panel above the status bar, newest first. Each
   * row names what the user did, when the answer came, and the `rx`
   * command that gives it, with a copy button. Escape closes it.
   */
  import { createEventDispatcher } from 'svelte';
  import type { CommandAction, CommandEntry } from '$lib/stores/commands';

  export let entries: CommandEntry[];

  const dispatch = createEventDispatcher<{ copy: string; close: void }>();

  const ACTION_LABELS: Record<CommandAction, string> = {
    search: 'Search',
    file: 'File',
    index: 'Index',
    analysis: 'Analysis',
  };

  function timeOf(at: number): string {
    return new Date(at).toLocaleTimeString();
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') dispatch('close');
  }
</script>

<svelte:window on:keydown={handleKeydown} />

<section
  id="command-history"
  aria-label="Recent commands"
  class="absolute bottom-6 left-0 right-0 max-h-64 overflow-auto
         bg-gh-canvas-default dark:bg-gh-canvas-dark-default
         border-t border-gh-border-default dark:border-gh-border-dark-default shadow-lg"
>
  <header
    class="sticky top-0 flex items-center justify-between px-3 py-1
           bg-gh-canvas-subtle dark:bg-gh-canvas-dark-subtle"
  >
    <span class="font-medium">Recent commands</span>
    <button
      type="button"
      class="hover:text-gh-accent-fg dark:hover:text-gh-accent-dark-fg"
      on:click={() => dispatch('close')}
    >
      Hide
    </button>
  </header>
  <ul class="divide-y divide-gh-border-default dark:divide-gh-border-dark-default">
    {#each entries as entry (entry.command)}
      <li class="flex items-center gap-3 px-3 py-1">
        <span class="w-16 shrink-0">{ACTION_LABELS[entry.action]}</span>
        <span class="w-20 shrink-0">{timeOf(entry.at)}</span>
        <code
          class="flex-1 min-w-0 truncate font-mono select-all
                 text-gh-fg-default dark:text-gh-fg-dark-default"
          title={entry.command}>{entry.command}</code
        >
        <button
          type="button"
          class="shrink-0 hover:text-gh-accent-fg dark:hover:text-gh-accent-dark-fg"
          aria-label="Copy {entry.command}"
          on:click={() => dispatch('copy', entry.command)}
        >
          Copy
        </button>
      </li>
    {/each}
  </ul>
</section>

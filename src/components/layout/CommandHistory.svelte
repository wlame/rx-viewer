<script lang="ts">
  /**
   * The recent commands panel above the status bar, newest first. Each
   * row names what the user did, when the answer came, and the `rx`
   * command that gives it, with a copy button; under it, the commands that
   * give the same answer piece by piece (the `rx samples PART` of each
   * part of a log chain's lines). Escape closes it.
   */
  import { createEventDispatcher } from 'svelte';
  import type { CommandAction, CommandEntry } from '$lib/stores/commands';
  import { isShortcut } from '$lib/utils/shortcuts';

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
    if (isShortcut('closeHistory', event)) dispatch('close');
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
      <li class="px-3 py-1">
        <div class="flex items-center gap-3">
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
        </div>
        {#if entry.details && entry.details.length > 0}
          <ul aria-label="The same answer, part by part" class="pl-[9.75rem]">
            {#each entry.details as detail, index (index)}
              <li class="flex items-center gap-3">
                <code
                  class="flex-1 min-w-0 truncate font-mono select-all
                         text-gh-fg-default dark:text-gh-fg-dark-default"
                  title={detail}>{detail}</code
                >
                <button
                  type="button"
                  class="shrink-0 hover:text-gh-accent-fg dark:hover:text-gh-accent-dark-fg"
                  aria-label="Copy {detail}"
                  on:click={() => dispatch('copy', detail)}
                >
                  Copy
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </li>
    {/each}
  </ul>
</section>

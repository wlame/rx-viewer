<script lang="ts">
  import { createEventDispatcher, onDestroy, onMount } from 'svelte';
  import type { Anomaly, IndexData, TaskStatus } from '$lib/types';
  import { files, notifications } from '$lib/stores';
  import { analyzeFile } from '$lib/indexTasks';
  import { isAbortError } from '$lib/utils/latestRequest';
  import Spinner from '../common/Spinner.svelte';
  import AnalysisReport from './AnalysisReport.svelte';

  /** The file to analyse. */
  export let path: string;
  /** Its name, for the title. */
  export let name: string;

  const dispatch = createEventDispatcher<{ close: void }>();

  let analyzeLoading = true;
  let analyzeStatusMessage = 'Checking for an analysis...';
  let analyzeResult: IndexData | null = null;

  /** Cancels the analysis wait: its index request and its share of the task poll. */
  const run = new AbortController();

  // The dialog goes away when it is closed, and with its tree row when
  // the folder collapses or the sidebar switches to Search; a poll
  // nobody can see stops with it.
  onDestroy(() => run.abort());

  onMount(async () => {
    try {
      analyzeResult = await analyzeFile(path, {
        signal: run.signal,
        onStatus: (task: TaskStatus) => {
          analyzeStatusMessage = `Analyzing... (${task.status})`;
        },
      });
      notifications.success(`Analysis ready for ${name}`, 3000);
    } catch (e) {
      // Closing the dialog cancels the run; nothing to report.
      if (isAbortError(e)) return;
      const error = e instanceof Error ? e.message : 'Analysis failed';
      notifications.error(error, 5000);
      close();
    } finally {
      analyzeLoading = false;
    }
  });

  function close() {
    run.abort();
    dispatch('close');
  }

  /** Escape closes the dialog. Without it the only way out is a click,
   *  which leaves a keyboard user trapped behind the overlay. */
  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      close();
    }
  }

  /** Close only when the backdrop itself was clicked, not the dialog on
   *  top of it. Comparing target to currentTarget does what a
   *  stopPropagation handler on the dialog used to do, without giving a
   *  non-interactive element a click handler of its own. */
  function handleBackdropClick(event: MouseEvent) {
    if (event.target === event.currentTarget) {
      close();
    }
  }

  // Handle clicking on an anomaly row to navigate to the line
  function handleAnomalySelect(event: CustomEvent<Anomaly>) {
    const anomaly = event.detail;
    close();
    // Set highlighted lines for the anomaly range
    const endLine = anomaly.end_line || anomaly.start_line;
    files.setHighlightedLines(path, { start: anomaly.start_line, end: endLine });
    // Jump to the line - this properly loads content around the target line
    files.jumpToLine(path, anomaly.start_line);
  }
</script>

<svelte:window on:keydown={handleKeydown} />

<!-- role="presentation" marks the backdrop as decorative: Escape
     closes the dialog (handleKeydown), so the backdrop
     click is a mouse convenience, not the only way out. -->
<div
  class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
  role="presentation"
  on:click={handleBackdropClick}
>
  <div
    class="bg-gh-canvas-default dark:bg-gh-canvas-dark-default rounded-lg shadow-xl max-w-3xl w-full max-h-[80vh] flex flex-col overflow-hidden"
    role="dialog"
    aria-modal="true"
    aria-labelledby="analyze-dialog-title"
  >
    <!-- Header -->
    <div
      class="flex items-center justify-between px-6 py-4 border-b border-gh-border-default dark:border-gh-border-dark-default flex-shrink-0"
    >
      <h2
        id="analyze-dialog-title"
        class="text-lg font-semibold text-gh-fg-default dark:text-gh-fg-dark-default"
      >
        Analysis: {name}
      </h2>
      <button
        class="p-1 rounded hover:bg-gh-canvas-subtle dark:hover:bg-gh-canvas-dark-subtle"
        on:click={close}
        aria-label="Close"
      >
        <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-y-auto p-6">
      {#if analyzeLoading}
        <div class="flex flex-col items-center justify-center py-12">
          <Spinner size="lg" />
          <p class="mt-4 text-gh-fg-muted dark:text-gh-fg-dark-muted">
            {analyzeStatusMessage || 'Analyzing...'}
          </p>
        </div>
      {:else if analyzeResult}
        <AnalysisReport result={analyzeResult} on:select={handleAnomalySelect} />
      {/if}
    </div>

    <!-- Footer -->
    <div
      class="flex items-center justify-end px-6 py-4 border-t border-gh-border-default dark:border-gh-border-dark-default flex-shrink-0"
    >
      <button
        class="px-4 py-2 text-sm font-medium rounded bg-gh-accent-emphasis dark:bg-gh-accent-dark-emphasis text-white hover:bg-gh-accent-fg dark:hover:bg-gh-accent-dark-fg"
        on:click={close}
      >
        Close
      </button>
    </div>
  </div>
</div>

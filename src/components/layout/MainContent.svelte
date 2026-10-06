<script lang="ts">
  import { files } from '$lib/stores';
  import { activeOpenFile, type TimeQuery } from '$lib/stores/files';
  import { backendHas, health } from '$lib/stores/health';
  import { notifications } from '$lib/stores/notifications';
  import { timeCursor } from '$lib/stores/timeCursor';
  import { timeStash } from '$lib/stores/timeStash';
  import { STASH_ADD_LABEL, STASH_REFUSALS, stashAddRefusal } from '$lib/utils/timeStash';
  import EditorPane from '../editor/EditorPane.svelte';
  import FileBadges from '../common/FileBadges.svelte';
  import TimeCursorIndicator from './TimeCursorIndicator.svelte';
  import TimeStashRow from './TimeStashRow.svelte';
  import TimelineBar from './TimelineBar.svelte';

  let draggedIndex: number | null = null;
  let dragOverIndex: number | null = null;

  // The same rule picks the file the URL names, so the two cannot differ.
  $: activeFile = activeOpenFile($files);
  $: validActiveIndex = activeFile ? $files.openFiles.indexOf(activeFile) : 0;

  $: canJump = backendHas('samples_timestamps', $health);

  /**
   * A jump from the timeline bar or a stash entry moves the file the
   * editor shows and sets the time cursor; no other file moves.
   */
  async function jumpActiveFileToTime(query: TimeQuery) {
    if (!activeFile) return { kind: 'unsupported' } as const;
    return files.jumpToTime(activeFile.path, query);
  }

  // The stash row keeps its place while files are open on a backend that
  // can jump by time, so the editor does not move when the first moment
  // is saved or the last one removed; saved moments show in any case.
  $: isStashShown = $timeStash.length > 0 || ($files.openFiles.length > 0 && canJump);

  // Why the cursor cannot go into the stash, or null when it can.
  $: cursorRefusal = $timeCursor === null ? null : stashAddRefusal($timeStash, $timeCursor);

  /** The `+` of the time cursor: save its instant, or say why it was refused. */
  function addCursorToStash(instantMs: number) {
    const outcome = timeStash.add(instantMs);
    if (outcome !== 'added') notifications.info(STASH_REFUSALS[outcome]);
  }

  function selectTab(index: number) {
    const file = $files.openFiles[index];
    if (file) {
      files.setActiveFile(file.path);
    }
  }

  function handleClose(index: number, event: Event) {
    event.stopPropagation();
    const file = $files.openFiles[index];

    // If closing the active file, switch to an adjacent tab first
    if (index === validActiveIndex) {
      const newIndex = index > 0 ? index - 1 : index < $files.openFiles.length - 1 ? index + 1 : -1;
      if (newIndex >= 0) {
        files.setActiveFile($files.openFiles[newIndex].path);
      }
    }

    files.closeFile(file.path);
  }

  // Drag and drop handlers
  function handleDragStart(event: DragEvent, index: number) {
    draggedIndex = index;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
    }
  }

  function handleDragOver(event: DragEvent, index: number) {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    dragOverIndex = index;
  }

  function handleDragLeave() {
    dragOverIndex = null;
  }

  function handleDrop(event: DragEvent, dropIndex: number) {
    event.preventDefault();

    if (draggedIndex === null || draggedIndex === dropIndex) {
      draggedIndex = null;
      dragOverIndex = null;
      return;
    }

    // Reorder files (the activeFilePath in store stays the same,
    // so the correct tab remains active after reordering)
    files.reorderFiles(draggedIndex, dropIndex);

    draggedIndex = null;
    dragOverIndex = null;
  }

  function handleDragEnd() {
    draggedIndex = null;
    dragOverIndex = null;
  }
</script>

<main class="flex-1 flex flex-col min-w-0 bg-gh-canvas-default dark:bg-gh-canvas-dark-default">
  {#if isStashShown}
    <TimeStashRow
      stash={$timeStash}
      {activeFile}
      {canJump}
      jump={jumpActiveFileToTime}
      remove={timeStash.remove}
    />
  {/if}
  {#if $files.openFiles.length === 0}
    <!-- Empty state -->
    <div
      class="flex-1 flex items-center justify-center text-gh-fg-muted dark:text-gh-fg-dark-muted"
    >
      <div class="text-center">
        <svg
          class="w-16 h-16 mx-auto mb-4 opacity-50"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1"
        >
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
          <path d="M14 2v6h6" />
          <path d="M16 13H8M16 17H8M10 9H8" />
        </svg>
        <p class="text-lg font-medium">No files open</p>
        <p class="text-sm mt-1">Select a file from the tree to view its contents</p>
      </div>
    </div>
  {:else}
    <!-- The tab row: the tabs, with drag-to-reorder, scroll in the space
         left of the time cursor at its right edge. -->
    <div
      class="flex items-center bg-gh-canvas-subtle dark:bg-gh-canvas-dark-subtle border-b border-gh-border-default dark:border-gh-border-dark-default"
    >
      <div
        data-tab-strip
        class="flex-1 min-w-0 flex items-center gap-0.5 px-2 py-1 overflow-x-auto scrollbar-hide"
      >
        {#each $files.openFiles as file, index (file.path)}
          <button
            draggable="true"
            class="flex items-center gap-2 px-3 py-1.5 rounded-t
                 transition-colors text-sm whitespace-nowrap cursor-pointer
                 {index === validActiveIndex
              ? 'bg-gh-canvas-default dark:bg-gh-canvas-dark-default border border-b-0 border-gh-border-default dark:border-gh-border-dark-default'
              : 'bg-transparent hover:bg-gh-canvas-inset dark:hover:bg-gh-canvas-dark-inset text-gh-fg-muted dark:text-gh-fg-dark-muted'}
                 {dragOverIndex === index
              ? 'border-l-2 border-gh-accent-fg dark:border-gh-accent-dark-fg'
              : ''}"
            on:click={() => selectTab(index)}
            on:dragstart={(e) => handleDragStart(e, index)}
            on:dragover={(e) => handleDragOver(e, index)}
            on:dragleave={handleDragLeave}
            on:drop={(e) => handleDrop(e, index)}
            on:dragend={handleDragEnd}
          >
            <span class="font-medium truncate max-w-[200px]" title={file.path}>
              {file.name}
            </span>
            <FileBadges
              isCompressed={file.isCompressed}
              compressionFormat={file.compressionFormat}
              isIndexed={null}
            />
            <button
              class="p-0.5 rounded hover:bg-gh-danger-subtle dark:hover:bg-gh-danger-dark-subtle
                   hover:text-gh-danger-fg dark:hover:text-gh-danger-dark-fg
                   transition-colors"
              title="Close"
              on:click={(e) => handleClose(index, e)}
            >
              <svg
                class="w-3.5 h-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </button>
        {/each}
      </div>
      {#if $timeCursor !== null}
        <div class="shrink-0 pl-1 pr-2">
          <TimeCursorIndicator
            cursorMs={$timeCursor}
            {activeFile}
            addToStash={cursorRefusal === null ? addCursorToStash : null}
            addTitle={cursorRefusal === null ? STASH_ADD_LABEL : STASH_REFUSALS[cursorRefusal]}
            clearCursor={files.clearTimeCursor}
          />
        </div>
      {/if}
    </div>

    <TimelineBar {activeFile} {canJump} jump={jumpActiveFileToTime} cursorMs={$timeCursor} />

    <!-- The active file's editor, built again for each tab so no state of one
         tab reaches another; each tab's own state is kept in paneMemory. -->
    <div class="flex-1 min-h-0 overflow-hidden">
      {#if activeFile}
        {#key activeFile.path}
          <EditorPane file={activeFile} hideHeader={false} isActive={true} />
        {/key}
      {/if}
    </div>
  {/if}
</main>

<!--
  The tab strip: a tab per open file or log chain, in the order the user
  arranged them by dragging, as a WAI-ARIA tab list that shows a tab as
  soon as the keyboard reaches it. The strip is one Tab stop, the active
  tab; with a tab focused, ← and → show the tab beside it (round the
  ends), Home and End the first and the last, and Delete closes it. Each
  tab's close button stands beside the tab, out of the Tab order and
  hidden from screen readers, which close a tab with Delete.
-->
<script context="module" lang="ts">
  /** The id of the tab at `index` of the strip, which the panel it controls is labelled by. */
  export function tabElementId(index: number): string {
    return `rx-tab-${index}`;
  }
</script>

<script lang="ts">
  import { tick } from 'svelte';
  import { tooltip } from '$lib/actions/tooltip';
  import { files } from '$lib/stores';
  import { activeOpenFile } from '$lib/stores/files';
  import { modalOpen } from '$lib/stores/layout';
  import { chainTopLines } from '$lib/stores/chainTopLines';
  import { chainTabCaption } from '$lib/utils/chainPane';
  import { isShortcut, type TabStripShortcutId } from '$lib/utils/shortcuts';
  import type { TabKey } from '$lib/utils/tabKey';
  import { tabBeside } from '$lib/utils/tabOrder';
  import FileBadges from '../common/FileBadges.svelte';

  /** The id of the element that shows the active tab, which every tab controls. */
  export let panelId: string;

  /** The tab each key goes to from the focused tab `key`, of the tabs `keys` in strip order. */
  const MOVES: readonly {
    id: TabStripShortcutId;
    key: string;
    target: (keys: readonly TabKey[], key: TabKey) => TabKey | null;
  }[] = [
    { id: 'tabStripMove', key: 'ArrowRight', target: (keys, key) => tabBeside(keys, key, 1) },
    { id: 'tabStripMove', key: 'ArrowLeft', target: (keys, key) => tabBeside(keys, key, -1) },
    { id: 'tabStripEnds', key: 'Home', target: (keys) => keys[0] ?? null },
    { id: 'tabStripEnds', key: 'End', target: (keys) => keys.at(-1) ?? null },
  ];

  const ACTIVE_CLASS =
    'bg-gh-canvas-default dark:bg-gh-canvas-dark-default border border-b-0 ' +
    'border-gh-border-default dark:border-gh-border-dark-default';
  const IDLE_CLASS =
    'bg-transparent hover:bg-gh-canvas-inset dark:hover:bg-gh-canvas-dark-inset ' +
    'text-gh-fg-muted dark:text-gh-fg-dark-muted';
  const DROP_CLASS = 'border-l-2 border-gh-accent-fg dark:border-gh-accent-dark-fg';
  const FOCUS_CLASS =
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-inset ' +
    'focus-visible:ring-gh-accent-emphasis dark:focus-visible:ring-gh-accent-dark-emphasis';

  let strip: HTMLElement;
  let draggedIndex: number | null = null;
  let dragOverIndex: number | null = null;

  // The same rule picks the tab the URL names, so the two cannot differ.
  $: activeKey = activeOpenFile($files)?.path ?? null;
  $: keys = $files.openFiles.map((f) => f.path);

  // A tab shown from elsewhere (a key, a link, a search result) is
  // scrolled into the strip's view.
  $: void revealActiveTab(activeKey);

  /** The element of the active tab, once the strip shows the latest change. */
  async function activeTab(): Promise<HTMLElement | null> {
    await tick();
    return strip?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]') ?? null;
  }

  async function revealActiveTab(_key: TabKey | null) {
    (await activeTab())?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }

  async function focusActiveTab() {
    (await activeTab())?.focus();
  }

  /** The keys of the focused tab `key`: the moves and Delete. */
  function handleKeydown(event: KeyboardEvent, key: TabKey) {
    if ($modalOpen) return;
    if (isShortcut('tabStripClose', event)) {
      event.preventDefault();
      files.closeFile(key);
      void focusActiveTab();
      return;
    }
    const move = MOVES.find((m) => m.key === event.key && isShortcut(m.id, event));
    const target = move?.target(keys, key) ?? null;
    if (target === null) return;
    event.preventDefault();
    files.setActiveFile(target);
    void focusActiveTab();
  }

  function handleDragStart(event: DragEvent, index: number) {
    draggedIndex = index;
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  function handleDragOver(event: DragEvent, index: number) {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    dragOverIndex = index;
  }

  // The store keeps the active tab by its key, so it stays active when it moves.
  function handleDrop(event: DragEvent, dropIndex: number) {
    event.preventDefault();
    if (draggedIndex !== null && draggedIndex !== dropIndex) {
      files.reorderFiles(draggedIndex, dropIndex);
    }
    endDrag();
  }

  function endDrag() {
    draggedIndex = null;
    dragOverIndex = null;
  }
</script>

<div
  bind:this={strip}
  role="tablist"
  aria-label="Open files"
  data-tab-strip
  class="flex-1 min-w-0 flex items-center gap-0.5 px-2 py-1 overflow-x-auto scrollbar-hide"
>
  <!-- Each tab by its key: a chain and the file at its handle are two tabs. -->
  {#each $files.openFiles as file, index (file.path)}
    {@const isActive = file.path === activeKey}
    <div
      role="presentation"
      class="flex items-center rounded-t transition-colors text-sm whitespace-nowrap
             {isActive ? ACTIVE_CLASS : IDLE_CLASS} {dragOverIndex === index ? DROP_CLASS : ''}"
    >
      <button
        type="button"
        role="tab"
        id={tabElementId(index)}
        aria-selected={isActive}
        aria-controls={panelId}
        tabindex={isActive ? 0 : -1}
        draggable="true"
        class="flex items-center gap-2 pl-3 pr-1.5 py-1.5 rounded-t cursor-pointer {FOCUS_CLASS}"
        on:click={() => files.setActiveFile(file.path)}
        on:keydown={(e) => handleKeydown(e, file.path)}
        on:dragstart={(e) => handleDragStart(e, index)}
        on:dragover={(e) => handleDragOver(e, index)}
        on:dragleave={() => (dragOverIndex = null)}
        on:drop={(e) => handleDrop(e, index)}
        on:dragend={endDrag}
      >
        {#if file.chain}
          <!-- A chain's caption names the part of its top line: syslog [3/12]. -->
          {@const shown = chainTabCaption(
            file.name,
            file.chain,
            $chainTopLines.get(file.path) ?? null,
          )}
          <span class="font-medium truncate max-w-[240px]" title={shown.title}>
            {shown.caption}
          </span>
        {:else}
          <span class="font-medium truncate max-w-[200px]" title={file.path}>
            {file.name}
          </span>
        {/if}
        <FileBadges
          isCompressed={file.isCompressed}
          compressionFormat={file.compressionFormat}
          isIndexed={null}
          indexBuild={file.backgroundIndexBuild}
        />
      </button>
      <!-- Out of the Tab order and hidden from screen readers: Delete on
           the tab closes it. A press leaves the focus where it was. -->
      <button
        type="button"
        tabindex="-1"
        aria-hidden="true"
        class="mr-2 p-0.5 rounded hover:bg-gh-danger-subtle dark:hover:bg-gh-danger-dark-subtle
               hover:text-gh-danger-fg dark:hover:text-gh-danger-dark-fg transition-colors"
        use:tooltip={{ label: 'Close', shortcut: 'closeTab' }}
        on:mousedown|preventDefault
        on:click={() => files.closeFile(file.path)}
        on:dragover={(e) => handleDragOver(e, index)}
        on:drop={(e) => handleDrop(e, index)}
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
    </div>
  {/each}
</div>

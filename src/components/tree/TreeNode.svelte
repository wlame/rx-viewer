<script lang="ts">
  import type { TreeNode as TreeNodeType } from '$lib/types';
  import { tree, notifications } from '$lib/stores';
  import { indexFile, treeMenuItems, type TreeMenuAction } from '$lib/indexTasks';
  import { openTreeFile } from '$lib/fileOpening';
  import { formatSize } from '$lib/utils/format';
  import { isShortcut } from '$lib/utils/shortcuts';
  import FileIcon from './FileIcon.svelte';
  import Spinner from '../common/Spinner.svelte';
  import FileBadges from '../common/FileBadges.svelte';
  import AnalyzeDialog from './AnalyzeDialog.svelte';

  export let node: TreeNodeType;

  $: isSelected = $tree.selectedPath === node.path;
  $: indentPx = node.level * 16;

  let showContextMenu = false;
  let contextMenuX = 0;
  let contextMenuY = 0;

  let showAnalyzePopup = false;

  function handleClick() {
    if (node.type === 'directory') {
      tree.toggleExpanded(node.path);
    } else {
      tree.selectPath(node.path);
      openTreeFile(node);
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (isShortcut('openTreeItem', event)) {
      event.preventDefault();
      handleClick();
    }
  }

  $: menuItems = treeMenuItems(node);

  /** A row with no action of its own keeps the browser's own menu. */
  function handleContextMenu(event: MouseEvent) {
    if (menuItems.length === 0) return;
    event.preventDefault();
    contextMenuX = event.clientX;
    contextMenuY = event.clientY;
    showContextMenu = true;
  }

  function closeContextMenu() {
    showContextMenu = false;
  }

  function handleAnalyze() {
    closeContextMenu();
    showAnalyzePopup = true;
  }

  async function handleIndex(reindex: boolean) {
    closeContextMenu();
    notifications.info(`Indexing ${node.name}...`, 3000);
    try {
      await indexFile(node.path, { reindex });
      notifications.success(`Index ready for ${node.name}`, 3000);
    } catch (e) {
      const error = e instanceof Error ? e.message : 'Indexing failed';
      notifications.error(error, 5000);
    }
  }

  /** What each context-menu item does. */
  const MENU_HANDLERS: Record<TreeMenuAction, () => void> = {
    analyze: handleAnalyze,
    index: () => handleIndex(false),
    reindex: () => handleIndex(true),
  };
</script>

<div class="select-none">
  <div
    role="treeitem"
    tabindex="0"
    aria-expanded={node.type === 'directory' ? node.expanded : undefined}
    aria-selected={isSelected}
    class="flex items-center gap-1 px-2 py-0.5 cursor-pointer text-sm
           hover:bg-gh-canvas-subtle dark:hover:bg-gh-canvas-dark-subtle
           {isSelected ? 'bg-gh-accent-muted dark:bg-gh-accent-dark-muted' : ''}"
    style="padding-left: {indentPx + 8}px"
    on:click={handleClick}
    on:keydown={handleKeydown}
    on:contextmenu={handleContextMenu}
  >
    <!-- Expand/collapse chevron for directories -->
    {#if node.type === 'directory'}
      <span class="w-4 h-4 flex items-center justify-center flex-shrink-0">
        {#if node.loading}
          <Spinner size="sm" />
        {:else}
          <svg
            class="w-3 h-3 text-gh-fg-muted dark:text-gh-fg-dark-muted transition-transform
                   {node.expanded ? 'rotate-90' : ''}"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M9 18l6-6-6-6" />
          </svg>
        {/if}
      </span>
    {:else}
      <span class="w-4 h-4 flex-shrink-0" />
    {/if}

    <!-- File/folder icon -->
    <FileIcon {node} />

    <!-- Name -->
    <span
      class="truncate flex-1 {node.type === 'directory'
        ? 'font-medium'
        : node.is_text === false
          ? 'opacity-50'
          : ''}"
    >
      {node.name}
    </span>

    <!-- Badges for files -->
    {#if node.type === 'file'}
      <span class="flex items-center gap-1 flex-shrink-0">
        <FileBadges
          isCompressed={node.is_compressed}
          compressionFormat={node.compression_format}
          isIndexed={node.is_indexed}
        />
        {#if node.size !== null}
          <span class="text-xs text-gh-fg-subtle dark:text-gh-fg-dark-subtle ml-1">
            {formatSize(node.size)}
          </span>
        {/if}
      </span>
    {:else if node.children_count !== null}
      <span class="text-xs text-gh-fg-subtle dark:text-gh-fg-dark-subtle">
        {node.children_count}
      </span>
    {/if}
  </div>

  <!-- Children -->
  {#if node.type === 'directory' && node.expanded && node.children.length > 0}
    <div role="group">
      {#each node.children as child (child.path)}
        <svelte:self node={child} />
      {/each}
    </div>
  {/if}
</div>

<!-- Context Menu -->
{#if showContextMenu}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div
    class="fixed inset-0 z-40"
    on:click={closeContextMenu}
    on:contextmenu|preventDefault={closeContextMenu}
  />
  <div
    class="fixed z-50 bg-gh-canvas-default dark:bg-gh-canvas-dark-subtle border border-gh-border-default dark:border-gh-border-dark-default rounded-lg shadow-xl py-1 min-w-40"
    style="left: {contextMenuX}px; top: {contextMenuY}px;"
  >
    {#each menuItems as item (item.action)}
      <button
        class="w-full text-left px-3 py-2 text-sm text-gh-fg-default dark:text-gh-fg-dark-default hover:bg-gh-canvas-subtle dark:hover:bg-gh-canvas-dark-inset"
        on:click={MENU_HANDLERS[item.action]}
      >
        {item.label}
      </button>
    {/each}
  </div>
{/if}

{#if showAnalyzePopup}
  <AnalyzeDialog path={node.path} name={node.name} on:close={() => (showAnalyzePopup = false)} />
{/if}

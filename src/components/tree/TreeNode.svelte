<script lang="ts">
  import type { TreeNode as TreeNodeType } from '$lib/types';
  import { tree, notifications } from '$lib/stores';
  import { chainModeOn } from '$lib/stores/chainMode';
  import { indexFile, treeMenuItems, type TreeMenuAction } from '$lib/indexTasks';
  import { openTreeFile } from '$lib/fileOpening';
  import { isChainRow, rowKey, shownChildren } from '$lib/utils/chainTree';
  import { formatCount, formatSize } from '$lib/utils/format';
  import { isShortcut } from '$lib/utils/shortcuts';
  import type { ValueColumn } from '$lib/utils/urlState';
  import FileIcon from './FileIcon.svelte';
  import Spinner from '../common/Spinner.svelte';
  import FileBadges from '../common/FileBadges.svelte';
  import AnalyzeDialog from './AnalyzeDialog.svelte';
  import ChainTreeNode from './ChainTreeNode.svelte';
  import TreeContextMenu from './TreeContextMenu.svelte';
  import ValueCell from './ValueCell.svelte';

  export let node: TreeNodeType;
  /** Whether the row shows its labels (compression, `idx`); its value and name stay either way. */
  export let showLabels = true;
  /** The value the row shows right of its name. */
  export let show: ValueColumn = 'size';

  // In chain mode a folder shows one row per log chain in place of its
  // parts; the node keeps every entry, so the mode changes no state.
  $: rows = node.type === 'directory' ? shownChildren(node, { chainModeOn: $chainModeOn }) : [];

  $: isSelected = $tree.selectedPath === node.path;
  $: indentPx = node.level * 16;
  $: sizeText = node.type === 'directory' ? itemCount(node) : fileSize(node);

  /**
   * A folder's size column: how many entries it holds. A count the
   * listing leaves out shows nothing, rather than failing the tree.
   */
  function itemCount(folder: TreeNodeType): string {
    const count = folder.children_count;
    return typeof count === 'number' ? formatCount(count, 'item') : '';
  }

  /** A file's size column; a size the listing leaves out shows nothing. */
  function fileSize(file: TreeNodeType): string {
    return typeof file.size === 'number' ? formatSize(file.size) : '';
  }

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

    <!-- Labels of a file -->
    {#if showLabels && node.type === 'file'}
      <FileBadges
        isCompressed={node.is_compressed}
        compressionFormat={node.compression_format}
        isIndexed={node.is_indexed}
      />
    {/if}

    <ValueCell {show} size={sizeText} modifiedAt={node.modified_at} />
  </div>

  <!-- Children -->
  {#if node.type === 'directory' && node.expanded && rows.length > 0}
    <div role="group">
      {#each rows as child (rowKey(child))}
        {#if isChainRow(child)}
          <ChainTreeNode row={child} {showLabels} {show} />
        {:else}
          <svelte:self node={child} {showLabels} {show} />
        {/if}
      {/each}
    </div>
  {/if}
</div>

{#if showContextMenu}
  <TreeContextMenu
    items={menuItems}
    x={contextMenuX}
    y={contextMenuY}
    on:choose={(e) => MENU_HANDLERS[e.detail]()}
    on:close={closeContextMenu}
  />
{/if}

{#if showAnalyzePopup}
  <AnalyzeDialog path={node.path} name={node.name} on:close={() => (showAnalyzePopup = false)} />
{/if}

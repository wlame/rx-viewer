<script lang="ts">
  import type { TreeNode as TreeNodeType } from '$lib/types';
  import { tree, notifications } from '$lib/stores';
  import { chainModeOn } from '$lib/stores/chainMode';
  import { indexFile, treeMenuItems, type TreeMenuAction } from '$lib/indexTasks';
  import { openTreeRow } from '$lib/fileOpening';
  import { openAnalysis } from '$lib/stores/analysisDialog';
  import { treeTabStop } from '$lib/stores/treeFocus';
  import { isChainRow, rowKey, shownChildren } from '$lib/utils/chainTree';
  import { formatCount, formatSize } from '$lib/utils/format';
  import { memoizeLast } from '$lib/utils/memoizeLast';
  import { DEFAULT_SORT, type TreeSort } from '$lib/utils/treeSort';
  import type { ValueColumn } from '$lib/utils/urlState';
  import FileIcon from './FileIcon.svelte';
  import Spinner from '../common/Spinner.svelte';
  import FileBadges from '../common/FileBadges.svelte';
  import ChainTreeNode from './ChainTreeNode.svelte';
  import TreeContextMenu from './TreeContextMenu.svelte';
  import { TREE_ROW_FOCUS_CLASS } from './treeRowStyle';
  import ValueCell from './ValueCell.svelte';

  export let node: TreeNodeType;
  /** How many rows share the row's folder, and the row's place among them (from 1). */
  export let setSize = 1;
  export let posInSet = 1;
  /** Whether the row shows its labels (compression, `idx`); its value and name stay either way. */
  export let showLabels = true;
  /** The value the row shows right of its name. */
  export let show: ValueColumn = 'size';
  /** The order of a folder's rows. */
  export let sort: TreeSort = DEFAULT_SORT;

  /**
   * A folder's rows, sorted again only when the folder, the mode or the
   * order changes: the tree store keeps a node it did not change, and
   * Svelte hands it down again at every update (a click that selects a
   * row), so a large folder is not sorted on each of them.
   */
  const rowsOf = memoizeLast((folder: TreeNodeType, chainModeOn: boolean, order: TreeSort) =>
    shownChildren(folder, { chainModeOn, sort: order }),
  );

  // In chain mode a folder shows one row per log chain in place of its
  // parts; the node keeps every entry, so the mode changes no state.
  $: rows = node.type === 'directory' ? rowsOf(node, $chainModeOn, sort) : [];

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

  // The keys of the row are the tree's (FileTree.svelte), which reach
  // the same actions as a click.
  function handleClick() {
    if (node.type === 'directory') tree.toggleExpanded(node.path);
    else openTreeRow(node.path);
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

  /** The app draws the dialog, so it stays on screen whatever the panel or the row does. */
  function handleAnalyze() {
    closeContextMenu();
    openAnalysis({ path: node.path, name: node.name });
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
  <!-- The tree's key handler (FileTree.svelte) answers the keys of every row. -->
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <div
    role="treeitem"
    tabindex={node.path === $treeTabStop ? 0 : -1}
    data-row-id={node.path}
    aria-level={node.level + 1}
    aria-setsize={setSize}
    aria-posinset={posInSet}
    aria-expanded={node.type === 'directory' ? node.expanded : undefined}
    aria-selected={isSelected}
    class="flex items-center gap-1 px-2 py-0.5 cursor-pointer text-sm {TREE_ROW_FOCUS_CLASS}
           hover:bg-gh-canvas-subtle dark:hover:bg-gh-canvas-dark-subtle
           {isSelected ? 'bg-gh-accent-muted dark:bg-gh-accent-dark-muted' : ''}"
    style="padding-left: {indentPx + 8}px"
    on:click={handleClick}
    on:contextmenu={handleContextMenu}
  >
    <!-- Expand/collapse chevron for directories -->
    {#if node.type === 'directory'}
      <span class="w-4 h-4 flex items-center justify-center flex-shrink-0" aria-hidden="true">
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
      <span class="w-4 h-4 flex-shrink-0" aria-hidden="true" />
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
      {#each rows as child, index (rowKey(child))}
        {#if isChainRow(child)}
          <ChainTreeNode
            row={child}
            setSize={rows.length}
            posInSet={index + 1}
            {showLabels}
            {show}
          />
        {:else}
          <svelte:self
            node={child}
            setSize={rows.length}
            posInSet={index + 1}
            {showLabels}
            {show}
            {sort}
          />
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

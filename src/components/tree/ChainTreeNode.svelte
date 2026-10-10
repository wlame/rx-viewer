<script lang="ts">
  /**
   * A log chain's row in the files panel, in place of its parts: its
   * name, its marks (`chain · N`, `idx`, missing and unreadable parts,
   * too many parts, and `invalid` once a description said so) unless the
   * labels are off, and its value: its size, or the newest time of its
   * parts. A click or Enter opens the chain's tab; the context menu
   * indexes its parts. The parts are not listed: they are reached by
   * turning chain mode off, or from the parts list of the chain's tab.
   */
  import { notifications, tree } from '$lib/stores';
  import { openTreeRow } from '$lib/fileOpening';
  import { chainMenuItems, indexChain, type TreeMenuAction } from '$lib/indexTasks';
  import { treeTabStop } from '$lib/stores/treeFocus';
  import { chainBadges, type ChainBadgeTone, type ChainRow } from '$lib/utils/chainTree';
  import { formatSize } from '$lib/utils/format';
  import type { ValueColumn } from '$lib/utils/urlState';
  import TreeContextMenu from './TreeContextMenu.svelte';
  import { TREE_ROW_FOCUS_CLASS } from './treeRowStyle';
  import ValueCell from './ValueCell.svelte';

  export let row: ChainRow;
  /** How many rows share the chain's folder, and the row's place among them (from 1). */
  export let setSize = 1;
  export let posInSet = 1;
  /** Whether the row shows its marks; its name and value stay either way. */
  export let showLabels = true;
  /** The value the row shows right of its name. */
  export let show: ValueColumn = 'size';

  /** How each tone of mark looks. */
  const TONE_CLASSES: Record<ChainBadgeTone, string> = {
    neutral:
      'border border-gh-border-default dark:border-gh-border-dark-default text-gh-fg-muted dark:text-gh-fg-dark-muted',
    success: 'badge-success',
    warning: 'badge-warning',
    danger:
      'bg-gh-danger-emphasis/10 text-gh-danger-fg dark:bg-gh-danger-dark-emphasis/20 dark:text-gh-danger-dark-fg',
  };

  /** How long the notices of an index stay on screen. */
  const NOTICE_MS = 3000;
  const ERROR_NOTICE_MS = 5000;

  $: chain = row.chain;
  $: isSelected = $tree.selectedPath === row.key;
  $: indentPx = row.level * 16;
  $: badges = chainBadges(chain, $tree.describedChains.get(chain.path) ?? null);
  $: menuItems = chainMenuItems(chain);
  // A chain of too many parts is not read as one text; its sum is not shown.
  $: sizeText = chain.too_many_parts ? '' : formatSize(chain.size);

  let showContextMenu = false;
  let contextMenuX = 0;
  let contextMenuY = 0;

  // The keys of the row are the tree's (FileTree.svelte), which open the
  // chain's tab the same way.
  function open() {
    openTreeRow(row.key);
  }

  /** A chain with no action of its own keeps the browser's own menu. */
  function handleContextMenu(event: MouseEvent) {
    if (menuItems.length === 0) return;
    event.preventDefault();
    contextMenuX = event.clientX;
    contextMenuY = event.clientY;
    showContextMenu = true;
  }

  async function handleIndex(reindex: boolean) {
    showContextMenu = false;
    const name = chain.name;
    notifications.info(`Indexing the parts of ${name}...`, NOTICE_MS);
    try {
      const outcome = await indexChain(chain.path, { reindex });
      notifications.success(
        outcome.kind === 'completed'
          ? `Index ready for ${name}`
          : `The index task of ${name} has ended`,
        NOTICE_MS,
      );
    } catch (e) {
      notifications.error(e instanceof Error ? e.message : 'Indexing failed', ERROR_NOTICE_MS);
    }
  }

  /** What each context-menu item of a chain does. */
  const MENU_HANDLERS: Partial<Record<TreeMenuAction, () => void>> = {
    index: () => handleIndex(false),
    reindex: () => handleIndex(true),
  };
</script>

<div class="select-none">
  <!-- The tree's key handler (FileTree.svelte) answers the keys of every row. -->
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <div
    role="treeitem"
    tabindex={row.key === $treeTabStop ? 0 : -1}
    data-row-id={row.key}
    aria-level={row.level + 1}
    aria-setsize={setSize}
    aria-posinset={posInSet}
    aria-selected={isSelected}
    data-chain={chain.name}
    class="flex items-center gap-1 px-2 py-0.5 cursor-pointer text-sm {TREE_ROW_FOCUS_CLASS}
           hover:bg-gh-canvas-subtle dark:hover:bg-gh-canvas-dark-subtle
           {isSelected ? 'bg-gh-accent-muted dark:bg-gh-accent-dark-muted' : ''}"
    style="padding-left: {indentPx + 8}px"
    on:click={open}
    on:contextmenu={handleContextMenu}
  >
    <span class="w-4 h-4 flex-shrink-0" aria-hidden="true" />

    <!-- Stacked pages: several files read as one -->
    <svg
      class="w-4 h-4 flex-shrink-0 text-yellow-600 dark:text-yellow-400"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      aria-hidden="true"
    >
      <path d="M8 2h8l4 4v12a2 2 0 01-2 2H8a2 2 0 01-2-2V4a2 2 0 012-2z" />
      <path d="M4 6v14a2 2 0 002 2h10" />
    </svg>

    <!-- The value keeps its column. Left of it, the name keeps at least
         40% of the room; the marks give way first, clipped. The path is
         the name's tooltip, not the row's, so it does not cover the
         time's. -->
    <span class="flex-1 min-w-0 flex items-center gap-1">
      <span class="truncate flex-1 min-w-[40%]" title={chain.path}>{chain.name}</span>
      {#if showLabels}
        <span class="flex items-center gap-1 min-w-0 overflow-hidden">
          {#each badges as badge (badge.text)}
            <span
              data-chain-badge
              class="badge text-[10px] py-0 flex-shrink-0 {TONE_CLASSES[badge.tone]}"
              title={badge.title}
            >
              {badge.text}
            </span>
          {/each}
        </span>
      {/if}
    </span>

    <ValueCell {show} size={sizeText} modifiedAt={row.modifiedAt} />
  </div>
</div>

{#if showContextMenu}
  <TreeContextMenu
    items={menuItems}
    x={contextMenuX}
    y={contextMenuY}
    on:choose={(e) => MENU_HANDLERS[e.detail]?.()}
    on:close={() => (showContextMenu = false)}
  />
{/if}

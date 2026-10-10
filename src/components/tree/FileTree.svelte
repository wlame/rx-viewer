<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { tree } from '$lib/stores';
  import { filesView } from '$lib/stores/filesView';
  import { treeFocusRequested } from '$lib/stores/layout';
  import FilesToolbar from './FilesToolbar.svelte';
  import TreeHeader from './TreeHeader.svelte';
  import TreeNode from './TreeNode.svelte';
  import Spinner from '../common/Spinner.svelte';

  /** The row that takes the focus first: the selected one. */
  const SELECTED_ROW = '[role="treeitem"][aria-selected="true"]';
  const ANY_ROW = '[role="treeitem"]';

  let treeElement: HTMLElement | null = null;

  // A panel key asks for the tree's focus, possibly while the roots load;
  // the request waits for them.
  $: if ($treeFocusRequested && treeElement && !$tree.loading) void focusCurrentRow();

  /**
   * Focus the selected row, else the first row; with no row, the focus
   * stays where it is. The rows, and the panel just shown around them,
   * are drawn in the update after this one.
   */
  async function focusCurrentRow() {
    treeFocusRequested.set(false);
    await tick();
    const row =
      treeElement?.querySelector<HTMLElement>(SELECTED_ROW) ??
      treeElement?.querySelector<HTMLElement>(ANY_ROW);
    row?.focus();
  }

  // The tree stays mounted while the Search panel is shown, and a link
  // may have loaded the roots already; either way the expanded folders stay.
  onMount(() => {
    tree.ensureRoots();
  });
</script>

<div class="h-full flex flex-col">
  <FilesToolbar />
  <TreeHeader />

  <div class="flex-1 overflow-auto scrollbar-thin py-1" role="tree" bind:this={treeElement}>
    {#if $tree.loading}
      <div class="flex items-center justify-center py-8">
        <Spinner size="md" />
      </div>
    {:else if $tree.error}
      <div class="px-3 py-4 text-sm text-gh-danger-fg dark:text-gh-danger-dark-fg">
        <p class="font-medium">Failed to load</p>
        <p class="text-xs mt-1 opacity-75">{$tree.error}</p>
        <button
          class="mt-2 text-xs text-gh-accent-fg dark:text-gh-accent-dark-fg hover:underline"
          on:click={() => tree.loadRoots()}
        >
          Retry
        </button>
      </div>
    {:else if $tree.roots.length === 0}
      <div class="px-3 py-4 text-sm text-gh-fg-muted dark:text-gh-fg-dark-muted">
        No search roots configured
      </div>
    {:else}
      <!-- The search roots keep their configured order; the rows under them are sorted. -->
      {#each $tree.roots as node (node.path)}
        <TreeNode
          {node}
          showLabels={$filesView.labels}
          show={$filesView.show}
          sort={$filesView.sort}
        />
      {/each}
    {/if}
  </div>
</div>

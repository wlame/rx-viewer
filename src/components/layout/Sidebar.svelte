<script lang="ts">
  import type { ComponentType } from 'svelte';
  import { settings } from '$lib/stores';
  import { sidebarTab, sidebarVisible, type SidebarTab } from '$lib/stores/layout';
  import { PANELS } from '$lib/utils/panels';
  import FileTree from '../tree/FileTree.svelte';
  import SearchPanel from '../search/SearchPanel.svelte';

  export let width: number;

  /** The view of each panel the activity bar switches between. */
  const PANEL_VIEWS: Readonly<Record<SidebarTab, ComponentType>> = {
    tree: FileTree,
    search: SearchPanel,
  };

  let isResizing = false;
  let startX = 0;
  let startWidth = 0;

  function handleMouseDown(event: MouseEvent) {
    isResizing = true;
    startX = event.clientX;
    startWidth = width;
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }

  function handleMouseMove(event: MouseEvent) {
    if (!isResizing) return;
    const delta = event.clientX - startX;
    const newWidth = Math.max(200, Math.min(600, startWidth + delta));
    settings.update((s) => ({ ...s, sidebarWidth: newWidth }));
  }

  function handleMouseUp() {
    isResizing = false;
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }
</script>

<aside
  class="flex-shrink-0 flex flex-col
         bg-gh-canvas-default dark:bg-gh-canvas-dark-default
         border-r border-gh-border-default dark:border-gh-border-dark-default
         relative"
  style="width: {width}px"
  style:display={$sidebarVisible ? null : 'none'}
>
  <!-- Every panel stays mounted and the one not shown is hidden, so the
       tree keeps its expanded folders and an open Analyze dialog, and
       the search form its unsent patterns and options. -->
  <div class="flex-1 overflow-hidden">
    {#each PANELS as panel (panel.id)}
      <div class="h-full" hidden={$sidebarTab !== panel.id}>
        <svelte:component this={PANEL_VIEWS[panel.id]} />
      </div>
    {/each}
  </div>

  <!-- Resize handle -->
  <button
    type="button"
    aria-label="Resize sidebar"
    class="absolute top-0 right-0 w-1 h-full cursor-col-resize border-0 p-0 bg-transparent
           hover:bg-gh-accent-emphasis dark:hover:bg-gh-accent-dark-emphasis
           {isResizing ? 'bg-gh-accent-emphasis dark:bg-gh-accent-dark-emphasis' : ''}"
    on:mousedown={handleMouseDown}
  />
</aside>

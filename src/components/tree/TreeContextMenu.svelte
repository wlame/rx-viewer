<script lang="ts">
  /**
   * The context menu of a row of the files panel: its items at the
   * pointer, closed by a click anywhere else. It says which item was
   * chosen (`choose`) and when it should close (`close`); the row acts.
   */
  import { createEventDispatcher } from 'svelte';
  import type { TreeMenuAction, TreeMenuItem } from '$lib/indexTasks';

  export let items: readonly TreeMenuItem[];
  export let x: number;
  export let y: number;

  const dispatch = createEventDispatcher<{ choose: TreeMenuAction; close: null }>();
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div
  class="fixed inset-0 z-40"
  on:click={() => dispatch('close')}
  on:contextmenu|preventDefault={() => dispatch('close')}
/>
<div
  role="menu"
  class="fixed z-50 bg-gh-canvas-default dark:bg-gh-canvas-dark-subtle border border-gh-border-default dark:border-gh-border-dark-default rounded-lg shadow-xl py-1 min-w-40"
  style="left: {x}px; top: {y}px;"
>
  {#each items as item (item.action)}
    <button
      role="menuitem"
      class="w-full text-left px-3 py-2 text-sm text-gh-fg-default dark:text-gh-fg-dark-default hover:bg-gh-canvas-subtle dark:hover:bg-gh-canvas-dark-inset"
      on:click={() => dispatch('choose', item.action)}
    >
      {item.label}
    </button>
  {/each}
</div>

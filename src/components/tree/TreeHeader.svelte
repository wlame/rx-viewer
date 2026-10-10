<!--
  The files panel's column header, under its toolbar and outside the
  tree: Name on the left, the value shown (Size or Date) on the right. A
  click sorts the rows by that column in its first direction, and again
  reverses the sort; the sorted column draws an arrow of its direction.
  Alt+N and Alt+S do the same from anywhere while the panel is shown and
  no dialog is open; at any other time the key is left alone.
-->
<script context="module" lang="ts">
  /**
   * The scrollbar gutter the tree's scroll box keeps, which the header
   * keeps as well: a scrollbar that takes room narrows both by the same
   * width, so each value stays under its column's name. An overlay
   * scrollbar takes no room, and neither does its gutter.
   */
  export const COLUMN_GUTTER_CLASS = 'scrollbar-thin [scrollbar-gutter:stable]';
</script>

<script lang="ts">
  import { tooltip } from '$lib/actions/tooltip';
  import { filesPanelShown, filesView, sortFilesBy } from '$lib/stores/filesView';
  import { modalOpen } from '$lib/stores/layout';
  import type { IconName } from '$lib/utils/icons';
  import { handleFilesPanelKey, type FilesPanelShortcutActions } from '$lib/utils/shortcuts';
  import type { SortDir, SortKey, TreeSort } from '$lib/utils/treeSort';
  import Icon from '../common/Icon.svelte';

  /** Each column's name as the header shows it. */
  const COLUMN_NAMES: Readonly<Record<SortKey, string>> = {
    name: 'Name',
    size: 'Size',
    date: 'Date',
  };
  const DIR_WORDS: Readonly<Record<SortDir, string>> = { asc: 'ascending', desc: 'descending' };
  const DIR_ARROWS: Readonly<Record<SortDir, IconName>> = { asc: 'arrow-up', desc: 'arrow-down' };
  const ARROW_PX = 12;

  // An outline outside the button, as on the toolbar's controls.
  const BUTTON_CLASS =
    'flex items-center gap-0.5 px-1 rounded font-medium transition-colors ' +
    'hover:text-gh-fg-default dark:hover:text-gh-fg-dark-default ' +
    'focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 ' +
    'focus-visible:outline-gh-accent-emphasis dark:focus-visible:outline-gh-accent-dark-emphasis';
  const SORTED_CLASS = 'text-gh-fg-default dark:text-gh-fg-dark-default';

  /** What sorting by `key` is called: `Sort by size`. */
  function actionOf(key: SortKey): string {
    return `Sort by ${COLUMN_NAMES[key].toLowerCase()}`;
  }

  /** A column button's name: the action, and the direction on the sorted column. */
  function labelOf(key: SortKey, sort: TreeSort): string {
    return sort.key === key ? `${actionOf(key)}, ${DIR_WORDS[sort.dir]}` : actionOf(key);
  }

  function sortBy(key: SortKey): boolean {
    sortFilesBy(key);
    return true;
  }

  const actions: FilesPanelShortcutActions = {
    sortByName: () => sortBy('name'),
    sortByValue: () => sortBy($filesView.show),
  };

  // The panel's keys are its own only while it is on screen and no
  // dialog owns the keyboard.
  function handleWindowKeydown(event: KeyboardEvent) {
    if (!$filesPanelShown || $modalOpen) return;
    handleFilesPanelKey(event, actions);
  }

  $: sort = $filesView.sort;
  $: value = $filesView.show;
</script>

<svelte:window on:keydown={handleWindowKeydown} />

<!-- The gutter needs a box that clips; py-1 leaves room for the focus outline inside it. -->
<div
  class="flex items-center justify-between px-2 py-1 overflow-hidden {COLUMN_GUTTER_CLASS}
         text-xs text-gh-fg-muted dark:text-gh-fg-dark-muted
         border-b border-gh-border-default dark:border-gh-border-dark-default"
>
  <!-- The names and the values keep their columns' edges: -mx-1 takes back the padding. -->
  <button
    type="button"
    class="-ml-1 {BUTTON_CLASS} {sort.key === 'name' ? SORTED_CLASS : ''}"
    aria-label={labelOf('name', sort)}
    use:tooltip={{ label: actionOf('name'), shortcut: 'sortByName' }}
    on:click={() => sortBy('name')}
  >
    {COLUMN_NAMES.name}
    {#if sort.key === 'name'}
      <Icon name={DIR_ARROWS[sort.dir]} size={ARROW_PX} />
    {/if}
  </button>
  <button
    type="button"
    class="-mr-1 w-[calc(11ch+0.5rem)] justify-end {BUTTON_CLASS} {sort.key === value
      ? SORTED_CLASS
      : ''}"
    aria-label={labelOf(value, sort)}
    use:tooltip={{ label: actionOf(value), shortcut: 'sortByValue' }}
    on:click={() => sortBy(value)}
  >
    {#if sort.key === value}
      <Icon name={DIR_ARROWS[sort.dir]} size={ARROW_PX} />
    {/if}
    {COLUMN_NAMES[value]}
  </button>
</div>

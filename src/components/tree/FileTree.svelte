<script lang="ts">
  /**
   * The files panel: its toolbar, its column header and the file tree.
   *
   * The tree is one Tab stop (a roving tabindex): the row in
   * `treeTabStop` has `tabindex="0"`, every other row `-1`. One key
   * handler here works out each key from the visible rows (`treeRows`,
   * the rows the panel draws) and applies it; the rows only draw and
   * answer clicks. When the current row goes (a folder closed above it,
   * chain mode, a new listing), the row that takes its place becomes
   * current, and takes the keyboard focus if its row had it.
   */
  import { onMount, tick } from 'svelte';
  import { get } from 'svelte/store';
  import { files, tree } from '$lib/stores';
  import { openTreeRow } from '$lib/fileOpening';
  import { filesView } from '$lib/stores/filesView';
  import { editorFocusRequested, modalOpen, treeFocusRequested } from '$lib/stores/layout';
  import { treeFocus, treeRows, treeTabStop } from '$lib/stores/treeFocus';
  import { chainDirectoryOf } from '$lib/utils/chainTree';
  import { belongsToInputMethod } from '$lib/utils/keyTargets';
  import { isShortcut, type TreeShortcutId } from '$lib/utils/shortcuts';
  import { chainHandleOf } from '$lib/utils/tabKey';
  import {
    fallbackFocus,
    isLoadingAbove,
    treeKeyAction,
    type TreeNavAction,
    type Typeahead,
  } from '$lib/utils/treeNav';
  import { replacementRow, type VisibleRow } from '$lib/utils/treeRows';
  import FilesToolbar from './FilesToolbar.svelte';
  import TreeHeader, { COLUMN_GUTTER_CLASS } from './TreeHeader.svelte';
  import TreeNode from './TreeNode.svelte';
  import Spinner from '../common/Spinner.svelte';

  /** The keys of the shortcut table that the key rules work out. */
  const NAVIGATION_KEYS: readonly TreeShortcutId[] = [
    'treeMove',
    'treeOpenFolder',
    'treeCloseFolder',
    'treeEnds',
    'treePage',
    'openTreeItem',
  ];

  let treeElement: HTMLElement | null = null;
  /** The name typed so far, for typing a name. */
  let typeahead: Typeahead = { buffer: '', at: 0 };
  /**
   * The row element that holds the keyboard focus, or held it until the
   * update that removed it: a browser may send `focusout` from a focused
   * row it removes (Chromium does), and that focus is the tree's to give
   * back.
   */
  let focusedRow: HTMLElement | null = null;

  /** The row element that `target` is or is inside of; null outside the rows. */
  function rowOf(target: EventTarget | null): HTMLElement | null {
    if (!(target instanceof Element)) return null;
    return target.closest<HTMLElement>('[data-row-id]');
  }

  /** The id of the row that `target` is or is inside of; null outside the rows. */
  function rowIdOf(target: EventTarget | null): string | null {
    return rowOf(target)?.dataset.rowId ?? null;
  }

  /** The row element of `id`, compared as text: an id is a path or a chain's key. */
  function rowElement(id: string): HTMLElement | null {
    const rows = treeElement?.querySelectorAll<HTMLElement>('[data-row-id]') ?? [];
    for (const row of rows) if (row.dataset.rowId === id) return row;
    return null;
  }

  /** Focus the row `id` and scroll it just into view. */
  function moveFocusTo(id: string) {
    const row = rowElement(id);
    if (!row) return;
    row.focus({ preventScroll: true });
    row.scrollIntoView({ block: 'nearest' });
  }

  /** How many rows a panel height holds, for PageDown and PageUp; 1 before any is drawn. */
  function pageSize(): number {
    const rowHeight = treeElement?.querySelector<HTMLElement>('[data-row-id]')?.offsetHeight ?? 0;
    const height = treeElement?.clientHeight ?? 0;
    return rowHeight > 0 ? Math.max(1, Math.floor(height / rowHeight)) : 1;
  }

  /** What each action does to the tree. */
  const ACTIONS: Readonly<Record<Exclude<TreeNavAction['type'], 'none'>, (id: string) => void>> = {
    focus: moveFocusTo,
    expand: (id) => void tree.expand(id),
    collapse: tree.collapse,
    open: openTreeRow,
  };

  /**
   * Esc: ask the open file's editor for the focus. With no open tab, or
   * while a dialog is open, the key is left alone.
   */
  function focusEditor(): boolean {
    if (get(files).openFiles.length === 0 || get(modalOpen)) return false;
    editorFocusRequested.set(true);
    return true;
  }

  /** The key the key rules work out, or null for a key the tree leaves alone. */
  function navigationKey(event: KeyboardEvent): string | null {
    if (NAVIGATION_KEYS.some((id) => isShortcut(id, event))) return event.key;
    // Typing a name: one printable character (Space opens the row instead).
    return event.key.length === 1 ? event.key : null;
  }

  /**
   * The tree's one key handler. A key with Ctrl, Cmd or Alt belongs to
   * the shortcut table, a key an input method composes with to it, and a
   * key outside the rows (a row's menu, the Retry button) to what has it.
   * The key is cancelled only when it acted.
   */
  function handleKeydown(event: KeyboardEvent) {
    const currentId = rowIdOf(event.target);
    if (currentId === null) return;
    if (event.ctrlKey || event.metaKey || event.altKey || belongsToInputMethod(event)) return;
    if (isShortcut('treeToEditor', event)) {
      if (focusEditor()) event.preventDefault();
      return;
    }
    const key = navigationKey(event);
    if (key === null) return;
    const result = treeKeyAction($treeRows, currentId, key, pageSize(), typeahead, Date.now());
    typeahead = result.typeahead;
    const { action } = result;
    if (action.type === 'none') return;
    event.preventDefault();
    ACTIONS[action.type](action.id);
  }

  /** A row that takes the focus, by click, Tab or key, becomes the current row. */
  function handleFocusin(event: FocusEvent) {
    focusedRow = rowOf(event.target);
    const id = focusedRow?.dataset.rowId;
    if (id !== undefined) treeFocus.set(id);
  }

  /**
   * The focus left a row. Once the event and the update around it are
   * over, the row has lost it for good if it is still in the page and
   * not focused (the focus went to another control, or to none after a
   * click); a row that is gone lost it to its removal, and one that is
   * still focused only to another window.
   */
  function handleFocusout() {
    const left = focusedRow;
    queueMicrotask(() => {
      const hasLeft = left !== null && left.isConnected && document.activeElement !== left;
      if (focusedRow === left && hasLeft) focusedRow = null;
    });
  }

  /** Whether the keyboard focus is on a row, or was on one the last update removed. */
  function isFocusOnRows(): boolean {
    if (focusedRow === null) return false;
    const active = document.activeElement;
    if (active === focusedRow) return true;
    return !focusedRow.isConnected && (active === null || active === document.body);
  }

  /**
   * When the current row is no longer shown, make the row that takes its
   * place current (`fallbackFocus`): the chain row that shows it as a
   * part, else the nearest folder above it, else the first row. The focus
   * follows when the row had it. While the roots load or the tree shows
   * its error, no row is drawn, and while a folder above the row loads its
   * rows, the row may come back: the current row waits for them.
   */
  function keepCurrentRow(rows: readonly VisibleRow[], current: string | null) {
    if (current === null || rows.some((row) => row.id === current)) return;
    if (isLoadingAbove(rows, current)) return;
    const folder = tree.nodeAt(chainDirectoryOf(chainHandleOf(current) ?? current));
    const next = fallbackFocus(rows, current, replacementRow(folder, current));
    const hadFocus = isFocusOnRows();
    treeFocus.set(next);
    if (hadFocus && next !== null) void tick().then(() => moveFocusTo(next));
  }

  $: areRowsDrawn = !$tree.loading && $tree.error === null;
  $: if (areRowsDrawn) keepCurrentRow($treeRows, $treeFocus);

  // A panel key asks for the tree's focus, possibly while the roots load;
  // the request waits for them.
  $: if ($treeFocusRequested && treeElement && !$tree.loading) void focusTabStop();

  /**
   * Focus the row that holds the Tab stop; with no row, the focus stays
   * where it is. The rows, and the panel just shown around them, are
   * drawn in the update after this one.
   */
  async function focusTabStop() {
    treeFocusRequested.set(false);
    await tick();
    const id = get(treeTabStop);
    if (id !== null) rowElement(id)?.focus();
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

  <!-- The rows hold the focus, one of them the Tab stop; the tree itself
       takes none, and its key handler answers the keys of its rows. -->
  <!-- svelte-ignore a11y-interactive-supports-focus -->
  <div
    class="flex-1 overflow-auto py-1 {COLUMN_GUTTER_CLASS}"
    role="tree"
    aria-label="Files"
    bind:this={treeElement}
    on:keydown={handleKeydown}
    on:focusin={handleFocusin}
    on:focusout={handleFocusout}
  >
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
      {#each $tree.roots as node, index (node.path)}
        <TreeNode
          {node}
          setSize={$tree.roots.length}
          posInSet={index + 1}
          showLabels={$filesView.labels}
          show={$filesView.show}
          sort={$filesView.sort}
        />
      {/each}
    {/if}
  </div>
</div>

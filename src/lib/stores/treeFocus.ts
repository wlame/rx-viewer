import { derived, writable, type Readable, type Writable } from 'svelte/store';
import type { TreeNode } from '../types';
import { memoizeLast } from '../utils/memoizeLast';
import { tabStopRow } from '../utils/treeNav';
import { visibleRows, type VisibleRow } from '../utils/treeRows';
import type { TreeSort } from '../utils/treeSort';
import { chainModeOn } from './chainMode';
import { activeOpenFile, files } from './files';
import { filesView } from './filesView';
import { tree } from './tree';

/**
 * The file tree's current row: the row that had the keyboard focus last,
 * by id (`rowKey`); null until a row has had it. The tree replaces it
 * when its row goes (`fallbackFocus`).
 */
export const treeFocus: Writable<string | null> = writable(null);

/**
 * The rows worked out again only for new roots, another mode or another
 * order: the tree store keeps its roots through a change of the selected
 * row or of a chain's description.
 */
const rowsOf = memoizeLast((roots: readonly TreeNode[], isChainModeOn: boolean, sort: TreeSort) =>
  visibleRows(roots, { chainModeOn: isChainModeOn, sort }),
);

/** The rows the file tree shows, top to bottom; its keys move through them. */
export const treeRows: Readable<VisibleRow[]> = derived(
  [tree, chainModeOn, filesView],
  ([$tree, $chainModeOn, $filesView]) => rowsOf($tree.roots, $chainModeOn, $filesView.sort),
);

/**
 * The row that holds the tree's one Tab stop: the current row while it
 * is shown, else the open file's or chain's row, else the first row.
 */
export const treeTabStop: Readable<string | null> = derived(
  [treeRows, treeFocus, files],
  ([$rows, $focus, $files]) => tabStopRow($rows, $focus, activeOpenFile($files)?.path ?? null),
);

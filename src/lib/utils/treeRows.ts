/**
 * The rows the file tree shows, in the order it shows them: the search
 * roots in their configured order and, under each open folder, the rows
 * `shownChildren` gives it (chain mode and the sort applied), depth
 * first. The tree's view and its keys both read these rows, so a key
 * never moves to a row the panel does not show.
 *
 * Everything here is pure, so it is tested without a backend.
 */
import type { TreeNode } from '../types';
import {
  isChainRow,
  isNodeRow,
  shownChildren,
  type ShownChildrenOptions,
  type TreeRow,
} from './chainTree';
import { chainHandleOf, chainKey } from './tabKey';

/** What a row of the tree is: a folder, a file, or a log chain in place of its parts. */
export type VisibleRowKind = 'folder' | 'file' | 'chain';

/** One row of the tree as the keyboard and the ARIA attributes see it. */
export interface VisibleRow {
  /** The row's key (`rowKey`): a folder's or file's path, a chain's tab key. */
  id: string;
  /** The id of the folder that holds the row; null for a search root. */
  parentId: string | null;
  /** How deep the row sits: 0 for a search root. */
  level: number;
  kind: VisibleRowKind;
  /** The name the row shows; typing a name matches it. */
  name: string;
  /** Whether a folder shows its rows; false for a file and a chain. */
  expanded: boolean;
  /** Whether a folder's entries are being listed. */
  loading: boolean;
  /** How many rows share the row's folder (`aria-setsize`). */
  setSize: number;
  /** The row's place among them, from 1 (`aria-posinset`). */
  posInSet: number;
}

/** Where a row sits: its folder, its depth and its place among its siblings. */
interface RowPlace {
  parentId: string | null;
  level: number;
  setSize: number;
  posInSet: number;
}

function visibleRowOf(row: TreeRow, place: RowPlace): VisibleRow {
  if (isChainRow(row)) {
    return {
      ...place,
      id: row.key,
      kind: 'chain',
      name: row.chain.name,
      expanded: false,
      loading: false,
    };
  }
  const isFolder = row.type === 'directory';
  return {
    ...place,
    id: row.path,
    kind: isFolder ? 'folder' : 'file',
    name: row.name,
    expanded: isFolder && row.expanded,
    loading: row.loading,
  };
}

/**
 * The rows the tree shows, top to bottom: each root, and under each open
 * folder its shown rows in `options.sort`'s order, with a chain row in
 * place of its parts while `options.chainModeOn` holds. The roots keep
 * the order they are given in.
 */
export function visibleRows(
  roots: readonly TreeNode[],
  options: ShownChildrenOptions,
): VisibleRow[] {
  const rows: VisibleRow[] = [];
  // Depth first, as the panel draws them; the depth is that of the tree.
  const addRows = (siblings: readonly TreeRow[], parentId: string | null, level: number) => {
    siblings.forEach((sibling, index) => {
      const row = visibleRowOf(sibling, {
        parentId,
        level,
        setSize: siblings.length,
        posInSet: index + 1,
      });
      rows.push(row);
      if (row.expanded && isNodeRow(sibling)) {
        addRows(shownChildren(sibling, options), row.id, level + 1);
      }
    });
  };
  addRows(roots, null, 0);
  return rows;
}

/**
 * The row that takes the place of the row `lostId` in its folder, when
 * one does: for a file that a log chain shows as a part (chain mode
 * turned on), that chain's row; for a chain's row (chain mode turned
 * off), the row of its active file, whose path is the chain's handle.
 * `directory` is the folder that holds `lostId`, as the tree has it.
 */
export function replacementRow(directory: TreeNode | null, lostId: string): string | null {
  const handle = chainHandleOf(lostId);
  if (handle !== null) return handle;
  const name = lostId.slice(lostId.lastIndexOf('/') + 1);
  const chain = directory?.chains?.find((candidate) => candidate.parts.includes(name));
  return chain ? chainKey(chain.path) : null;
}

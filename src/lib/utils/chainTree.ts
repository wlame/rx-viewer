/**
 * What the files panel shows of a directory in chain mode: one row per
 * log chain in place of its parts, and the marks each chain row carries.
 *
 * A directory node keeps every entry `/v1/tree` lists, and the chains
 * `/v1/logs/chains` lists beside them; the rows are worked out from both
 * each time they are shown, so turning the mode on or off changes no
 * node and collapses no folder. Only a file the chain listing names as a
 * part is left out of the rows: a folder, a file of no chain and another
 * encoding of a part (not in `parts`) stay where they are.
 *
 * Everything here is pure, so it is tested without a backend.
 */
import type { ChainEntry, ChainReason, TreeNode } from '../types';
import { chainKey, type TabKey } from './tabKey';

/** A log chain's row: the chain's listing entry in place of its parts. */
export interface ChainRow {
  type: 'chain';
  /** The chain's tab key, `chain:<handle>`: apart from its active file's path. */
  key: TabKey;
  chain: ChainEntry;
  level: number;
  /** The parts' tree nodes in the chain's order, when the parts are shown; else empty. */
  parts: TreeNode[];
}

/** A row of the files panel: a folder or file the tree lists, or a chain. */
export type TreeRow = TreeNode | ChainRow;

export function isChainRow(row: TreeRow): row is ChainRow {
  return row.type === 'chain' && 'chain' in row;
}

/** Whether a row is a folder or file the tree lists, not a chain. */
export function isNodeRow(row: TreeRow): row is TreeNode {
  return !isChainRow(row);
}

/** The directory of a chain from its handle (the directory joined with the chain's name). */
export function chainDirectoryOf(handle: string): string {
  return handle.slice(0, handle.lastIndexOf('/')) || '/';
}

/** The key of a row among its siblings: a node's path, a chain's tab key. */
export function rowKey(row: TreeRow): string {
  return isChainRow(row) ? row.key : row.path;
}

export interface ShownChildrenOptions {
  /** Chain mode is chosen and the backend serves log chains. */
  chainModeOn: boolean;
  /** List each chain's parts under its row (the `chain_parts=1` link flag). */
  showParts: boolean;
}

/** The order `/v1/tree` lists names in: case-insensitive. */
function compareNames(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
}

function isFolder(node: TreeNode): boolean {
  return node.type === 'directory';
}

/** The row of one chain, with the tree nodes of its parts when they are shown. */
function chainRow(
  chain: ChainEntry,
  level: number,
  filesByName: ReadonlyMap<string, TreeNode>,
  showParts: boolean,
): ChainRow {
  const parts = showParts
    ? chain.parts.flatMap((name) => {
        const part = filesByName.get(name);
        return part ? [part] : [];
      })
    : [];
  return { type: 'chain', key: chainKey(chain.path), chain, level, parts };
}

/**
 * Put each chain row among `files` where its name sorts, the way the
 * tree sorts files; a chain comes before a file of the same name.
 */
function placeAmongFiles(files: TreeNode[], chains: ChainRow[]): TreeRow[] {
  const sorted = [...chains].sort((a, b) => compareNames(a.chain.name, b.chain.name));
  const rows: TreeRow[] = [];
  let next = 0;
  for (const file of files) {
    while (next < sorted.length && compareNames(sorted[next].chain.name, file.name) <= 0) {
      rows.push(sorted[next++]);
    }
    rows.push(file);
  }
  return [...rows, ...sorted.slice(next)];
}

/**
 * The rows of a directory: its listed entries as they are, unless chain
 * mode is on and its chains are listed; then each chain's parts give way
 * to one chain row among the files, folders first as the tree lists
 * them. The folders and files kept are the directory's own nodes, so
 * their state (an expanded folder) stays.
 */
export function shownChildren(directory: TreeNode, options: ShownChildrenOptions): TreeRow[] {
  const chains = directory.chains;
  if (!options.chainModeOn || chains === undefined || chains.length === 0) {
    return directory.children;
  }
  const files = directory.children.filter((child) => !isFolder(child));
  const filesByName = new Map(files.map((file) => [file.name, file]));
  const partNames = new Set(chains.flatMap((chain) => chain.parts));
  const level = directory.level + 1;
  const rows = chains.map((chain) => chainRow(chain, level, filesByName, options.showParts));
  return [
    ...directory.children.filter(isFolder),
    ...placeAmongFiles(
      files.filter((file) => !partNames.has(file.name)),
      rows,
    ),
  ];
}

/** How a chain's mark looks: plain, good, a warning, or a failure. */
export type ChainBadgeTone = 'neutral' | 'success' | 'warning' | 'danger';

/** One mark on a chain's row: its text, its tooltip and its look. */
export interface ChainBadge {
  text: string;
  title: string;
  tone: ChainBadgeTone;
}

/** What the last description of a chain said: its state and why it is invalid. */
export interface DescribedChain {
  state: string;
  reasons: readonly ChainReason[];
}

/** Names a tooltip lists before it says how many more there are. */
const NAMES_IN_TITLE = 20;

/** `a, b, c`, or the first names and `, and N more` when `total` is larger. */
function nameList(names: readonly string[], total: number): string {
  const listed = names.slice(0, NAMES_IN_TITLE);
  const more = total - listed.length;
  return more > 0 ? `${listed.join(', ')}, and ${more} more` : listed.join(', ');
}

/** Each mark: whether a chain has it, and what it says. */
const CHAIN_MARKS: {
  applies: (chain: ChainEntry, described: DescribedChain | null) => boolean;
  badge: (chain: ChainEntry, described: DescribedChain | null) => ChainBadge;
}[] = [
  {
    applies: () => true,
    badge: (chain) =>
      chain.too_many_parts
        ? { text: 'chain', title: 'A log chain of more than 10,000 files', tone: 'neutral' }
        : {
            text: `chain · ${chain.parts.length}`,
            title: `A log chain: ${chain.parts.length} files of one rotated log, read as one`,
            tone: 'neutral',
          },
  },
  {
    applies: (chain) => chain.is_indexed,
    badge: () => ({
      text: 'idx',
      title: 'Every part but the active file has a line index',
      tone: 'success',
    }),
  },
  {
    applies: (chain) => chain.missing_count > 0,
    badge: (chain) => ({
      text: `${chain.missing_count} missing`,
      title: `Missing parts: ${nameList(chain.missing, chain.missing_count)}`,
      tone: 'warning',
    }),
  },
  {
    applies: (chain) => chain.unreadable.length > 0,
    badge: (chain) => ({
      text: `${chain.unreadable.length} unreadable`,
      title: `Parts that cannot be read: ${nameList(chain.unreadable, chain.unreadable.length)}`,
      tone: 'danger',
    }),
  },
  {
    applies: (chain) => chain.too_many_parts,
    badge: () => ({
      text: 'too many parts',
      title: 'More than 10,000 parts: the chain is not read as one text',
      tone: 'danger',
    }),
  },
  {
    applies: (_chain, described) => described?.state === 'invalid',
    badge: (_chain, described) => {
      const messages = (described?.reasons ?? []).map((reason) => reason.message);
      return {
        text: 'invalid',
        title:
          messages.length > 0
            ? messages.slice(0, NAMES_IN_TITLE).join('\n')
            : 'A check failed: the parts cannot be read as one text',
        tone: 'danger',
      };
    },
  },
];

/**
 * The marks of a chain's row, in order: `chain · N` (its part count),
 * `idx`, `N missing`, `N unreadable`, `too many parts`, and `invalid`
 * once a description said so. Each tooltip names what the mark is about.
 */
export function chainBadges(chain: ChainEntry, described: DescribedChain | null): ChainBadge[] {
  return CHAIN_MARKS.filter((mark) => mark.applies(chain, described)).map((mark) =>
    mark.badge(chain, described),
  );
}

/**
 * What the files panel shows of a directory: its entries in the order
 * chosen, and in chain mode one row per log chain in place of its parts,
 * with the marks each chain row carries.
 *
 * A directory node keeps every entry `/v1/tree` lists, and the chains
 * `/v1/logs/chains` lists beside them; the rows are worked out from both
 * each time they are shown, so turning the mode on or off changes no
 * node and collapses no folder. Only a file the chain listing names as a
 * part is left out of the rows: a folder, a file of no chain and another
 * encoding of a part (not in `parts`) stay. The rows are sorted by
 * `utils/treeSort.ts`, chains among the files.
 *
 * Everything here is pure, so it is tested without a backend.
 */
import type { ChainEntry, ChainReason, TreeNode } from '../types';
import { chainKey, type TabKey } from './tabKey';
import { sortRows, type TreeSort } from './treeSort';

/** A log chain's row: the chain's listing entry in place of its parts. */
export interface ChainRow {
  type: 'chain';
  /** The chain's tab key, `chain:<handle>`: apart from its active file's path. */
  key: TabKey;
  chain: ChainEntry;
  level: number;
  /**
   * The newest modification time of its parts the directory's listing
   * gives (`modified_at` of the files named in `chain.parts`), as the
   * listing writes it; null when none of them has one.
   */
  modifiedAt: string | null;
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
  /** The order of the rows. */
  sort: TreeSort;
}

function isFolder(node: TreeNode): boolean {
  return node.type === 'directory';
}

/** The row of one chain, with the newest time of its parts among `times`. */
function chainRow(
  chain: ChainEntry,
  level: number,
  times: ReadonlyMap<string, PartTime>,
): ChainRow {
  return {
    type: 'chain',
    key: chainKey(chain.path),
    chain,
    level,
    modifiedAt: newestPartTime(chain, times),
  };
}

/** A file's modification time as the listing writes it, and the instant it names. */
interface PartTime {
  text: string;
  ms: number;
}

/**
 * The modification times of a directory's files by name. A folder is no
 * part, and a file without a readable time is left out. Times are
 * compared as instants, never as text: a time may name its zone.
 */
function fileTimes(files: readonly TreeNode[]): Map<string, PartTime> {
  const times = new Map<string, PartTime>();
  for (const file of files) {
    if (file.modified_at === null) continue;
    const ms = Date.parse(file.modified_at);
    if (!Number.isNaN(ms)) times.set(file.name, { text: file.modified_at, ms });
  }
  return times;
}

/** The newest of the times `times` holds for the parts of `chain`, or null. */
function newestPartTime(chain: ChainEntry, times: ReadonlyMap<string, PartTime>): string | null {
  let newest: PartTime | null = null;
  for (const part of chain.parts) {
    const time = times.get(part);
    if (time !== undefined && (newest === null || time.ms > newest.ms)) newest = time;
  }
  return newest?.text ?? null;
}

/**
 * The rows of a directory in the order `options.sort` gives: its listed
 * entries, unless chain mode is on and its chains are listed; then each
 * chain's parts give way to one chain row, sorted among the files. The
 * folders and files kept are the directory's own nodes, so their state
 * (an expanded folder) stays.
 */
export function shownChildren(directory: TreeNode, options: ShownChildrenOptions): TreeRow[] {
  const chains = directory.chains;
  if (!options.chainModeOn || chains === undefined || chains.length === 0) {
    return sortRows(directory.children, options.sort);
  }
  const files = directory.children.filter((child) => !isFolder(child));
  const partNames = new Set(chains.flatMap((chain) => chain.parts));
  const level = directory.level + 1;
  const times = fileTimes(files);
  return sortRows(
    [
      ...directory.children.filter(isFolder),
      ...chains.map((chain) => chainRow(chain, level, times)),
      ...files.filter((file) => !partNames.has(file.name)),
    ],
    options.sort,
  );
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

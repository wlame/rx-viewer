/**
 * The order of the rows of one folder of the files panel: by name, size
 * or date, in either direction.
 *
 * Folders come first. Under a name sort they follow the chosen
 * direction; under a size sort they go by name A to Z (a folder has no
 * size); under a date sort by their own time in the chosen direction.
 * Files and log chains sort together, a chain by its size and by the
 * newest time of its parts. Names compare without case and with the
 * numbers in them read as numbers (`app.log.2` before `app.log.10`). A
 * value that is not known sorts last in both directions. Rows that tie
 * sort by name A to Z, then by the exact name, then a chain before a
 * file of the same name.
 *
 * Everything here is pure: the rows given are not changed.
 */
import type { ChainRow, TreeRow } from './chainTree';
import type { ValueColumn } from './urlState';

/** What the files panel sorts its rows by. */
export type SortKey = 'name' | 'size' | 'date';
/** Ascending: A to Z, smallest first, oldest first. */
export type SortDir = 'asc' | 'desc';

export interface TreeSort {
  key: SortKey;
  dir: SortDir;
}

/** Every key, in the order the URL's values list them. */
export const SORT_KEYS: readonly SortKey[] = ['name', 'size', 'date'];
/** Both directions. */
export const SORT_DIRS: readonly SortDir[] = ['asc', 'desc'];

/** The sort of a link that names none: by name, A to Z. */
export const DEFAULT_SORT: TreeSort = { key: 'name', dir: 'asc' };

/** The direction a key sorts in when it is chosen: names A to Z, sizes largest first, dates newest first. */
export const FIRST_DIR: Readonly<Record<SortKey, SortDir>> = {
  name: 'asc',
  size: 'desc',
  date: 'desc',
};

const OTHER_DIR: Readonly<Record<SortDir, SortDir>> = { asc: 'desc', desc: 'asc' };
const DIR_SIGN: Readonly<Record<SortDir, number>> = { asc: 1, desc: -1 };

/** What a kind of row sorts by first under a key, and whether the chosen direction applies. */
interface FirstOrder {
  by: 'name' | 'value';
  followsDirection: boolean;
}

const BY_NAME: FirstOrder = { by: 'name', followsDirection: true };
const BY_NAME_A_TO_Z: FirstOrder = { by: 'name', followsDirection: false };
const BY_VALUE: FirstOrder = { by: 'value', followsDirection: true };

/** The first order of folders and of the other rows under each key. */
const FIRST_ORDERS: Readonly<Record<SortKey, { folders: FirstOrder; others: FirstOrder }>> = {
  name: { folders: BY_NAME, others: BY_NAME },
  size: { folders: BY_NAME_A_TO_Z, others: BY_VALUE },
  date: { folders: BY_VALUE, others: BY_VALUE },
};

/**
 * The name order: without case, numbers by their value. The same order
 * as `a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })`,
 * from one collator, which is much faster over many rows.
 */
const NAME_ORDER = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function isChain(row: TreeRow): row is ChainRow {
  return row.type === 'chain' && 'chain' in row;
}

/** An instant from a time as the listing writes it, or null when there is none or it is unreadable. */
function instant(time: string | null | undefined): number | null {
  if (time === null || time === undefined) return null;
  const ms = Date.parse(time);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * The value a row sorts by under a size or date sort, null when it is
 * not known. A chain of too many parts shows no size, so it has none here.
 */
const VALUE_OF: Readonly<Record<SortKey, (row: TreeRow) => number | null>> = {
  name: () => null,
  size: (row) => {
    if (isChain(row)) return row.chain.too_many_parts ? null : row.chain.size;
    return typeof row.size === 'number' ? row.size : null;
  },
  date: (row) => instant(isChain(row) ? row.modifiedAt : row.modified_at),
};

/** A row with what it sorts by, worked out once. */
interface SortItem {
  row: TreeRow;
  isFolder: boolean;
  isChain: boolean;
  name: string;
  value: number | null;
}

function toItem(row: TreeRow, key: SortKey): SortItem {
  const chain = isChain(row);
  return {
    row,
    isFolder: !chain && row.type === 'directory',
    isChain: chain,
    name: chain ? row.chain.name : row.name,
    value: VALUE_OF[key](row),
  };
}

/** Known values in `sign`'s direction; an unknown value after every known one, whatever the direction. */
function compareValues(a: number | null, b: number | null, sign: number): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  return sign * (a - b);
}

/** The exact names in code-unit order. */
function compareExact(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function comparatorFor(sort: TreeSort): (a: SortItem, b: SortItem) => number {
  const orders = FIRST_ORDERS[sort.key];
  const sign = DIR_SIGN[sort.dir];
  return (a, b) => {
    if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
    const order = a.isFolder ? orders.folders : orders.others;
    const orderSign = order.followsDirection ? sign : 1;
    const first =
      order.by === 'name'
        ? orderSign * NAME_ORDER.compare(a.name, b.name)
        : compareValues(a.value, b.value, orderSign);
    return (
      first ||
      NAME_ORDER.compare(a.name, b.name) ||
      compareExact(a.name, b.name) ||
      Number(b.isChain) - Number(a.isChain)
    );
  };
}

/**
 * The rows of one folder in the order `sort` gives them, as a new array:
 * folders first, then files and chains together (see the module's
 * comment). Rows that tie in every way keep the order they came in.
 */
export function sortRows(rows: readonly TreeRow[], sort: TreeSort): TreeRow[] {
  return rows
    .map((row) => toItem(row, sort.key))
    .sort(comparatorFor(sort))
    .map((item) => item.row);
}

/**
 * The sort after a click on the column of `clicked`, or its key: another
 * column sorts by it in its first direction, the sorted one reverses.
 */
export function nextSort(current: TreeSort, clicked: SortKey): TreeSort {
  if (current.key !== clicked) return { key: clicked, dir: FIRST_DIR[clicked] };
  return { key: clicked, dir: OTHER_DIR[current.dir] };
}

/** Whether `sort` is on a value other than `show`. */
function isOnOtherValue(sort: TreeSort, show: ValueColumn): boolean {
  return sort.key !== 'name' && sort.key !== show;
}

/**
 * The sort a link names, read with the value it shows: a sort on the
 * value not shown is on the shown one, in the link's direction. A name
 * sort stays.
 */
export function sortForShown(sort: TreeSort, show: ValueColumn): TreeSort {
  return isOnOtherValue(sort, show) ? { key: show, dir: sort.dir } : sort;
}

/**
 * The sort once the value shown is switched to `show`: a sort on the
 * other value moves to `show` in its first direction. A name sort stays.
 */
export function sortAfterValueSwitch(sort: TreeSort, show: ValueColumn): TreeSort {
  return isOnOtherValue(sort, show) ? { key: show, dir: FIRST_DIR[show] } : sort;
}

/**
 * What a key press does in the file tree, worked out from the rows the
 * tree shows (`treeRows.ts`): move the focus to a row, open or close a
 * folder, open a file or a chain, or nothing. The tree applies the
 * action; this module only decides it, so every rule is tested without a
 * page.
 *
 * The keys follow the WAI-ARIA tree pattern: ↓ ↑ to the next and
 * previous row, → into a folder, ← out of it, Home and End, PageDown and
 * PageUp, Enter or Space to open, and typing a name to go to the next
 * row whose name starts with it. The caller passes only keys without
 * Ctrl, Cmd or Alt: those belong to the shortcut table.
 */
import { chainHandleOf } from './tabKey';
import type { VisibleRow } from './treeRows';

/** The letters typed so far, and when the last one was typed (ms). */
export interface Typeahead {
  buffer: string;
  at: number;
}

export type TreeNavAction =
  | { type: 'focus'; id: string }
  | { type: 'expand'; id: string }
  | { type: 'collapse'; id: string }
  | { type: 'open'; id: string }
  | { type: 'none' };

/** How long after a letter the next one still adds to the name typed. */
export const TYPEAHEAD_RESET_MS = 500;

const NONE: TreeNavAction = { type: 'none' };

/** The row a move lands on, by index, or null when it lands on none. */
type Move = (rows: readonly VisibleRow[], index: number, pageSize: number) => number | null;

/**
 * The keys that move the focus, and where each lands from the row at
 * `index` (-1 when no row is current). ↓ and ↑ stop at the ends; the
 * others land on the first or last row there, which brings it into view.
 */
const MOVES: Readonly<Record<string, Move>> = {
  ArrowDown: (rows, index) => (index + 1 < rows.length ? index + 1 : null),
  ArrowUp: (_rows, index) => (index > 0 ? index - 1 : null),
  Home: (rows) => (rows.length > 0 ? 0 : null),
  End: (rows) => (rows.length > 0 ? rows.length - 1 : null),
  PageDown: (rows, index, pageSize) =>
    rows.length > 0 ? Math.min(index + pageSize, rows.length - 1) : null,
  PageUp: (_rows, index, pageSize) => (index >= 0 ? Math.max(index - pageSize, 0) : null),
};

/** What a key does to the current row, which is `rows[index]`. */
type RowKey = (rows: readonly VisibleRow[], index: number) => TreeNavAction;

/**
 * Expand a closed folder; on an open one, go to its first row. A folder
 * whose rows are being listed waits for them: the load already runs.
 */
const expandOrEnter: RowKey = (rows, index) => {
  const row = rows[index];
  if (row.kind !== 'folder') return NONE;
  if (!row.expanded) return row.loading ? NONE : { type: 'expand', id: row.id };
  const next = rows[index + 1];
  return next?.parentId === row.id ? { type: 'focus', id: next.id } : NONE;
};

/** Close an open folder; from any other row, go to its folder. */
const collapseOrLeave: RowKey = (rows, index) => {
  const row = rows[index];
  if (row.kind === 'folder' && row.expanded) return { type: 'collapse', id: row.id };
  return row.parentId === null ? NONE : { type: 'focus', id: row.parentId };
};

/** Open a file or a chain; open or close a folder. */
const openOrToggle: RowKey = (rows, index) => {
  const row = rows[index];
  if (row.kind !== 'folder') return { type: 'open', id: row.id };
  if (row.expanded) return { type: 'collapse', id: row.id };
  return row.loading ? NONE : { type: 'expand', id: row.id };
};

/** The keys that act on the current row. */
const ROW_KEYS: Readonly<Record<string, RowKey>> = {
  ArrowRight: expandOrEnter,
  ArrowLeft: collapseOrLeave,
  Enter: openOrToggle,
  ' ': openOrToggle,
};

/** Whether `text` is one letter typed more than once (`sss`). */
function isOneLetterRepeated(text: string): boolean {
  return text.length > 1 && [...text].every((letter) => letter === text[0]);
}

/**
 * The index of the first row, from `from` on and wrapping around, whose
 * name starts with `prefix` (lower case), or -1.
 */
function findByName(rows: readonly VisibleRow[], from: number, prefix: string): number {
  for (let step = 0; step < rows.length; step++) {
    const index = (from + step) % rows.length;
    if (rows[index].name.toLowerCase().startsWith(prefix)) return index;
  }
  return -1;
}

/**
 * Add `letter` to the name typed (a new name after `TYPEAHEAD_RESET_MS`)
 * and go to the row it names. A new name, or one letter typed again and
 * again, looks from the row after the current one, wrapping around with
 * the current row last, so the same letter cycles through its rows. A
 * longer name looks from the current row on: it keeps the row while the
 * row's name still starts with it.
 */
function typeName(
  rows: readonly VisibleRow[],
  index: number,
  letter: string,
  typeahead: Typeahead,
  now: number,
): { action: TreeNavAction; typeahead: Typeahead } {
  const isSameName = now - typeahead.at < TYPEAHEAD_RESET_MS;
  const buffer = (isSameName ? typeahead.buffer : '') + letter;
  const typed = buffer.toLowerCase();
  const cycles = typed.length === 1 || isOneLetterRepeated(typed);
  const prefix = cycles ? typed[0] : typed;
  const from = cycles ? index + 1 : Math.max(index, 0);
  const found = rows.length > 0 ? findByName(rows, from, prefix) : -1;
  return {
    action: found >= 0 ? { type: 'focus', id: rows[found].id } : NONE,
    typeahead: { buffer, at: now },
  };
}

/**
 * What `key` (a `KeyboardEvent.key` without Ctrl, Cmd or Alt) does on
 * the row `currentId` of `rows`. `pageSize` is how many rows PageDown and
 * PageUp move (at least 1); `typeahead` is the name typed so far, and
 * `now` the time of the key press (ms), which tells whether a letter
 * adds to it. Any other key is `none`.
 */
export function treeKeyAction(
  rows: readonly VisibleRow[],
  currentId: string | null,
  key: string,
  pageSize: number,
  typeahead: Typeahead,
  now: number,
): { action: TreeNavAction; typeahead: Typeahead } {
  const index = currentId === null ? -1 : rows.findIndex((row) => row.id === currentId);

  const move = MOVES[key];
  if (move) {
    const target = move(rows, index, Math.max(1, pageSize));
    return { action: target === null ? NONE : { type: 'focus', id: rows[target].id }, typeahead };
  }

  const rowKey = ROW_KEYS[key];
  if (rowKey) return { action: index >= 0 ? rowKey(rows, index) : NONE, typeahead };

  // A printable character is one character long; a named key is longer.
  if (key.length === 1) return typeName(rows, index, key, typeahead, now);
  return { action: NONE, typeahead };
}

/** The folder above `path` (`/srv` for `/srv/logs`, `/` for `/srv`), or null above `/`. */
function parentPath(path: string): string | null {
  const slash = path.lastIndexOf('/');
  if (slash < 0 || path === '/') return null;
  return slash === 0 ? '/' : path.slice(0, slash);
}

/**
 * The row the focus moves to when the row `lostId` is no longer shown:
 * the row itself if it still is, else `hint` (the row that took its
 * place, such as the chain row that shows a part) when shown, else the
 * nearest shown folder above it, else the first row; null without rows.
 * A chain's row sits where its handle does.
 */
export function fallbackFocus(
  rows: readonly VisibleRow[],
  lostId: string,
  hint: string | null,
): string | null {
  const shown = new Set(rows.map((row) => row.id));
  if (shown.has(lostId)) return lostId;
  if (hint !== null && shown.has(hint)) return hint;
  const lostPath = chainHandleOf(lostId) ?? lostId;
  for (let path = parentPath(lostPath); path !== null; path = parentPath(path)) {
    if (shown.has(path)) return path;
  }
  return rows[0]?.id ?? null;
}

/**
 * The row that holds the tree's one Tab stop: the current row (the row
 * focused last) while it is shown, else the open file's or chain's row
 * when shown (`openId`, the active tab's key), else the first row; null
 * without rows.
 */
export function tabStopRow(
  rows: readonly VisibleRow[],
  currentId: string | null,
  openId: string | null,
): string | null {
  if (currentId !== null && rows.some((row) => row.id === currentId)) return currentId;
  if (openId !== null && rows.some((row) => row.id === openId)) return openId;
  return rows[0]?.id ?? null;
}

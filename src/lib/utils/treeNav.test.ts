import { describe, expect, it } from 'vitest';
import { treeEntry } from '../testing/fakeLogDir';
import type { TreeNode } from '../types';
import {
  TYPEAHEAD_RESET_MS,
  fallbackFocus,
  tabStopRow,
  treeKeyAction,
  type Typeahead,
} from './treeNav';
import { visibleRows, type VisibleRow } from './treeRows';
import { DEFAULT_SORT } from './treeSort';

/** A row of `kind` at `id`, in the folder `parentId`; the name is the last part of the id. */
function row(
  id: string,
  parentId: string | null,
  kind: VisibleRow['kind'],
  fields: Partial<VisibleRow> = {},
): VisibleRow {
  return {
    id,
    parentId,
    level: parentId === null ? 0 : parentId.split('/').length - 1,
    kind,
    name: id.slice(id.lastIndexOf('/') + 1),
    expanded: false,
    loading: false,
    setSize: 1,
    posInSet: 1,
    ...fields,
  };
}

/**
 * An open root `/srv` holding an open folder `logs`, which holds a closed
 * folder `old`, an open folder `empty` that shows no row, a chain
 * `app.log` and a file `notes.txt`; then a closed root `/var`.
 */
const ROWS: VisibleRow[] = [
  row('/srv', null, 'folder', { expanded: true }),
  row('/srv/logs', '/srv', 'folder', { expanded: true }),
  row('/srv/logs/old', '/srv/logs', 'folder'),
  row('/srv/logs/empty', '/srv/logs', 'folder', { expanded: true }),
  row('chain:/srv/logs/app.log', '/srv/logs', 'chain', { name: 'app.log' }),
  row('/srv/logs/notes.txt', '/srv/logs', 'file'),
  row('/var', null, 'folder'),
];

const FIRST = '/srv';
const MIDDLE = '/srv/logs/old';
const LAST = '/var';
const NO_TYPING: Typeahead = { buffer: '', at: 0 };
const PAGE = 3;

/** The action of `key` on the row `current` of `rows`. */
function act(current: string | null, key: string, rows: readonly VisibleRow[] = ROWS) {
  return treeKeyAction(rows, current, key, PAGE, NO_TYPING, 10_000).action;
}

const focus = (id: string) => ({ type: 'focus', id });
const NONE = { type: 'none' };

describe('treeKeyAction moves', () => {
  it.each([
    ['ArrowDown', FIRST, focus('/srv/logs')],
    ['ArrowDown', MIDDLE, focus('/srv/logs/empty')],
    ['ArrowDown', LAST, NONE],
    ['ArrowUp', FIRST, NONE],
    ['ArrowUp', MIDDLE, focus('/srv/logs')],
    ['ArrowUp', LAST, focus('/srv/logs/notes.txt')],
    ['Home', FIRST, focus(FIRST)],
    ['Home', MIDDLE, focus(FIRST)],
    ['Home', LAST, focus(FIRST)],
    ['End', FIRST, focus(LAST)],
    ['End', MIDDLE, focus(LAST)],
    ['End', LAST, focus(LAST)],
    ['PageDown', FIRST, focus('/srv/logs/empty')],
    ['PageDown', MIDDLE, focus('/srv/logs/notes.txt')],
    ['PageDown', LAST, focus(LAST)],
    ['PageUp', FIRST, focus(FIRST)],
    ['PageUp', MIDDLE, focus(FIRST)],
    ['PageUp', LAST, focus('/srv/logs/empty')],
  ])('%s on %s → %o', (key, current, expected) => {
    expect(act(current, key)).toEqual(expected);
  });

  it('clamps PageDown and PageUp to the last and the first row', () => {
    expect(treeKeyAction(ROWS, FIRST, 'PageDown', 100, NO_TYPING, 0).action).toEqual(focus(LAST));
    expect(treeKeyAction(ROWS, LAST, 'PageUp', 100, NO_TYPING, 0).action).toEqual(focus(FIRST));
  });

  it('moves one row a page when a page holds one row', () => {
    expect(treeKeyAction(ROWS, FIRST, 'PageDown', 1, NO_TYPING, 0).action).toEqual(
      focus('/srv/logs'),
    );
  });

  it('starts at the first row when no row is current', () => {
    expect(act(null, 'ArrowDown')).toEqual(focus(FIRST));
    expect(act(null, 'Home')).toEqual(focus(FIRST));
    expect(act(null, 'ArrowRight')).toEqual(NONE);
    expect(act('/gone', 'Enter')).toEqual(NONE);
  });

  it('does nothing in a tree without rows', () => {
    for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp', 'a']) {
      expect(treeKeyAction([], null, key, PAGE, NO_TYPING, 0).action).toEqual(NONE);
    }
  });

  it.each(['Tab', 'F2', 'Delete', 'Shift', 'ArrowLeftRight'])('leaves %j alone', (key) => {
    expect(act(MIDDLE, key)).toEqual(NONE);
  });
});

describe('treeKeyAction on folders, files and chains', () => {
  it.each([
    [MIDDLE, { type: 'expand', id: MIDDLE }],
    [LAST, { type: 'expand', id: LAST }],
    ['/srv/logs', focus(MIDDLE)],
    [FIRST, focus('/srv/logs')],
    ['/srv/logs/empty', NONE],
    ['/srv/logs/notes.txt', NONE],
    ['chain:/srv/logs/app.log', NONE],
  ])('ArrowRight on %s → %o', (current, expected) => {
    expect(act(current, 'ArrowRight')).toEqual(expected);
  });

  it('does not expand a closed folder whose rows are being listed', () => {
    const rows = ROWS.map((r) => (r.id === MIDDLE ? { ...r, loading: true } : r));

    expect(act(MIDDLE, 'ArrowRight', rows)).toEqual(NONE);
  });

  it.each([
    ['/srv/logs', { type: 'collapse', id: '/srv/logs' }],
    [FIRST, { type: 'collapse', id: FIRST }],
    [MIDDLE, focus('/srv/logs')],
    ['/srv/logs/notes.txt', focus('/srv/logs')],
    ['chain:/srv/logs/app.log', focus('/srv/logs')],
    [LAST, NONE],
  ])('ArrowLeft on %s → %o', (current, expected) => {
    expect(act(current, 'ArrowLeft')).toEqual(expected);
  });

  it.each(['Enter', ' '])('%j opens a file and a chain, and opens or closes a folder', (key) => {
    expect(act('/srv/logs/notes.txt', key)).toEqual({ type: 'open', id: '/srv/logs/notes.txt' });
    expect(act('chain:/srv/logs/app.log', key)).toEqual({
      type: 'open',
      id: 'chain:/srv/logs/app.log',
    });
    expect(act(MIDDLE, key)).toEqual({ type: 'expand', id: MIDDLE });
    expect(act('/srv/logs', key)).toEqual({ type: 'collapse', id: '/srv/logs' });
  });

  it('keeps the typed name of a key that is not typing', () => {
    const typed: Typeahead = { buffer: 'ap', at: 5 };

    expect(treeKeyAction(ROWS, FIRST, 'ArrowDown', PAGE, typed, 10).typeahead).toBe(typed);
  });
});

describe('treeKeyAction typing a name', () => {
  /** A root `logs` holding files by these names, in this order. */
  const NAMED = [
    row('/logs', null, 'folder', { expanded: true }),
    ...[
      'alpha.log',
      'app.log',
      'app.log.1',
      'apricot',
      'beta.log',
      'Sys.log',
      'sec.log',
      'syslog',
    ].map((name) => row(`/logs/${name}`, '/logs', 'file')),
  ];

  /** Type `keys` one after the other at the given times, from the row `start`. */
  function type(start: string, keys: [key: string, at: number][]) {
    let current: string | null = start;
    let typeahead: Typeahead = NO_TYPING;
    const visited: (string | null)[] = [];
    for (const [key, at] of keys) {
      const result = treeKeyAction(NAMED, current, key, PAGE, typeahead, at);
      typeahead = result.typeahead;
      current = result.action.type === 'focus' ? result.action.id : current;
      visited.push(result.action.type === 'focus' ? result.action.id : null);
    }
    return { visited, typeahead };
  }

  it('goes to the next row whose name starts with the letters typed within half a second', () => {
    const { visited, typeahead } = type('/logs', [
      ['a', 1000],
      ['p', 1100],
      ['r', 1200],
    ]);

    expect(visited).toEqual(['/logs/alpha.log', '/logs/app.log', '/logs/apricot']);
    expect(typeahead).toEqual({ buffer: 'apr', at: 1200 });
  });

  it('keeps the current row while a longer name still matches it', () => {
    const { visited } = type('/logs', [
      ['a', 1000],
      ['p', 1100],
      ['p', 1200],
      ['.', 1300],
    ]);

    expect(visited).toEqual(['/logs/alpha.log', '/logs/app.log', '/logs/app.log', '/logs/app.log']);
  });

  it('starts a new name after half a second', () => {
    const { visited, typeahead } = type('/logs', [
      ['a', 1000],
      ['b', 1000 + TYPEAHEAD_RESET_MS + 100],
    ]);

    expect(TYPEAHEAD_RESET_MS).toBe(500);
    expect(visited).toEqual(['/logs/alpha.log', '/logs/beta.log']);
    expect(typeahead.buffer).toBe('b');
  });

  it('cycles through the rows that start with a letter typed again and again, without case', () => {
    const { visited } = type('/logs', [
      ['s', 1000],
      ['s', 1100],
      ['s', 1200],
      ['s', 1300],
    ]);

    expect(visited).toEqual(['/logs/Sys.log', '/logs/sec.log', '/logs/syslog', '/logs/Sys.log']);
  });

  it('wraps around to the top, the current row last', () => {
    expect(type('/logs/syslog', [['a', 1000]]).visited).toEqual(['/logs/alpha.log']);
    expect(type('/logs/beta.log', [['b', 1000]]).visited).toEqual(['/logs/beta.log']);
    expect(type('/logs/app.log', [['a', 1000]]).visited).toEqual(['/logs/app.log.1']);
  });

  it('keeps the focus and the letters typed when no name matches', () => {
    const { visited, typeahead } = type('/logs/beta.log', [
      ['a', 1000],
      ['x', 1100],
    ]);

    expect(visited).toEqual(['/logs/alpha.log', null]);
    expect(typeahead).toEqual({ buffer: 'ax', at: 1100 });
    expect(type('/logs', [['z', 1000]]).typeahead).toEqual({ buffer: 'z', at: 1000 });
  });

  it('reads an upper-case letter as its lower case', () => {
    expect(type('/logs', [['B', 1000]]).visited).toEqual(['/logs/beta.log']);
  });
});

describe('fallbackFocus', () => {
  it('keeps a row that is still shown', () => {
    expect(fallbackFocus(ROWS, MIDDLE, null)).toBe(MIDDLE);
  });

  it('moves to the hint when it is shown', () => {
    expect(fallbackFocus(ROWS, '/srv/logs/app.log.1', 'chain:/srv/logs/app.log')).toBe(
      'chain:/srv/logs/app.log',
    );
  });

  it('moves to the nearest shown folder above the lost row otherwise', () => {
    expect(fallbackFocus(ROWS, '/srv/logs/old/deep/x.log', null)).toBe(MIDDLE);
    expect(fallbackFocus(ROWS, '/srv/logs/gone.log', 'chain:/srv/logs/gone.log')).toBe('/srv/logs');
    expect(fallbackFocus(ROWS, 'chain:/srv/logs/other.log', '/srv/logs/other.log')).toBe(
      '/srv/logs',
    );
  });

  it('reads the folders above by whole names, not by text', () => {
    expect(fallbackFocus(ROWS, '/srv/logs2/a.log', null)).toBe(FIRST);
    expect(fallbackFocus([ROWS[2], ROWS[1]], '/srv/logs2/a.log', null)).toBe(MIDDLE);
  });

  it('moves to the first row when nothing above is shown, and to none without rows', () => {
    expect(fallbackFocus(ROWS.slice(2), '/srv/logs/notes.txt.1', null)).toBe(MIDDLE);
    expect(fallbackFocus(ROWS, '/opt/x', null)).toBe(FIRST);
    expect(fallbackFocus([], '/srv', null)).toBeNull();
  });
});

describe('tabStopRow', () => {
  it('is the current row while it is shown', () => {
    expect(tabStopRow(ROWS, MIDDLE, '/srv/logs/notes.txt')).toBe(MIDDLE);
  });

  it("is the open file's row when there is no current row", () => {
    expect(tabStopRow(ROWS, null, '/srv/logs/notes.txt')).toBe('/srv/logs/notes.txt');
    expect(tabStopRow(ROWS, '/gone', 'chain:/srv/logs/app.log')).toBe('chain:/srv/logs/app.log');
  });

  it('is the first row otherwise, and none without rows', () => {
    expect(tabStopRow(ROWS, null, null)).toBe(FIRST);
    expect(tabStopRow(ROWS, null, '/srv/logs/hidden.log')).toBe(FIRST);
    expect(tabStopRow([], MIDDLE, null)).toBeNull();
  });
});

describe('the tree keys on a large tree', () => {
  /** A root holding `folders` open folders of `files` files each. */
  function largeTree(folders: number, files: number): TreeNode[] {
    const children = Array.from({ length: folders }, (_, f): TreeNode => {
      const path = `/big/dir-${f}`;
      return {
        ...treeEntry(path, 'directory'),
        expanded: true,
        loading: false,
        level: 1,
        children: Array.from({ length: files }, (_, n) => ({
          ...treeEntry(`${path}/app-${n}.log`, 'file', { size: n, is_text: true }),
          expanded: false,
          loading: false,
          children: [],
          level: 2,
        })),
      };
    });
    return [
      { ...treeEntry('/big', 'directory'), expanded: true, loading: false, level: 0, children },
    ];
  }

  it('works out 10,000 rows and a key on them in under 50 ms', () => {
    const roots = largeTree(1, 9_999);

    const started = performance.now();
    const rows = visibleRows(roots, { chainModeOn: false, sort: DEFAULT_SORT });
    const end = treeKeyAction(rows, rows[0].id, 'End', PAGE, NO_TYPING, 0);
    const typed = treeKeyAction(rows, rows.at(-1)?.id ?? null, 'z', PAGE, NO_TYPING, 0);
    const elapsed = performance.now() - started;

    expect(rows.length).toBeGreaterThanOrEqual(10_000);
    expect(end.action).toEqual({ type: 'focus', id: rows.at(-1)?.id });
    expect(typed.action).toEqual({ type: 'none' });
    expect(elapsed).toBeLessThan(50);
  });
});

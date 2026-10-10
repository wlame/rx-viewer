import { describe, expect, it } from 'vitest';
import { treeEntry } from '../testing/fakeLogDir';
import type { ChainEntry, TreeEntry, TreeNode } from '../types';
import { DEFAULT_SORT } from './treeSort';
import { replacementRow, visibleRows, type VisibleRow } from './treeRows';

/** A folder at `path`, with `children` and, when listed, its chains. */
function folder(
  path: string,
  level: number,
  children: TreeNode[] = [],
  fields: Partial<TreeNode> = {},
): TreeNode {
  return {
    ...treeEntry(path, 'directory'),
    expanded: children.length > 0,
    loading: false,
    children,
    level,
    ...fields,
  };
}

/** A file at `path`, with the size and time a sort may read. */
function file(path: string, level: number, fields: Partial<TreeEntry> = {}): TreeNode {
  return {
    ...treeEntry(path, 'file', { is_text: true, size: 10, ...fields }),
    expanded: false,
    loading: false,
    children: [],
    level,
  };
}

function chain(dir: string, name: string, parts: string[], size = 10): ChainEntry {
  return {
    path: `${dir}/${name}`,
    name,
    parts,
    has_active: parts.includes(name),
    missing: [],
    missing_count: 0,
    size,
    compression_formats: [],
    is_indexed: false,
    unreadable: [],
    too_many_parts: false,
  };
}

const OFF = { chainModeOn: false, sort: DEFAULT_SORT };
const ON = { chainModeOn: true, sort: DEFAULT_SORT };

/** The ids of `rows`, in order. */
function ids(rows: VisibleRow[]): string[] {
  return rows.map((row) => row.id);
}

/**
 * Two search roots: `/srv` with an open folder `logs` (a closed folder
 * `old`, an open folder `sub` with two files, a chain `app.log` of three
 * parts and a single file `notes.txt`), and `/var`, closed.
 */
function sampleTree(): TreeNode[] {
  const logs = folder(
    '/srv/logs',
    1,
    [
      folder('/srv/logs/old', 2, [], { children_count: 4 }),
      folder('/srv/logs/sub', 2, [
        file('/srv/logs/sub/deep.log', 3, { size: 10 }),
        file('/srv/logs/sub/a.log', 3, { size: 50 }),
      ]),
      file('/srv/logs/app.log', 2, { size: 30 }),
      file('/srv/logs/app.log.1', 2, { size: 20 }),
      file('/srv/logs/app.log.2.gz', 2, { size: 5 }),
      file('/srv/logs/notes.txt', 2, { size: 100 }),
    ],
    { chains: [chain('/srv/logs', 'app.log', ['app.log.2.gz', 'app.log.1', 'app.log'], 55)] },
  );
  return [folder('/srv', 0, [logs]), folder('/var', 0)];
}

describe('visibleRows', () => {
  it('walks the roots in their order and every open folder depth first', () => {
    expect(ids(visibleRows(sampleTree(), OFF))).toEqual([
      '/srv',
      '/srv/logs',
      '/srv/logs/old',
      '/srv/logs/sub',
      '/srv/logs/sub/a.log',
      '/srv/logs/sub/deep.log',
      '/srv/logs/app.log',
      '/srv/logs/app.log.1',
      '/srv/logs/app.log.2.gz',
      '/srv/logs/notes.txt',
      '/var',
    ]);
  });

  it('leaves out the rows of a closed folder, and of an open folder inside it', () => {
    const roots = sampleTree();
    roots[0] = { ...roots[0], expanded: false };

    expect(ids(visibleRows(roots, OFF))).toEqual(['/srv', '/var']);
  });

  it('shows the chain row in place of its parts in chain mode', () => {
    expect(ids(visibleRows(sampleTree(), ON))).toEqual([
      '/srv',
      '/srv/logs',
      '/srv/logs/old',
      '/srv/logs/sub',
      '/srv/logs/sub/a.log',
      '/srv/logs/sub/deep.log',
      'chain:/srv/logs/app.log',
      '/srv/logs/notes.txt',
      '/var',
    ]);
  });

  it.each([
    [
      { key: 'name', dir: 'desc' },
      [
        '/srv/logs/sub',
        '/srv/logs/sub/deep.log',
        '/srv/logs/sub/a.log',
        '/srv/logs/old',
        '/srv/logs/notes.txt',
        'chain:/srv/logs/app.log',
      ],
    ],
    [
      { key: 'size', dir: 'desc' },
      [
        '/srv/logs/old',
        '/srv/logs/sub',
        '/srv/logs/sub/a.log',
        '/srv/logs/sub/deep.log',
        '/srv/logs/notes.txt',
        'chain:/srv/logs/app.log',
      ],
    ],
  ] as const)('applies the sort %o at every level, and keeps the roots in order', (sort, under) => {
    const rows = visibleRows(sampleTree(), { chainModeOn: true, sort });

    expect(ids(rows)).toEqual(['/srv', '/srv/logs', ...under, '/var']);
  });

  it('orders the files of one folder by size, the chain by the sum of its parts', () => {
    const rows = visibleRows(sampleTree(), {
      chainModeOn: true,
      sort: { key: 'size', dir: 'asc' },
    });

    expect(ids(rows).slice(6, 8)).toEqual(['chain:/srv/logs/app.log', '/srv/logs/notes.txt']);
  });

  it('gives each row its level, parent, set size and place in the set', () => {
    const rows = visibleRows(sampleTree(), ON);
    const byId = new Map(rows.map((row) => [row.id, row]));

    expect(byId.get('/srv')).toMatchObject({ level: 0, parentId: null, setSize: 2, posInSet: 1 });
    expect(byId.get('/var')).toMatchObject({ level: 0, parentId: null, setSize: 2, posInSet: 2 });
    expect(byId.get('/srv/logs')).toMatchObject({
      level: 1,
      parentId: '/srv',
      setSize: 1,
      posInSet: 1,
    });
    expect(byId.get('/srv/logs/old')).toMatchObject({
      level: 2,
      parentId: '/srv/logs',
      setSize: 4,
      posInSet: 1,
    });
    expect(byId.get('chain:/srv/logs/app.log')).toMatchObject({
      level: 2,
      parentId: '/srv/logs',
      setSize: 4,
      posInSet: 3,
    });
    expect(byId.get('/srv/logs/sub/deep.log')).toMatchObject({
      level: 3,
      parentId: '/srv/logs/sub',
      setSize: 2,
      posInSet: 2,
    });
  });

  it('counts the parts in the set size of their folder with the mode off', () => {
    const rows = visibleRows(sampleTree(), OFF);

    expect(rows.find((row) => row.id === '/srv/logs/notes.txt')).toMatchObject({
      setSize: 6,
      posInSet: 6,
    });
  });

  it('names the kind, name, state and loading of each row', () => {
    const roots = sampleTree();
    roots[1] = { ...roots[1], loading: true };
    const byId = new Map(visibleRows(roots, ON).map((row) => [row.id, row]));

    expect(byId.get('/srv/logs')).toMatchObject({ kind: 'folder', name: 'logs', expanded: true });
    expect(byId.get('/srv/logs/old')).toMatchObject({ kind: 'folder', expanded: false });
    expect(byId.get('/srv/logs/notes.txt')).toMatchObject({
      kind: 'file',
      name: 'notes.txt',
      expanded: false,
      loading: false,
    });
    expect(byId.get('chain:/srv/logs/app.log')).toMatchObject({
      kind: 'chain',
      name: 'app.log',
      expanded: false,
    });
    expect(byId.get('/var')).toMatchObject({ kind: 'folder', loading: true, expanded: false });
  });

  it('shows no rows under an open folder that lists none', () => {
    const roots = [folder('/srv', 0, [], { expanded: true })];

    expect(ids(visibleRows(roots, OFF))).toEqual(['/srv']);
  });

  it('shows nothing without roots', () => {
    expect(visibleRows([], ON)).toEqual([]);
  });
});

describe('replacementRow', () => {
  const logs = sampleTree()[0].children[0];

  it('is the chain row that shows a part as one of its own', () => {
    expect(replacementRow(logs, '/srv/logs/app.log.1')).toBe('chain:/srv/logs/app.log');
    expect(replacementRow(logs, '/srv/logs/app.log')).toBe('chain:/srv/logs/app.log');
  });

  it("is the active file's row of a chain row", () => {
    expect(replacementRow(null, 'chain:/srv/logs/app.log')).toBe('/srv/logs/app.log');
  });

  it('is null for a file of no chain, or a folder that lists no chains', () => {
    expect(replacementRow(logs, '/srv/logs/notes.txt')).toBeNull();
    expect(replacementRow({ ...logs, chains: undefined }, '/srv/logs/app.log.1')).toBeNull();
    expect(replacementRow(null, '/srv/logs/app.log.1')).toBeNull();
  });
});

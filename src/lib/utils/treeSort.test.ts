import { describe, expect, it } from 'vitest';
import { treeEntry } from '../testing/fakeLogDir';
import type { ChainEntry, TreeEntry, TreeNode } from '../types';
import type { ChainRow, TreeRow } from './chainTree';
import {
  DEFAULT_SORT,
  FIRST_DIR,
  nextSort,
  sortAfterValueSwitch,
  sortForShown,
  sortRows,
  type TreeSort,
} from './treeSort';

const DIR = '/l';

function node(entry: TreeEntry): TreeNode {
  return { ...entry, expanded: false, loading: false, children: [], level: 1 };
}

function file(name: string, fields: Partial<TreeEntry> = {}): TreeNode {
  return node(treeEntry(`${DIR}/${name}`, 'file', { is_text: true, size: 10, ...fields }));
}

function folder(name: string, fields: Partial<TreeEntry> = {}): TreeNode {
  return node(treeEntry(`${DIR}/${name}`, 'directory', { children_count: 0, ...fields }));
}

function chain(
  name: string,
  fields: { size?: number; modifiedAt?: string | null; tooManyParts?: boolean } = {},
): ChainRow {
  const entry: ChainEntry = {
    path: `${DIR}/${name}`,
    name,
    parts: fields.tooManyParts ? [] : [`${name}.1`, name],
    has_active: true,
    missing: [],
    missing_count: 0,
    size: fields.size ?? 10,
    compression_formats: [],
    is_indexed: false,
    unreadable: [],
    too_many_parts: fields.tooManyParts ?? false,
  };
  return {
    type: 'chain',
    key: `chain:${entry.path}`,
    chain: entry,
    level: 1,
    modifiedAt: fields.modifiedAt ?? null,
  };
}

/** The names of the rows in order, a chain's as `chain:<name>`. */
function names(rows: readonly TreeRow[]): string[] {
  return rows.map((row) => ('chain' in row ? `chain:${row.chain.name}` : row.name));
}

const sort = (key: TreeSort['key'], dir: TreeSort['dir']): TreeSort => ({ key, dir });

describe('sortRows by name', () => {
  const rows = [
    file('app.log.10'),
    folder('zeta'),
    file('app.log.2'),
    file('Zeta'),
    folder('Alpha'),
    file('alpha'),
  ];

  it('puts the folders first, then the files A to Z, numbers by their value', () => {
    expect(names(sortRows(rows, sort('name', 'asc')))).toEqual([
      'Alpha',
      'zeta',
      'alpha',
      'app.log.2',
      'app.log.10',
      'Zeta',
    ]);
  });

  it('puts the folders first, then the files Z to A', () => {
    expect(names(sortRows(rows, sort('name', 'desc')))).toEqual([
      'zeta',
      'Alpha',
      'Zeta',
      'app.log.10',
      'app.log.2',
      'alpha',
    ]);
  });

  // Names equal but for case tie; the exact name decides, in both directions.
  it.each(['asc', 'desc'] as const)(
    'orders App.log before app.log by the exact name (%s)',
    (dir) => {
      const tied = [file('app.log'), file('App.log')];

      expect(names(sortRows(tied, sort('name', dir)))).toEqual(['App.log', 'app.log']);
    },
  );

  it('sorts a chain among the files by its name', () => {
    const mixed = [file('notes.txt'), chain('app.log'), file('zz.txt'), chain('svc.log')];

    expect(names(sortRows(mixed, DEFAULT_SORT))).toEqual([
      'chain:app.log',
      'notes.txt',
      'chain:svc.log',
      'zz.txt',
    ]);
  });

  it('leaves the rows it was given as they were', () => {
    const given = [...rows];

    sortRows(rows, sort('name', 'desc'));

    expect(rows).toEqual(given);
  });
});

describe('sortRows by size', () => {
  const rows = [
    folder('b-dir'),
    file('small', { size: 5 }),
    file('unknown', { size: null }),
    chain('big.log', { size: 900 }),
    folder('a-dir'),
    file('middle', { size: 50 }),
    chain('huge.log', { size: 1, tooManyParts: true }),
  ];

  it('puts the largest first, then the smaller ones, and the sizes not known last', () => {
    expect(names(sortRows(rows, sort('size', 'desc')))).toEqual([
      'a-dir',
      'b-dir',
      'chain:big.log',
      'middle',
      'small',
      'chain:huge.log',
      'unknown',
    ]);
  });

  it('puts the smallest first, and the sizes not known last again', () => {
    expect(names(sortRows(rows, sort('size', 'asc')))).toEqual([
      'a-dir',
      'b-dir',
      'small',
      'middle',
      'chain:big.log',
      'chain:huge.log',
      'unknown',
    ]);
  });

  it.each(['asc', 'desc'] as const)('orders files of one size by name ascending (%s)', (dir) => {
    const same = [file('c', { size: 7 }), file('a', { size: 7 }), file('b', { size: 7 })];

    expect(names(sortRows(same, sort('size', dir)))).toEqual(['a', 'b', 'c']);
  });
});

describe('sortRows by date', () => {
  const rows = [
    folder('old-dir', { modified_at: '2026-01-01T00:00:00Z' }),
    file('noon', { modified_at: '2026-10-08T12:00:00Z' }),
    file('never', { modified_at: null }),
    chain('app.log', { modifiedAt: '2026-10-09T08:00:00Z' }),
    folder('new-dir', { modified_at: '2026-09-01T00:00:00Z' }),
    folder('no-time-dir', { modified_at: null }),
    // 13:00 UTC: later than noon, though its text sorts before it.
    file('one-pm', { modified_at: '2026-10-08T15:00:00+02:00' }),
    file('garbled', { modified_at: 'yesterday' }),
  ];

  it('puts the newest first, folders by their own time, and the times not known last', () => {
    expect(names(sortRows(rows, sort('date', 'desc')))).toEqual([
      'new-dir',
      'old-dir',
      'no-time-dir',
      'chain:app.log',
      'one-pm',
      'noon',
      'garbled',
      'never',
    ]);
  });

  it('puts the oldest first, and the times not known last again', () => {
    expect(names(sortRows(rows, sort('date', 'asc')))).toEqual([
      'old-dir',
      'new-dir',
      'no-time-dir',
      'noon',
      'one-pm',
      'chain:app.log',
      'garbled',
      'never',
    ]);
  });
});

describe('sortRows on a chain and a file of the same name', () => {
  // A chain of too many parts lists none, so its active file stays beside it.
  it.each([
    ['name', 'asc'],
    ['name', 'desc'],
    ['size', 'desc'],
    ['date', 'asc'],
  ] as const)('puts the chain first, whichever comes first, by %s %s', (key, dir) => {
    const twins = [chain('big.log', { tooManyParts: true }), file('big.log', { size: null })];

    expect(names(sortRows(twins, sort(key, dir)))).toEqual(['chain:big.log', 'big.log']);
    expect(names(sortRows([...twins].reverse(), sort(key, dir)))).toEqual([
      'chain:big.log',
      'big.log',
    ]);
  });
});

describe('sortRows on a large directory', () => {
  /** `count` rows: every tenth a folder, every seventh without a size or time. */
  function generated(count: number): TreeRow[] {
    return Array.from({ length: count }, (_, i) => {
      const unknown = i % 7 === 0;
      const name = `app-${(i * 7919) % count}.log.${i % 13}`;
      if (i % 10 === 0) return folder(name, { modified_at: unknown ? null : stamp(i) });
      return file(name, { size: unknown ? null : (i * 104729) % 5000, modified_at: stamp(i) });
    });
  }

  function stamp(i: number): string {
    return new Date(Date.UTC(2026, 0, 1) + ((i * 7919) % 100_000) * 60_000).toISOString();
  }

  it.each([sort('name', 'asc'), sort('size', 'desc'), sort('date', 'asc')])(
    'sorts 10,000 rows in under 100 ms ($key $dir)',
    (chosen) => {
      const rows = generated(10_000);

      const started = performance.now();
      const sorted = sortRows(rows, chosen);
      const elapsed = performance.now() - started;

      expect(sorted).toHaveLength(10_000);
      expect(elapsed).toBeLessThan(100);
    },
  );
});

describe('nextSort', () => {
  it.each([
    [sort('name', 'asc'), 'size', sort('size', 'desc')],
    [sort('size', 'desc'), 'size', sort('size', 'asc')],
    [sort('size', 'asc'), 'name', sort('name', 'asc')],
    [sort('name', 'asc'), 'name', sort('name', 'desc')],
    [sort('name', 'desc'), 'date', sort('date', 'desc')],
    [sort('date', 'desc'), 'date', sort('date', 'asc')],
  ] as const)('turns %o clicked on %s into %o', (current, clicked, next) => {
    expect(nextSort(current, clicked)).toEqual(next);
  });

  it('starts names A to Z, sizes largest first and dates newest first', () => {
    expect(FIRST_DIR).toEqual({ name: 'asc', size: 'desc', date: 'desc' });
    expect(DEFAULT_SORT).toEqual(sort('name', 'asc'));
  });
});

describe('sortAfterValueSwitch', () => {
  it.each([
    [sort('size', 'desc'), 'date', sort('date', 'desc')],
    [sort('size', 'asc'), 'date', sort('date', 'desc')],
    [sort('date', 'asc'), 'size', sort('size', 'desc')],
    [sort('name', 'desc'), 'date', sort('name', 'desc')],
    [sort('name', 'asc'), 'size', sort('name', 'asc')],
    [sort('size', 'asc'), 'size', sort('size', 'asc')],
  ] as const)('turns %o into %o when %s is shown', (current, show, next) => {
    expect(sortAfterValueSwitch(current, show)).toEqual(next);
  });
});

describe('sortForShown', () => {
  it.each([
    [sort('date', 'desc'), 'size', sort('size', 'desc')],
    [sort('date', 'asc'), 'size', sort('size', 'asc')],
    [sort('size', 'asc'), 'date', sort('date', 'asc')],
    [sort('size', 'desc'), 'size', sort('size', 'desc')],
    [sort('name', 'desc'), 'date', sort('name', 'desc')],
  ] as const)('reads %o as %o while %s is shown, keeping the direction', (named, show, read) => {
    expect(sortForShown(named, show)).toEqual(read);
  });
});

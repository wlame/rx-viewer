import { describe, expect, it } from 'vitest';
import { chainPart } from '../testing/chainDescription';
import type { ChainPart } from '../types';
import { changeNotice, compareParts } from './chainChanges';

/** A part as a description lists it: its name, size, modification time and the rest given. */
function part(name: string, fields: Partial<ChainPart> = {}): ChainPart {
  return chainPart(name, { path: `/l/${name}`, ...fields });
}

const MTIME = (minute: number) => `2026-10-01T00:${String(minute).padStart(2, '0')}:00.000000Z`;

describe('compareParts', () => {
  it('finds nothing changed in the same parts', () => {
    const parts = [part('app.log.1', { size: 10, modified_at: MTIME(1) }), part('app.log')];

    const changes = compareParts(parts, parts);

    expect(changes).toMatchObject({ renamed: [], added: [], removed: [], changed: [] });
    expect(changes.nameMap.get('app.log.1')).toBe('app.log.1');
  });

  // app.log.2.gz is deleted, app.log.1 is compressed into app.log.2.gz,
  // app.log becomes app.log.1, and a new app.log starts.
  it('reads a numbered rotation as renames, a new active file and a removed oldest part', () => {
    const before = [
      part('app.log.2.gz', { size: 300, modified_at: MTIME(1), compression_format: 'gzip' }),
      part('app.log.1', { size: 900, modified_at: MTIME(2) }),
      part('app.log', { size: 600, modified_at: MTIME(3), is_active: true }),
    ];
    const after = [
      part('app.log.2.gz', { size: 250, modified_at: MTIME(2), compression_format: 'gzip' }),
      part('app.log.1', { size: 600, modified_at: MTIME(3) }),
      part('app.log', { size: 0, modified_at: MTIME(9), is_active: true }),
    ];

    const changes = compareParts(before, after);

    expect(changes.renamed).toEqual([
      { from: 'app.log.1', to: 'app.log.2.gz' },
      { from: 'app.log', to: 'app.log.1' },
    ]);
    expect(changes.added).toEqual(['app.log']);
    expect(changes.removed).toEqual(['app.log.2.gz']);
    expect(changes.changed).toEqual([]);
    expect([...changes.nameMap]).toEqual([
      ['app.log.1', 'app.log.2.gz'],
      ['app.log', 'app.log.1'],
    ]);
  });

  // The active file was written after the tab described it, so its size
  // and modification time grew before the rotation renamed it.
  it('follows an active file that grew before it was renamed to the newest frozen part', () => {
    const before = [
      part('app.log.1', { size: 900, modified_at: MTIME(2) }),
      part('app.log', { size: 600, modified_at: MTIME(3), is_active: true }),
    ];
    const after = [
      part('app.log.2', { size: 900, modified_at: MTIME(2) }),
      part('app.log.1', { size: 640, modified_at: MTIME(4) }),
      part('app.log', { size: 0, modified_at: MTIME(9), is_active: true }),
    ];

    const changes = compareParts(before, after);

    expect(changes.nameMap.get('app.log')).toBe('app.log.1');
    expect(changes.nameMap.get('app.log.1')).toBe('app.log.2');
    expect(changes.added).toEqual(['app.log']);
  });

  it('knows a part by its first time when its size and time both changed', () => {
    const before = [part('app.log.1', { size: 900, modified_at: MTIME(2), first_ms: 5000 })];
    const after = [part('app.log.2.xz', { size: 90, modified_at: MTIME(7), first_ms: 5000 })];

    expect(compareParts(before, after).renamed).toEqual([
      { from: 'app.log.1', to: 'app.log.2.xz' },
    ]);
  });

  it('reads a frozen part written in place as changed, under the same name', () => {
    const before = [
      part('app.log.1', { size: 900, modified_at: MTIME(2) }),
      part('app.log', { is_active: true, modified_at: MTIME(3) }),
    ];
    const after = [
      part('app.log.1', { size: 960, modified_at: MTIME(5) }),
      part('app.log', { is_active: true, modified_at: MTIME(3) }),
    ];

    const changes = compareParts(before, after);

    expect(changes.changed).toEqual(['app.log.1']);
    expect(changes.nameMap.get('app.log.1')).toBe('app.log.1');
    expect(changes).toMatchObject({ renamed: [], added: [], removed: [] });
  });

  it('pairs each new part with one old part at most', () => {
    const before = [
      part('a.1', { size: 10, modified_at: MTIME(1) }),
      part('a.2', { size: 10, modified_at: MTIME(1) }),
    ];
    const after = [part('a.3', { size: 10, modified_at: MTIME(1) })];

    const changes = compareParts(before, after);

    expect(changes.renamed).toEqual([{ from: 'a.1', to: 'a.3' }]);
    expect(changes.removed).toEqual(['a.2']);
  });
});

describe('compareParts on a chain of 10,000 parts', () => {
  /** `count` parts named `agent.log.<n>`, each with its own size and time from `seed`. */
  function manyParts(count: number, seed: number): ChainPart[] {
    return Array.from({ length: count }, (_, i) =>
      part(`agent.log.${i + 1}`, {
        size: seed * 1_000_000 + i,
        modified_at: new Date(Date.UTC(2026, 0, 1) + (seed * 100_000 + i) * 1000).toISOString(),
        first_ms: seed * 1e9 + i,
      }),
    );
  }

  // Every part written in place: no rule but the last pairs them, so each
  // rule meets every part. A scan of the new parts per old part per rule
  // is 5 x 10^8 tests.
  it('pairs 10,000 parts written in place within a bound', () => {
    const before = manyParts(10_000, 1);
    const after = manyParts(10_000, 2);
    let fastest = Infinity;
    let changes = compareParts(before, after);
    for (let run = 0; run < 3; run++) {
      const start = performance.now();
      changes = compareParts(before, after);
      fastest = Math.min(fastest, performance.now() - start);
    }

    expect(changes.changed).toHaveLength(10_000);
    expect(fastest).toBeLessThan(100);
  });
});

describe('changeNotice', () => {
  it('counts each kind of change the comparison found', () => {
    const changes = {
      renamed: [
        { from: 'a.1', to: 'a.2' },
        { from: 'a', to: 'a.1' },
      ],
      added: ['a'],
      removed: ['a.3'],
      changed: [],
      nameMap: new Map(),
    };

    expect(changeNotice('syslog', changes)).toBe(
      'Files of syslog changed on disk (renamed 2, new 1, removed 1); chain reloaded',
    );
  });

  it('names only the kinds that happened, and none when it cannot tell', () => {
    const changed = { renamed: [], added: [], removed: [], changed: ['a.1'], nameMap: new Map() };

    expect(changeNotice('app.log', changed)).toBe(
      'Files of app.log changed on disk (changed 1); chain reloaded',
    );
    expect(changeNotice('app.log', null)).toBe('Files of app.log changed on disk; chain reloaded');
  });
});

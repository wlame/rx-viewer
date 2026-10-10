import { describe, expect, it } from 'vitest';
import {
  CHAIN_NAMES,
  DIRECTORY_NAMES,
  LOG_DIR,
  SINGLE_FILE_NAMES,
  logDirChains,
  logDirEntries,
  treeEntry,
} from '../testing/fakeLogDir';
import type { ChainEntry, TreeEntry, TreeNode } from '../types';
import {
  chainBadges,
  isChainRow,
  isNodeRow,
  rowKey,
  shownChildren,
  type TreeRow,
} from './chainTree';
import { DEFAULT_SORT, type TreeSort } from './treeSort';

const DIR = '/l';

function node(entry: TreeEntry, level: number, children: TreeNode[] = []): TreeNode {
  return { ...entry, expanded: false, loading: false, children, level };
}

/** A loaded directory holding `entries`, with the chains its listing gave (none when undefined). */
function directory(path: string, entries: TreeEntry[], chains?: ChainEntry[], level = 0): TreeNode {
  return {
    ...node(treeEntry(path, 'directory'), level),
    expanded: true,
    children: entries.map((entry) => node(entry, level + 1)),
    chains,
  };
}

function file(name: string, dir = DIR): TreeEntry {
  return treeEntry(`${dir}/${name}`, 'file', { is_text: true, size: 10 });
}

function chain(name: string, parts: string[], fields: Partial<ChainEntry> = {}): ChainEntry {
  return {
    path: `${DIR}/${name}`,
    name,
    parts,
    has_active: parts.includes(name),
    missing: [],
    missing_count: 0,
    size: 10 * parts.length,
    compression_formats: [],
    is_indexed: false,
    unreadable: [],
    too_many_parts: false,
    ...fields,
  };
}

/** What a row shows as its name: a chain's name or a file's or folder's. */
function names(rows: TreeRow[]): string[] {
  return rows.map((row) => (isChainRow(row) ? `chain:${row.chain.name}` : row.name));
}

const ON = { chainModeOn: true, sort: DEFAULT_SORT };
const OFF = { chainModeOn: false, sort: DEFAULT_SORT };

describe('shownChildren', () => {
  const entries = [
    treeEntry(`${DIR}/archive`, 'directory'),
    file('app.log'),
    file('app.log.1'),
    file('app.log.2.gz'),
    file('notes.txt'),
    file('svc.log'),
    file('svc.log.1'),
    file('zz.txt'),
  ];
  const chains = [
    chain('app.log', ['app.log.2.gz', 'app.log.1', 'app.log']),
    chain('svc.log', ['svc.log.1', 'svc.log']),
  ];

  it('shows one entry per chain in place of its parts, and keeps the other files', () => {
    const rows = shownChildren(directory(DIR, entries, chains), ON);

    expect(names(rows)).toEqual([
      'archive',
      'chain:app.log',
      'notes.txt',
      'chain:svc.log',
      'zz.txt',
    ]);
  });

  it('shows the listed entries as they are with the mode off', () => {
    const dir = directory(DIR, entries, chains);

    expect(shownChildren(dir, OFF)).toEqual(dir.children);
  });

  it('shows the listed entries as they are while the chains are not listed', () => {
    const dir = directory(DIR, entries);

    expect(shownChildren(dir, ON)).toEqual(dir.children);
  });

  it('keeps the folders and files the same objects, so their state stays', () => {
    const dir = directory(DIR, entries, chains);

    const rows = shownChildren(dir, ON);

    const kept = rows.filter(isNodeRow);
    for (const row of kept) expect(dir.children).toContain(row);
  });

  it('places a chain one level below its directory, keyed apart from its active file', () => {
    const rows = shownChildren(directory(DIR, entries, chains, 2), ON);

    const app = rows.find(isChainRow);
    expect(app?.level).toBe(3);
    expect(rowKey(app as TreeRow)).toBe('chain:/l/app.log');
    expect(rowKey(rows[0])).toBe('/l/archive');
  });

  it('hides no folder that has the name of a part', () => {
    const withFolder = [treeEntry(`${DIR}/app.log.1`, 'directory'), file('app.log')];
    const rows = shownChildren(
      directory(DIR, withFolder, [chain('app.log', ['app.log.1', 'app.log'])]),
      ON,
    );

    expect(names(rows)).toEqual(['app.log.1', 'chain:app.log']);
  });

  // Another encoding of one generation is not in `parts`: it is shown.
  it('keeps a file the listing does not name as a part', () => {
    const withDuplicate = [file('app.log'), file('app.log.1'), file('app.log.1.gz')];
    const rows = shownChildren(
      directory(DIR, withDuplicate, [chain('app.log', ['app.log.1', 'app.log'])]),
      ON,
    );

    expect(names(rows)).toEqual(['chain:app.log', 'app.log.1.gz']);
  });

  it('shows a chain of too many parts beside every one of its files', () => {
    const many = [file('big.log'), file('big.log.1'), file('big.log.2')];
    const rows = shownChildren(
      directory(DIR, many, [chain('big.log', [], { too_many_parts: true })]),
      ON,
    );

    expect(names(rows)).toEqual(['chain:big.log', 'big.log', 'big.log.1', 'big.log.2']);
  });

  it('shows a chain whose parts the tree does not list, and hides nothing for it', () => {
    const rows = shownChildren(
      directory(DIR, [file('notes.txt')], [chain('gone.log', ['gone.log.1', 'gone.log'])]),
      ON,
    );

    expect(names(rows)).toEqual(['chain:gone.log', 'notes.txt']);
  });
});

describe('shownChildren in a chosen order', () => {
  /** A file of `DIR` of `size` bytes, last modified on day `day` of October 2026. */
  function sized(name: string, size: number | null, day: number): TreeEntry {
    const modified_at = `2026-10-${String(day).padStart(2, '0')}T12:00:00Z`;
    return treeEntry(`${DIR}/${name}`, 'file', { is_text: true, size, modified_at });
  }

  // app.log's parts sum to 300 bytes and end on day 9; svc.log's to 30, day 2.
  const entries = [
    sized('zz.txt', 100, 5),
    treeEntry(`${DIR}/archive`, 'directory', { modified_at: '2026-10-01T00:00:00Z' }),
    sized('app.log', 100, 9),
    sized('app.log.1', 100, 8),
    sized('app.log.2.gz', 100, 7),
    sized('notes.txt', 50, 6),
    sized('svc.log', 20, 2),
    sized('svc.log.1', 10, 1),
    sized('empty.txt', null, 3),
  ];
  const chains = [
    chain('app.log', ['app.log.2.gz', 'app.log.1', 'app.log'], { size: 300 }),
    chain('svc.log', ['svc.log.1', 'svc.log'], { size: 30 }),
  ];
  const by = (key: TreeSort['key'], dir: TreeSort['dir'], chainModeOn = true) => ({
    chainModeOn,
    sort: { key, dir },
  });

  it.each([
    [
      by('name', 'desc'),
      ['archive', 'zz.txt', 'chain:svc.log', 'notes.txt', 'empty.txt', 'chain:app.log'],
    ],
    [
      by('size', 'desc'),
      ['archive', 'chain:app.log', 'zz.txt', 'notes.txt', 'chain:svc.log', 'empty.txt'],
    ],
    [
      by('size', 'asc'),
      ['archive', 'chain:svc.log', 'notes.txt', 'zz.txt', 'chain:app.log', 'empty.txt'],
    ],
    [
      by('date', 'desc'),
      ['archive', 'chain:app.log', 'notes.txt', 'zz.txt', 'empty.txt', 'chain:svc.log'],
    ],
    [
      by('date', 'asc'),
      ['archive', 'chain:svc.log', 'empty.txt', 'zz.txt', 'notes.txt', 'chain:app.log'],
    ],
  ])('sorts the chains among the files, parts hidden: %o', (options, expected) => {
    expect(names(shownChildren(directory(DIR, entries, chains), options))).toEqual(expected);
  });

  it('sorts the listed entries with the mode off, parts and all', () => {
    const rows = shownChildren(directory(DIR, entries, chains), by('size', 'desc', false));

    expect(names(rows)).toEqual([
      'archive',
      'app.log',
      'app.log.1',
      'app.log.2.gz',
      'zz.txt',
      'notes.txt',
      'svc.log',
      'svc.log.1',
      'empty.txt',
    ]);
  });

  it('keeps the folders and files the same objects in any order', () => {
    const dir = directory(DIR, entries, chains);

    const rows = shownChildren(dir, by('date', 'asc'));

    for (const row of rows.filter(isNodeRow)) expect(dir.children).toContain(row);
  });

  // The two tie on name, and on date when neither has a time.
  it.each([by('name', 'asc'), by('name', 'desc'), by('date', 'asc'), by('date', 'desc')])(
    'puts a chain of too many parts before its file of the same name: %o',
    (options) => {
      const many = [file('big.log'), file('big.log.1')];
      const rows = shownChildren(
        directory(DIR, many, [chain('big.log', [], { too_many_parts: true })]),
        options,
      );

      const chainAt = names(rows).indexOf('chain:big.log');
      expect(names(rows)[chainAt + 1]).toBe('big.log');
    },
  );
});

describe('shownChildren on a directory that mixes chains with look-alikes', () => {
  const dir = directory(LOG_DIR, logDirEntries(), logDirChains());
  const rows = shownChildren(dir, ON);
  const partNames = new Set(logDirChains().flatMap((c) => c.parts));

  it('shows exactly the seven chains', () => {
    expect(rows.filter(isChainRow).map((row) => row.chain.name)).toEqual(CHAIN_NAMES);
  });

  it('shows every folder and every file of no chain', () => {
    const shown = new Set(names(rows));
    for (const name of [...DIRECTORY_NAMES, ...SINGLE_FILE_NAMES]) expect(shown).toContain(name);
  });

  it('hides only parts of chains', () => {
    const hidden = dir.children.filter((child) => !rows.includes(child));

    expect(hidden.length).toBe(partNames.size);
    expect(hidden.every((child) => partNames.has(child.name))).toBe(true);
  });

  it('shows no part of a chain on its own', () => {
    const shownFiles = rows.filter(isNodeRow).map((row) => row.name);

    expect(shownFiles.filter((name) => partNames.has(name))).toEqual([]);
  });

  it('shows 26 rows: 9 folders, then the chains among the 10 other files by name', () => {
    expect(rows).toHaveLength(26);
    expect(names(rows).slice(9)).toEqual([
      'chain:access.log',
      'agent-bpf.log',
      'chain:agent.log',
      'agentctl.log',
      'agentd.log',
      'chain:boot.msg',
      'chain:choices.log',
      'failures',
      'failures.1',
      'fonts.log',
      'chain:kernel.log',
      'lastseen',
      'chain:messages',
      'chain:pkg.log',
      'resolver',
      'sessions',
      'sessions.1',
    ]);
  });
});

describe("a chain row's time", () => {
  /** A file of `DIR` last modified at `time`, or with no time. */
  function timedFile(name: string, time: string | null): TreeEntry {
    return treeEntry(`${DIR}/${name}`, 'file', { is_text: true, size: 10, modified_at: time });
  }

  /** The time of the chain row of `app.log` among `entries`, its parts `parts`. */
  function chainTime(entries: TreeEntry[], parts = ['app.log.2.gz', 'app.log.1', 'app.log']) {
    const rows = shownChildren(directory(DIR, entries, [chain('app.log', parts)]), ON);
    return rows.find(isChainRow)?.modifiedAt;
  }

  it('is the newest time of its parts', () => {
    const time = chainTime([
      timedFile('app.log', '2026-10-08T12:31:07.123456Z'),
      timedFile('app.log.1', '2026-10-07T23:59:59.000000Z'),
      timedFile('app.log.2.gz', '2026-10-06T23:59:59.000000Z'),
    ]);

    expect(time).toBe('2026-10-08T12:31:07.123456Z');
  });

  it('skips a part without a time', () => {
    const time = chainTime([
      timedFile('app.log', null),
      timedFile('app.log.1', '2026-10-07T23:59:59.000000Z'),
      timedFile('app.log.2.gz', '2026-10-06T23:59:59.000000Z'),
    ]);

    expect(time).toBe('2026-10-07T23:59:59.000000Z');
  });

  it('is null when no part has a time', () => {
    expect(chainTime([timedFile('app.log', null), timedFile('app.log.1', null)])).toBeNull();
  });

  it('is null when the tree lists none of its parts', () => {
    expect(chainTime([timedFile('notes.txt', '2026-10-08T00:00:00Z')])).toBeNull();
  });

  it('counts no file the listing does not name as a part, and no folder', () => {
    const time = chainTime([
      treeEntry(`${DIR}/app.log.2.gz`, 'directory', { modified_at: '2026-10-09T08:00:00Z' }),
      timedFile('app.log', '2026-10-08T12:31:07.123456Z'),
      timedFile('app.log.1.gz', '2026-10-09T09:00:00Z'),
      timedFile('notes.txt', '2026-10-09T10:00:00Z'),
    ]);

    expect(time).toBe('2026-10-08T12:31:07.123456Z');
  });

  // Text order would put 14:00+02:00 (12:00 UTC) after 13:00 UTC.
  it('compares the times, not their text', () => {
    const time = chainTime([
      timedFile('app.log', '2026-10-08T14:00:00+02:00'),
      timedFile('app.log.1', '2026-10-08T13:00:00Z'),
    ]);

    expect(time).toBe('2026-10-08T13:00:00Z');
  });
});

describe('chainBadges', () => {
  const texts = (entry: ChainEntry, described: Parameters<typeof chainBadges>[1] = null) =>
    chainBadges(entry, described).map((badge) => badge.text);

  it('marks a chain with its part count', () => {
    expect(texts(chain('app.log', ['app.log.1', 'app.log']))).toEqual(['chain · 2']);
  });

  it('marks an indexed chain idx', () => {
    expect(texts(chain('app.log', ['app.log.1', 'app.log'], { is_indexed: true }))).toEqual([
      'chain · 2',
      'idx',
    ]);
  });

  it('says how many parts are missing and names them in the tooltip', () => {
    const badges = chainBadges(
      chain('pkg.log', ['pkg.log.4.gz', 'pkg.log.1', 'pkg.log'], {
        missing: ['pkg.log.2', 'pkg.log.3'],
        missing_count: 2,
      }),
      null,
    );

    const missing = badges.find((badge) => badge.text === '2 missing');
    expect(missing?.tone).toBe('warning');
    expect(missing?.title).toBe('Missing parts: pkg.log.2, pkg.log.3');
  });

  it('counts missing parts beyond the names the listing gives', () => {
    const names100 = Array.from({ length: 100 }, (_, i) => `x.${i + 2}`);
    const badges = chainBadges(
      chain('x', ['x.300', 'x.1', 'x'], { missing: names100, missing_count: 298 }),
      null,
    );

    const missing = badges.find((badge) => badge.text === '298 missing');
    expect(missing?.title.endsWith('and 278 more')).toBe(true);
    expect(missing?.title).toContain('x.21,');
    expect(missing?.title).not.toContain('x.22,');
  });

  it('marks unreadable parts and names them', () => {
    const badges = chainBadges(
      chain('app.log', ['app.log.1', 'app.log'], { unreadable: ['app.log.1'] }),
      null,
    );

    expect(badges.find((badge) => badge.text === '1 unreadable')).toMatchObject({
      tone: 'danger',
      title: 'Parts that cannot be read: app.log.1',
    });
  });

  it('marks a chain of too many parts without a part count', () => {
    expect(texts(chain('big.log', [], { too_many_parts: true }))).toEqual([
      'chain',
      'too many parts',
    ]);
  });

  it('marks a chain a description found invalid, with its reasons', () => {
    const badges = chainBadges(chain('app.log', ['app.log.1', 'app.log']), {
      state: 'invalid',
      reasons: [
        {
          code: 'active_not_last',
          message: 'app.log starts before app.log.1',
          overlap_ms: null,
          parts: ['app.log', 'app.log.1'],
        },
        {
          code: 'no_timestamps',
          message: 'app.log.1 has no timestamps',
          overlap_ms: null,
          parts: ['app.log.1'],
        },
      ],
    });

    expect(badges.at(-1)).toEqual({
      text: 'invalid',
      tone: 'danger',
      title: 'app.log starts before app.log.1\napp.log.1 has no timestamps',
    });
  });

  it('marks nothing more for a chain a description found ready or pending', () => {
    const entry = chain('app.log', ['app.log.1', 'app.log']);

    expect(texts(entry, { state: 'ready', reasons: [] })).toEqual(['chain · 2']);
    expect(texts(entry, { state: 'pending', reasons: [] })).toEqual(['chain · 2']);
  });
});

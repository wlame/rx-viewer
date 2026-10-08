import { describe, expect, it } from 'vitest';
import { fastestOf } from '../testing/timing';
import type { ChainPart, ChainPiece, ChainSamplesResponse } from '../types';
import { LINES_PER_PAGE, STREAM_LINES_PER_PAGE } from './slidingWindow';
import {
  LOCAL_NUMBERING_BASE,
  chainPageSize,
  flattenPieces,
  globalPage,
  learnCounts,
  nearestSameText,
  pageBase,
  pendingEnds,
  pendingPage,
  readChainTimeAnswer,
  readGlobalWindow,
} from './chainWindow';

function part(name: string, fields: Partial<ChainPart> = {}): ChainPart {
  return {
    name,
    path: `/l/${name}`,
    is_active: false,
    key: null,
    compression_format: null,
    size: 100,
    modified_at: '2026-10-01T00:00:00.000000Z',
    is_indexed: true,
    line_count: null,
    first_ms: null,
    last_ms: null,
    max_ms: null,
    max_is_bound: false,
    global_start: null,
    time_format: null,
    day_first: null,
    example: null,
    duplicates: [],
    ...fields,
  };
}

/** A piece of `count` lines of `name` from its line `local`, global `global` (-1 before ready). */
function piece(
  name: string,
  local: number,
  count: number,
  global: number,
  edges: Partial<Pick<ChainPiece, 'part_start' | 'part_end'>> = {},
): ChainPiece {
  return {
    part: name,
    first_local_line: local,
    first_global_line: global,
    lines: Array.from({ length: count }, (_, i) => `${name} ${local + i}`),
    line_timestamps: Array.from({ length: count }, (_, i) => 1000 * (local + i)),
    part_start: local === 1,
    part_end: false,
    cli_command: `rx samples /l/${name} --lines=${local}-${local + count - 1}`,
    ...edges,
  };
}

function answer(
  samples: Record<string, ChainPiece[] | null>,
  context = 0,
): Pick<ChainSamplesResponse, 'samples' | 'before_context' | 'after_context'> {
  return { samples, before_context: context, after_context: context };
}

describe('flattenPieces', () => {
  it('numbers a ready chain by global line and keeps each line part and local line', () => {
    const lines = flattenPieces([piece('a.1', 9, 2, 9), piece('a', 1, 1, 11)], { kind: 'global' });

    expect(lines).toEqual([
      { lineNumber: 9, content: 'a.1 9', timestampMs: 9000, part: 'a.1', localLine: 9 },
      { lineNumber: 10, content: 'a.1 10', timestampMs: 10000, part: 'a.1', localLine: 10 },
      { lineNumber: 11, content: 'a 1', timestampMs: 1000, part: 'a', localLine: 1 },
    ]);
  });

  it('numbers a pending chain from each part base, one apart across an edge', () => {
    const bases = new Map([
      ['a.1', 500],
      ['a', 510],
    ]);
    const lines = flattenPieces([piece('a.1', 9, 2, -1), piece('a', 1, 2, -1)], {
      kind: 'local',
      bases,
    });

    expect(lines.map((l) => [l.lineNumber, l.part, l.localLine])).toEqual([
      [509, 'a.1', 9],
      [510, 'a.1', 10],
      [511, 'a', 1],
      [512, 'a', 2],
    ]);
  });

  it('gives a line without a timestamp null, and none when the part has no format', () => {
    const noFormat = { ...piece('a', 1, 1, 1), line_timestamps: null };
    const oneNull = { ...piece('a', 2, 1, 2), line_timestamps: [null] };

    const lines = flattenPieces([noFormat, oneNull], { kind: 'global' });

    expect(lines[0].timestampMs).toBeNull();
    expect(lines[1].timestampMs).toBeNull();
  });

  // The editor writes a line's number into its gutter as markup.
  const notWholeNumbers: [string, unknown][] = [
    ['markup', '<b>x</b>'],
    ['a fraction', 1.5],
    ['past the safe integers', 2 ** 60],
  ];
  const numberings = [
    { kind: 'global' },
    { kind: 'local', bases: new Map([['a.1', LOCAL_NUMBERING_BASE]]) },
  ] as const;

  it.each(notWholeNumbers)('refuses a piece whose first local line is %s', (_, value) => {
    const bad = { ...piece('a.1', 1, 2, 1), first_local_line: value as number };
    for (const numbering of numberings) {
      expect(() => flattenPieces([piece('a.1', 3, 1, 3), bad], numbering)).toThrow(
        'The samples answer numbers the lines of a.1 with a first_local_line that is not a whole number',
      );
    }
  });

  // A part's lines are numbered from 1, as rx samples numbers them.
  it.each([0, -1])('refuses a piece whose first local line is %d', (value) => {
    const bad = { ...piece('a.1', 1, 2, 1), first_local_line: value };
    for (const numbering of numberings) {
      expect(() => flattenPieces([bad], numbering)).toThrow(
        'The samples answer numbers the lines of a.1 from a first_local_line below 1',
      );
    }
  });

  it.each(notWholeNumbers)('refuses a piece whose first global line is %s', (_, value) => {
    const bad = { ...piece('a.1', 1, 2, 1), first_global_line: value as number };
    for (const numbering of numberings) {
      expect(() => flattenPieces([bad], numbering)).toThrow('first_global_line');
    }
  });
});

describe('learnCounts', () => {
  it('learns the line count of a part a piece ends', () => {
    const counts = learnCounts(new Map(), [
      piece('a.1', 9, 2, -1, { part_end: true }),
      piece('a', 1, 2, -1),
    ]);
    expect(counts).toEqual(new Map([['a.1', 10]]));
  });
});

describe('readGlobalWindow', () => {
  it('reads a range that the chain fills, across a part edge', () => {
    const window = readGlobalWindow(
      answer({ '9-12': [piece('a.1', 9, 2, 9), piece('a', 1, 2, 11)] }),
    );

    expect(window.lines.map((l) => l.lineNumber)).toEqual([9, 10, 11, 12]);
    expect(window).toMatchObject({ reachedStart: false, reachedEnd: false, lineCount: null });
  });

  it('reaches the end when a range comes back short, and gives the line count', () => {
    const window = readGlobalWindow(answer({ '11-20': [piece('a', 1, 3, 11)] }));
    expect(window).toMatchObject({ reachedEnd: true, lineCount: 13 });
  });

  it('reaches the start at line 1, and reads a line with its context', () => {
    const window = readGlobalWindow(answer({ '2': [piece('a.1', 1, 4, 1)] }, 2));
    expect(window).toMatchObject({ reachedStart: true, reachedEnd: false });
  });

  it('reads a null sample as no line', () => {
    expect(readGlobalWindow(answer({ '50-60': null })).lines).toEqual([]);
  });
});

describe('readChainTimeAnswer', () => {
  it('finds the line a time names, with the window around it', () => {
    const value = '2026-10-01T00:00:10.000Z';
    const found = readChainTimeAnswer(
      {
        ...answer({ [value]: [piece('a.1', 9, 2, 9), piece('a', 1, 1, 11)] }, 1),
        timestamps: { [value]: 10 },
      },
      value,
    );

    expect(found.found).toBe(true);
    expect(found.found && found.line).toBe(10);
    expect(found.found && found.window.lines.map((l) => l.lineNumber)).toEqual([9, 10, 11]);
  });

  it('finds no line for -1', () => {
    const value = '2030-01-01T00:00:00.000Z';
    expect(
      readChainTimeAnswer({ ...answer({ [value]: null }), timestamps: { [value]: -1 } }, value),
    ).toEqual({ found: false });
  });
});

describe('chainPageSize', () => {
  const parts = [
    part('a.4.gz', { compression_format: 'gzip' }),
    part('a.3.bz2', { compression_format: 'bz2' }),
    part('a.2.zst', { compression_format: 'zstd' }),
    part('a.1'),
    part('a', { is_active: true }),
  ];

  it.each([
    [['a.4.gz'], STREAM_LINES_PER_PAGE],
    [['a.3.bz2'], STREAM_LINES_PER_PAGE],
    // A part does not say whether its zstd is seekable; zstd pages as a stream.
    [['a.2.zst'], STREAM_LINES_PER_PAGE],
    [['a.1'], LINES_PER_PAGE],
    [['a.1', 'a'], LINES_PER_PAGE],
    [['a.2.zst', 'a.1'], STREAM_LINES_PER_PAGE],
  ])('pages %o by %i lines', (names, size) => {
    expect(chainPageSize(parts, names)).toBe(size);
  });

  // The held lines of a chain of 10,000 parts can come from many parts:
  // a page's size costs one pass over the parts and one over the names,
  // not one over the names for each part.
  it('sizes a page by the names of 10,000 plain parts in a few milliseconds', () => {
    const many = Array.from({ length: 10_000 }, (_, i) => part(`a.${i + 1}`));
    const names = many.map((p) => p.name);
    let size = 0;

    const elapsed = fastestOf(3, () => {
      size = chainPageSize(many, names);
    });

    expect(size).toBe(LINES_PER_PAGE);
    expect(elapsed).toBeLessThan(20);
  });
});

describe('globalPage', () => {
  // a.1.gz holds global lines 1-3000, a lines 3001 on.
  const parts = [
    part('a.1.gz', { compression_format: 'gzip', global_start: 1, line_count: 3000 }),
    part('a', { is_active: true, global_start: 3001, line_count: null }),
  ];

  it('pages after the held lines by 5,000 when the next 1,000 lines touch a stream part', () => {
    expect(globalPage({ startLine: 1, endLine: 2500 }, 'after', parts)).toEqual({
      first: 2501,
      last: 7500,
      size: STREAM_LINES_PER_PAGE,
    });
  });

  it('pages after them by 1,000 inside a plain part', () => {
    expect(globalPage({ startLine: 3001, endLine: 5000 }, 'after', parts)).toEqual({
      first: 5001,
      last: 6000,
      size: LINES_PER_PAGE,
    });
  });

  it('pages before them down to line 1', () => {
    expect(globalPage({ startLine: 3500, endLine: 4000 }, 'before', parts)).toEqual({
      first: 1,
      last: 3499,
      size: STREAM_LINES_PER_PAGE,
    });
  });
});

describe('pendingPage', () => {
  const parts = [
    part('a.3.gz', { compression_format: 'gzip' }),
    part('a.2', { size: 0 }),
    part('a.1'),
    part('a', { is_active: true }),
  ];

  it('continues inside the part', () => {
    expect(pendingPage({ part: 'a.1', localLine: 10 }, 'after', parts, new Map())).toEqual({
      part: 'a.1',
      lines: `11-${10 + LINES_PER_PAGE}`,
    });
    expect(pendingPage({ part: 'a.1', localLine: 1500 }, 'before', parts, new Map())).toEqual({
      part: 'a.1',
      lines: `500-1499`,
    });
  });

  it('crosses into the next part with lines at a known end, past an empty part', () => {
    const counts = new Map([['a.3.gz', 40]]);
    expect(pendingPage({ part: 'a.3.gz', localLine: 40 }, 'after', parts, counts)).toEqual({
      part: 'a.1',
      lines: `1-${LINES_PER_PAGE}`,
    });
  });

  it('pages a stream part by 5,000', () => {
    expect(pendingPage({ part: 'a.3.gz', localLine: 1 }, 'after', parts, new Map())).toEqual({
      part: 'a.3.gz',
      lines: `2-${1 + STREAM_LINES_PER_PAGE}`,
    });
  });

  it('pages back into the previous part by its last lines when its count is known', () => {
    const counts = new Map([['a.3.gz', 6000]]);
    expect(pendingPage({ part: 'a.1', localLine: 1 }, 'before', parts, counts)).toEqual({
      part: 'a.3.gz',
      lines: `1001-6000`,
    });
  });

  // `-1` with context counts back from the part end, and the answer
  // gives the part's last line, so its count.
  it('asks for the last lines of a previous part whose count is unknown', () => {
    expect(pendingPage({ part: 'a.1', localLine: 1 }, 'before', parts, new Map())).toEqual({
      part: 'a.3.gz',
      lines: '-1',
      beforeContext: 100,
      afterContext: 0,
    });
  });

  it('stays in the last part, which may grow, and stops before the first part', () => {
    const counts = new Map([['a', 5]]);
    expect(pendingPage({ part: 'a', localLine: 5 }, 'after', parts, counts)).toEqual({
      part: 'a',
      lines: `6-${5 + LINES_PER_PAGE}`,
    });
    expect(pendingPage({ part: 'a.3.gz', localLine: 1 }, 'before', parts, new Map())).toBeNull();
  });
});

describe('pageBase', () => {
  const bases = new Map([['a.1', LOCAL_NUMBERING_BASE]]);

  it('keeps the base of the part the window holds', () => {
    expect(pageBase(bases, new Map(), 'a.1', 'a.1', 'after')).toBe(LOCAL_NUMBERING_BASE);
  });

  it('puts the next part right after the end of the part before it', () => {
    expect(pageBase(bases, new Map([['a.1', 40]]), 'a.1', 'a', 'after')).toBe(
      LOCAL_NUMBERING_BASE + 40,
    );
  });

  it('puts the previous part right before the start of the part after it', () => {
    expect(pageBase(bases, new Map([['a.2', 70]]), 'a.1', 'a.2', 'before')).toBe(
      LOCAL_NUMBERING_BASE - 70,
    );
  });

  it('gives none while a count it needs is unknown', () => {
    expect(pageBase(bases, new Map(), 'a.1', 'a', 'after')).toBeNull();
  });
});

describe('pendingEnds', () => {
  const parts = [part('a.2', { size: 0 }), part('a.1'), part('a', { is_active: true })];
  const line = (name: string, local: number) => ({
    lineNumber: local,
    content: '',
    part: name,
    localLine: local,
  });

  it('reaches the start at line 1 of the first part with lines', () => {
    expect(pendingEnds([line('a.1', 1), line('a.1', 2)], parts, new Map()).reachedStart).toBe(true);
    expect(pendingEnds([line('a.1', 2)], parts, new Map()).reachedStart).toBe(false);
    expect(pendingEnds([line('a', 1)], parts, new Map()).reachedStart).toBe(false);
  });

  it('reaches the end at the known last line of the last part with lines', () => {
    expect(pendingEnds([line('a', 7)], parts, new Map([['a', 7]])).reachedEnd).toBe(true);
    expect(pendingEnds([line('a', 6)], parts, new Map([['a', 7]])).reachedEnd).toBe(false);
    expect(pendingEnds([line('a.1', 9)], parts, new Map([['a.1', 9]])).reachedEnd).toBe(false);
  });
});

describe('nearestSameText', () => {
  /** Held lines 101-110 whose texts repeat: `a` at 103, 107 and 110, `b` at 105. */
  const held = ['x', 'x', 'a', 'x', 'b', 'x', 'a', 'x', 'x', 'a'].map((content, i) => ({
    lineNumber: 101 + i,
    content,
  }));

  it('finds the target itself when its text is the one asked', () => {
    expect(nearestSameText(held, 101, 105, 'b')).toBe(105);
  });

  it('finds the nearest line with the text on either side of the target', () => {
    expect(nearestSameText(held, 101, 104, 'a')).toBe(103);
    expect(nearestSameText(held, 101, 109, 'a')).toBe(110);
  });

  // The line a time names is the first at or after it, so the line asked
  // for is more often after it than before.
  it('prefers the line after the target when two are as near', () => {
    expect(nearestSameText(held, 101, 105, 'a')).toBe(107);
  });

  it('finds none for a text the held lines do not hold, or a target they do not hold', () => {
    expect(nearestSameText(held, 101, 105, 'zzz')).toBeNull();
    expect(nearestSameText(held, 101, 400, 'a')).toBeNull();
  });
});

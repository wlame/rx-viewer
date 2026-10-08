import { describe, expect, it } from 'vitest';
import {
  chainMatch,
  chainRef,
  chainSearchAnswer,
  mixedChainSearchAnswer,
} from '../testing/chainSearchAnswer';
import type { FileLine, FileMatch, SearchMatch, TraceResponse } from '../types';
import {
  chainMatchedLines,
  chainPlaceOf,
  matchedTabLines,
  chainPositionOf,
  chainTabMatches,
  isChainSearchAnswer,
  noChainLineTitle,
  opensChainTab,
  type ChainMatchPlace,
} from './chainSearch';

/** A `/v1/trace` answer: the same fields without chains. */
function traceAnswer(): TraceResponse {
  const { chains: _chains, ...rest } = chainSearchAnswer({
    files: { f1: '/logs/app.log' },
    matches: [chainMatch({ file: 'f1' })],
  });
  return { ...rest, matches: rest.matches.map(({ chain: _c, chain_line: _l, ...m }) => m) };
}

describe('isChainSearchAnswer', () => {
  it('reads an answer with a chains table as a chain search', () => {
    expect(isChainSearchAnswer(chainSearchAnswer())).toBe(true);
  });

  it('reads a trace answer as no chain search', () => {
    expect(isChainSearchAnswer(traceAnswer())).toBe(false);
  });
});

describe('chainPlaceOf', () => {
  const answer = mixedChainSearchAnswer();

  it('places a match of a ready chain at its chain line, in its part', () => {
    expect(chainPlaceOf(answer.matches[1], answer)).toEqual({
      handle: '/logs/app.log',
      name: 'app.log',
      state: 'ready',
      chainLine: 3500,
      part: 'app.log.1',
    });
  });

  it('gives a match of a pending chain no chain line', () => {
    expect(chainPlaceOf(answer.matches[3], answer)).toEqual({
      handle: '/logs/svc.log',
      name: 'svc.log',
      state: 'pending',
      chainLine: null,
      part: 'svc.log.1',
    });
  });

  it('gives a ready chain match without a line number no chain line', () => {
    const capped = chainSearchAnswer({
      files: { f1: '/logs/app.log.1' },
      chains: { c1: chainRef('/logs/app.log', ['f1'], 'ready') },
      matches: [chainMatch({ file: 'f1', absolute_line_number: -1, chain: 'c1', chain_line: -1 })],
    });

    expect(chainPlaceOf(capped.matches[0], capped)?.chainLine).toBeNull();
  });

  it('places a file searched on its own in no chain', () => {
    expect(chainPlaceOf(answer.matches[2], answer)).toBeNull();
  });

  it('places nothing of a trace answer in a chain', () => {
    const trace = traceAnswer();

    expect(chainPlaceOf(trace.matches[0], trace)).toBeNull();
  });

  it.each(['c9', '__proto__', 'toString'])(
    'places a match whose chain %s the table lacks in no chain',
    (chain) => {
      const odd = chainSearchAnswer({
        files: { f1: '/logs/app.log.1' },
        matches: [chainMatch({ file: 'f1', chain, chain_line: 5 })],
      });

      expect(chainPlaceOf(odd.matches[0], odd)).toBeNull();
    },
  );
});

describe('opensChainTab', () => {
  const place = (state: ChainMatchPlace['state']): ChainMatchPlace => ({
    handle: '/logs/app.log',
    name: 'app.log',
    state,
    chainLine: null,
    part: 'app.log.1',
  });

  it.each([
    { state: 'ready', isModeOn: true, expected: true },
    { state: 'pending', isModeOn: true, expected: true },
    // An invalid chain's tab shows no lines: the part opens as a file.
    { state: 'invalid', isModeOn: true, expected: false },
    // With chain mode off a chain's tab cannot open: the part opens as a file.
    { state: 'ready', isModeOn: false, expected: false },
    { state: 'pending', isModeOn: false, expected: false },
  ] as const)('a $state chain with the mode on $isModeOn: $expected', (row) => {
    expect(opensChainTab(place(row.state), row.isModeOn)).toBe(row.expected);
  });

  it('opens no chain tab for a file of its own', () => {
    expect(opensChainTab(null, true)).toBe(false);
  });
});

describe('chainPositionOf', () => {
  const answer = mixedChainSearchAnswer();

  it('goes to the global line a ready chain gives', () => {
    const place = chainPlaceOf(answer.matches[1], answer);
    if (!place) throw new Error('no place');

    expect(chainPositionOf(place, 500)).toEqual({ kind: 'global', line: 3500 });
  });

  it("goes to the part's own line while the chain gives no global line", () => {
    const place = chainPlaceOf(answer.matches[3], answer);
    if (!place) throw new Error('no place');

    expect(chainPositionOf(place, 7)).toEqual({ kind: 'local', part: 'svc.log.1', line: 7 });
  });
});

describe('chainTabMatches', () => {
  it("lists the chain's matches by part and the part's own line, and no other chain's", () => {
    const answer = mixedChainSearchAnswer();
    const localLine = (match: SearchMatch) => match.absolute_line_number;

    expect(chainTabMatches(answer, '/logs/app.log', localLine)).toEqual([
      { lineNumber: 12, part: 'app.log.2.gz', patternId: 'p1', pattern: 'timeout' },
      { lineNumber: 500, part: 'app.log.1', patternId: 'p1', pattern: 'timeout' },
    ]);
    expect(chainTabMatches(answer, '/logs/svc.log', localLine)).toEqual([
      { lineNumber: 7, part: 'svc.log.1', patternId: 'p1', pattern: 'timeout' },
    ]);
  });

  it('leaves out a match whose line is not known yet', () => {
    const answer = mixedChainSearchAnswer();

    const matches = chainTabMatches(answer, '/logs/app.log', (match) =>
      match.offset === 100 ? null : match.absolute_line_number,
    );

    expect(matches.map((m) => m.part)).toEqual(['app.log.1']);
  });

  it('lists nothing for a trace answer', () => {
    expect(chainTabMatches(traceAnswer(), '/logs/app.log', () => 1)).toEqual([]);
  });
});

describe('chainMatchedLines', () => {
  /** Held lines of two parts at the positions given, numbered from `first` in their parts. */
  function held(entries: [position: number, part: string, local: number][]): FileLine[] {
    return entries.map(([lineNumber, part, localLine]) => ({
      lineNumber,
      content: `LINE part=${part} local=${localLine}`,
      part,
      localLine,
    }));
  }

  const matches: FileMatch[] = [
    { lineNumber: 2999, part: 'app.log.2.gz', patternId: 'p1', pattern: 'x' },
    { lineNumber: 1, part: 'app.log.1', patternId: 'p1', pattern: 'x' },
    { lineNumber: 9, part: 'app.log', patternId: 'p1', pattern: 'x' },
  ];

  it('marks the held lines of the matched parts and lines at their global numbers', () => {
    const lines = held([
      [2999, 'app.log.2.gz', 2999],
      [3000, 'app.log.2.gz', 3000],
      [3001, 'app.log.1', 1],
      [3002, 'app.log.1', 2],
    ]);

    expect(chainMatchedLines(lines, matches)).toEqual([2999, 3001]);
  });

  // While the chain is pending a part's line L sits at its base plus L;
  // the mark follows the line, whatever its position.
  it('marks the same lines at their positions while the chain is pending', () => {
    const base = 1_000_000_000_000;
    const lines = held([
      [base + 2999, 'app.log.2.gz', 2999],
      [base + 3000, 'app.log.2.gz', 3000],
      [base + 3001, 'app.log.1', 1],
    ]);

    expect(chainMatchedLines(lines, matches)).toEqual([base + 2999, base + 3001]);
  });

  it("marks no line of another part with the matched line's number", () => {
    const lines = held([
      [1, 'app.log.2.gz', 1],
      [9, 'app.log.2.gz', 9],
    ]);

    expect(chainMatchedLines(lines, matches)).toEqual([]);
  });

  it('marks nothing without matches', () => {
    expect(chainMatchedLines(held([[1, 'app.log.1', 1]]), [])).toEqual([]);
  });

  it('marks nothing for a match that names no part', () => {
    const lines = held([[1, 'app.log.1', 1]]);

    expect(chainMatchedLines(lines, [{ lineNumber: 1, patternId: 'p1', pattern: 'x' }])).toEqual(
      [],
    );
  });
});

describe('matchedTabLines', () => {
  const lines: FileLine[] = [
    { lineNumber: 3001, content: 'a', part: 'app.log.1', localLine: 1 },
    { lineNumber: 3002, content: 'b', part: 'app.log.1', localLine: 2 },
  ];

  it("marks a file's matches at their lines", () => {
    const marks = [{ lineNumber: 2, patternId: 'p1', pattern: 'x' }];

    expect(matchedTabLines({ lines, chain: undefined }, marks)).toEqual([2]);
  });

  it("marks a chain's matches at the held lines of their parts", () => {
    const marks = [{ lineNumber: 2, part: 'app.log.1', patternId: 'p1', pattern: 'x' }];
    const tab = { lines, chain: { numbering: 'global' as const } };

    expect(matchedTabLines(tab, marks)).toEqual([3002]);
  });
});

describe('noChainLineTitle', () => {
  const place = (state: ChainMatchPlace['state']): ChainMatchPlace => ({
    handle: '/logs/app.log',
    name: 'app.log',
    state,
    chainLine: null,
    part: 'app.log.1',
  });

  it.each([
    {
      state: 'pending',
      expected:
        'app.log.1, a part of the log chain app.log: no line in the chain while its parts are being indexed',
    },
    // A ready chain numbers every match the search numbered; this one the
    // search left without a line number (a capped scan of a part).
    {
      state: 'ready',
      expected:
        'app.log.1, a part of the log chain app.log: the search gave this match no line number, so it has no line in the chain',
    },
    {
      state: 'invalid',
      expected:
        'app.log.1, a part of the log chain app.log: no line in the chain, which is invalid',
    },
  ] as const)('says why a match of a $state chain has no chain line', ({ state, expected }) => {
    expect(noChainLineTitle(place(state))).toBe(expected);
  });
});

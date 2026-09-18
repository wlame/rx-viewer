import { describe, expect, it } from 'vitest';
import { matchedSpans, matchesIn } from './regexMatches';

function positions(text: string, regex: RegExp): Array<[number, string]> {
  return [...matchesIn(text, regex)].map((m) => [m.index, m[0]]);
}

describe('matchesIn', () => {
  it('returns every match left to right', () => {
    expect(positions('id=1 id=22', /id=(\d+)/g)).toEqual([
      [0, 'id=1'],
      [5, 'id=22'],
    ]);
  });

  it('steps past an empty match instead of matching at the same index again', () => {
    expect(positions('a12b', /\d*/g)).toEqual([
      [0, ''],
      [1, '12'],
      [3, ''],
      [4, ''],
    ]);
  });

  it('steps over a whole surrogate pair after an empty match with the u flag', () => {
    expect(positions('😀', /x?/gu)).toEqual([
      [0, ''],
      [2, ''],
    ]);
  });

  it('accepts a regex without the g flag', () => {
    expect(positions('aa', /a/)).toEqual([
      [0, 'a'],
      [1, 'a'],
    ]);
  });

  it('neither reads nor moves the lastIndex of the regex it is given', () => {
    const regex = /a/g;
    regex.lastIndex = 1;
    expect(positions('aa', regex)).toEqual([
      [0, 'a'],
      [1, 'a'],
    ]);
    expect(regex.lastIndex).toBe(1);
  });
});

describe('matchedSpans', () => {
  const at = (text: string, pattern: string) =>
    matchedSpans(text, new RegExp(pattern, 'g')).map((s) => [s.start, s.end, s.text]);

  it('takes the outer group and leaves out a group nested in it', () => {
    expect(at('xab', '((a)b)')).toEqual([[1, 3, 'ab']]);
  });

  it('gives no span to a group that took no part in the match', () => {
    expect(at('ac', 'a(b)?(c)')).toEqual([[1, 2, 'c']]);
  });
});

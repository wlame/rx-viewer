import { describe, expect, it } from 'vitest';
import type { FileLine, OpenFile } from '../types';
import {
  checkShownLine,
  fileLineNotice,
  heldLineAt,
  knownInZone,
  nearestKnownLine,
  type KnownLine,
} from './knownLine';

const LINE: Pick<FileLine, 'content' | 'timestampMs'> = {
  content: 'B local=500',
  timestampMs: 1000,
};

describe('checkShownLine', () => {
  it.each<[string, Pick<FileLine, 'content' | 'timestampMs'> | null, KnownLine, string]>([
    ['the known text at the known time', LINE, { text: 'B local=500', timeMs: 1000 }, 'same'],
    ['the known text, the time unknown', LINE, { text: 'B local=500', timeMs: null }, 'same'],
    // Two lines may hold one text (a blank line, a repeated frame), never at one time as well.
    ['the known text at another time', LINE, { text: 'B local=500', timeMs: 9 }, 'other'],
    // A time the backend did not compute is no other time: the text decides.
    [
      'the known text on a line without a time',
      { content: 'B local=500', timestampMs: null },
      { text: 'B local=500', timeMs: 1000 },
      'same',
    ],
    ['other text at the known time', LINE, { text: 'C local=500', timeMs: 1000 }, 'other'],
    ['the known time, the text unknown', LINE, { text: null, timeMs: 1000 }, 'same'],
    ['another time, the text unknown', LINE, { text: null, timeMs: 2000 }, 'other'],
    [
      'no time where a time is known',
      { content: 'x', timestampMs: null },
      { text: null, timeMs: 1 },
      'other',
    ],
    ['no line held where the text is known', null, { text: 'B local=500', timeMs: null }, 'other'],
    ['no line held where the time is known', null, { text: null, timeMs: 1000 }, 'other'],
    ['a line where nothing is known', LINE, { text: null, timeMs: null }, 'unknown'],
    ['no line where nothing is known', null, { text: null, timeMs: null }, 'unknown'],
  ])('reads %s', (_name, shown, known, expected) => {
    expect(checkShownLine(shown, known)).toBe(expected);
  });

  it('reads a line of a chain as the known one only at the known part and line', () => {
    const shown = { ...LINE, part: 'app.log.1', localLine: 500 };
    const known = (part: string, line: number): KnownLine => ({
      text: null,
      timeMs: 1000,
      place: { part, line },
    });

    expect(checkShownLine(shown, known('app.log.1', 500))).toBe('same');
    expect(checkShownLine(shown, known('app.log.2.gz', 500))).toBe('other');
    expect(checkShownLine(shown, known('app.log.1', 501))).toBe('other');
    expect(checkShownLine(shown, { text: null, timeMs: null, place: { part: 'x', line: 1 } })).toBe(
      'unknown',
    );
  });
});

describe('knownInZone', () => {
  const known: KnownLine = { text: 'B local=500', timeMs: 1000 };

  it('keeps the time of a line read in the zone the shown line is read in', () => {
    expect(knownInZone(known, '+02:00', '+02:00')).toEqual(known);
    expect(knownInZone(known, null, null)).toEqual(known);
  });

  // A zone moves every time and never a text.
  it('drops the time of a line read in another zone, and keeps its text', () => {
    expect(knownInZone(known, '+02:00', null)).toEqual({ text: 'B local=500', timeMs: null });
    expect(knownInZone(known, null, 'UTC')).toEqual({ text: 'B local=500', timeMs: null });
  });
});

describe('nearestKnownLine', () => {
  /** Held lines 101-110 whose texts repeat: `a` at 103, 107 and 110, `b` at 105; line n at second n. */
  const held = ['x', 'x', 'a', 'x', 'b', 'x', 'a', 'x', 'x', 'a'].map((content, i) => ({
    lineNumber: 101 + i,
    content,
    timestampMs: (101 + i) * 1000,
    localLine: 1 + i,
  }));
  const text = (content: string): KnownLine => ({ text: content, timeMs: null });

  it('finds the target itself when it is the known line', () => {
    expect(nearestKnownLine(held, 101, 105, text('b'))).toBe(105);
  });

  it('finds the nearest line with the known text on either side of the target', () => {
    expect(nearestKnownLine(held, 101, 104, text('a'))).toBe(103);
    expect(nearestKnownLine(held, 101, 109, text('a'))).toBe(110);
  });

  // The line a time names is the first at or after it, so the line asked
  // for is more often after it than before.
  it('prefers the line after the target when two are as near', () => {
    expect(nearestKnownLine(held, 101, 105, text('a'))).toBe(107);
  });

  it('passes a nearer line with the known text at another time for the one at the known time', () => {
    expect(nearestKnownLine(held, 101, 105, { text: 'a', timeMs: 110_000 })).toBe(110);
    expect(nearestKnownLine(held, 101, 105, { text: 'a', timeMs: 104_000 })).toBeNull();
  });

  it('finds a line by its time at its line in a part when its text is unknown', () => {
    const known: KnownLine = { text: null, timeMs: 107_000, place: { part: 'p', line: 7 } };

    expect(nearestKnownLine(held, 101, 103, known)).toBe(107);
    expect(
      nearestKnownLine(held, 101, 103, { ...known, place: { part: 'p', line: 8 } }),
    ).toBeNull();
  });

  it('finds none for a text the held lines do not hold, a target they do not hold, or nothing known', () => {
    expect(nearestKnownLine(held, 101, 105, text('zzz'))).toBeNull();
    expect(nearestKnownLine(held, 101, 400, text('a'))).toBeNull();
    expect(nearestKnownLine(held, 101, 105, { text: null, timeMs: null })).toBeNull();
  });
});

describe('heldLineAt', () => {
  const tab = {
    startLine: 10,
    lines: [10, 11, 13].map((lineNumber) => ({ lineNumber, content: `L${lineNumber}` })),
  };

  it('finds a held line by its position, and none outside or in a gap', () => {
    expect(heldLineAt(tab, 11)?.content).toBe('L11');
    expect(heldLineAt(tab, 9)).toBeNull();
    expect(heldLineAt(tab, 12)).toBeNull();
    expect(heldLineAt(tab, 14)).toBeNull();
  });
});

describe('fileLineNotice', () => {
  function fileTab(contents: string[], error: string | null = null): OpenFile {
    return {
      name: 'app.log.1',
      startLine: 499,
      lines: contents.map((content, i) => ({ lineNumber: 499 + i, content })),
      error,
    } as OpenFile;
  }
  const known: KnownLine = { text: 'B local=500', timeMs: null };

  it('says nothing for the same line, for nothing known, or a tab that shows its own error', () => {
    expect(
      fileLineNotice(fileTab(['B local=499', 'B local=500']), 500, known, 'app.log'),
    ).toBeNull();
    expect(
      fileLineNotice(fileTab(['x', 'y']), 500, { text: null, timeMs: null }, 'app.log'),
    ).toBeNull();
    expect(fileLineNotice(fileTab([], 'not found'), 500, known, 'app.log')).toBeNull();
    expect(fileLineNotice(undefined, 500, known, 'app.log')).toBeNull();
  });

  it('says the line holds other text, or that the file holds no such line now', () => {
    expect(fileLineNotice(fileTab(['C local=499', 'C local=500']), 500, known, 'app.log')).toBe(
      'Line 500 of app.log.1 holds other text than app.log showed there: the file changed on disk',
    );
    expect(fileLineNotice(fileTab(['C local=499']), 500, known, 'app.log')).toBe(
      'app.log.1 holds no line 500 now, where app.log showed one: the file changed on disk',
    );
  });
});

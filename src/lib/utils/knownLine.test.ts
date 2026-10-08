import { describe, expect, it } from 'vitest';
import type { FileLine, OpenFile } from '../types';
import { checkShownLine, fileLineNotice, heldLineAt, type KnownLine } from './knownLine';

const LINE: Pick<FileLine, 'content' | 'timestampMs'> = {
  content: 'B local=500',
  timestampMs: 1000,
};

describe('checkShownLine', () => {
  it.each<[string, Pick<FileLine, 'content' | 'timestampMs'> | null, KnownLine, string]>([
    ['the known text', LINE, { text: 'B local=500', timeMs: 1000 }, 'same'],
    [
      'the known text at another time (a zone change)',
      LINE,
      { text: 'B local=500', timeMs: 9 },
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

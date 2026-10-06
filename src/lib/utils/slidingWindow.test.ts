import { describe, expect, it } from 'vitest';
import type { FileLine } from '../types';
import {
  HELD_PAGES,
  LINES_PER_PAGE,
  STREAM_LINES_PER_PAGE,
  addPage,
  editorLineAfterMove,
  linesPerPage,
  maxHeldLines,
} from './slidingWindow';

function linesFrom(first: number, last: number): FileLine[] {
  const lines: FileLine[] = [];
  for (let n = first; n <= last; n++) lines.push({ lineNumber: n, content: `LINE ${n}` });
  return lines;
}

const numbers = (lines: FileLine[]) => lines.map((l) => l.lineNumber);

describe('maxHeldLines', () => {
  it('holds a fixed number of pages', () => {
    expect(maxHeldLines(1000)).toBe(HELD_PAGES * 1000);
  });
});

describe('linesPerPage', () => {
  it.each([
    {
      kind: 'a plain file',
      file: { isCompressed: false, compressionFormat: null, fileType: null },
    },
    {
      kind: 'a plain file the index calls text',
      file: { isCompressed: false, compressionFormat: null, fileType: 'text' as const },
    },
    {
      kind: 'a seekable zstd file',
      file: { isCompressed: true, compressionFormat: 'zstd', fileType: 'seekable_zstd' as const },
    },
    {
      kind: 'a zstd file before its index says which kind',
      file: { isCompressed: true, compressionFormat: 'zstd', fileType: null },
    },
    {
      kind: 'a file of a format the viewer does not know',
      file: { isCompressed: true, compressionFormat: 'lz4', fileType: null },
    },
  ])('loads 1,000 lines a page for $kind', ({ file }) => {
    expect(linesPerPage(file)).toBe(LINES_PER_PAGE);
    expect(LINES_PER_PAGE).toBe(1000);
  });

  it.each([
    { format: 'gzip', fileType: null },
    { format: 'bz2', fileType: null },
    { format: 'xz', fileType: null },
    { format: 'gzip', fileType: 'compressed' as const },
    { format: 'zstd', fileType: 'compressed' as const },
  ])('loads 5,000 lines a page for a $format stream (index: $fileType)', ({ format, fileType }) => {
    const file = { isCompressed: true, compressionFormat: format, fileType };
    expect(linesPerPage(file)).toBe(STREAM_LINES_PER_PAGE);
    expect(STREAM_LINES_PER_PAGE).toBe(5000);
  });
});

describe('addPage', () => {
  it('appends a page after the held lines while under the cap', () => {
    const result = addPage(linesFrom(1, 10), linesFrom(11, 20), 'after', 50);
    expect(numbers(result.lines)).toEqual(numbers(linesFrom(1, 20)));
    expect(result.droppedBefore).toBe(false);
    expect(result.droppedAfter).toBe(false);
  });

  it('drops the lines at the start when a page after goes over the cap', () => {
    const result = addPage(linesFrom(1, 30), linesFrom(31, 40), 'after', 30);
    expect(numbers(result.lines)).toEqual(numbers(linesFrom(11, 40)));
    expect(result.droppedBefore).toBe(true);
    expect(result.droppedAfter).toBe(false);
  });

  it('drops the lines at the end when a page before goes over the cap', () => {
    const result = addPage(linesFrom(21, 50), linesFrom(11, 20), 'before', 30);
    expect(numbers(result.lines)).toEqual(numbers(linesFrom(11, 40)));
    expect(result.droppedBefore).toBe(false);
    expect(result.droppedAfter).toBe(true);
  });

  it('keeps one copy of a line the page repeats', () => {
    const result = addPage(linesFrom(1, 10), linesFrom(8, 12), 'after', 50);
    expect(numbers(result.lines)).toEqual(numbers(linesFrom(1, 12)));
  });

  it('changes nothing for an empty page', () => {
    const result = addPage(linesFrom(1, 30), [], 'after', 30);
    expect(numbers(result.lines)).toEqual(numbers(linesFrom(1, 30)));
    expect(result.droppedBefore).toBe(false);
  });
});

describe('editorLineAfterMove', () => {
  it('finds the same file line further up after lines at the start were dropped', () => {
    // Editor line 2501 showed file line 2501; the window now starts at 1001.
    expect(editorLineAfterMove(2501, 1, { startLine: 1001, lineCount: 5000 })).toBe(1501);
  });

  it('finds the same file line further down after lines were added at the start', () => {
    // Editor line 1 showed file line 4001; the window now starts at 3001.
    expect(editorLineAfterMove(1, 4001, { startLine: 3001, lineCount: 5000 })).toBe(1001);
  });

  it('answers null when the new window no longer holds that file line', () => {
    expect(editorLineAfterMove(10, 1, { startLine: 4500, lineCount: 1001 })).toBeNull();
    expect(editorLineAfterMove(10, 9000, { startLine: 1, lineCount: 1000 })).toBeNull();
  });
});

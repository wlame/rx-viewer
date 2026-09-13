import { describe, expect, it } from 'vitest';
import { readSamplesAnswer } from './sampleWindow';

/**
 * Answers below are what rx-go sends for the fixtures they name: every
 * line of the file reads `LINE <n>`, so a wrong number shows at a glance.
 * rx-go echoes the requested context and clamps each window on its own,
 * at line 1 and at the end of the file.
 */
function fileLines(first: number, last: number): string[] {
  const lines: string[] = [];
  for (let n = first; n <= last; n++) lines.push(`LINE ${n}`);
  return lines;
}

function answer(samples: Record<string, string[] | null>, context = 3) {
  return { samples, before_context: context, after_context: context };
}

describe('readSamplesAnswer', () => {
  it('numbers a range from its first line and keeps paging when it is full', () => {
    const window = readSamplesAnswer(answer({ '101-200': fileLines(101, 200) }));

    expect(window.lines[0]).toEqual({ lineNumber: 101, content: 'LINE 101' });
    expect(window.lines.at(-1)).toEqual({ lineNumber: 200, content: 'LINE 200' });
    expect(window.reachedStart).toBe(false);
    expect(window.reachedEnd).toBe(false);
    expect(window.lineCount).toBeNull();
  });

  it('reads a short range as the end of the file and counts its lines', () => {
    const window = readSamplesAnswer(answer({ '1-100': fileLines(1, 7) }));

    expect(window.lines.map((l) => l.lineNumber)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(window.reachedStart).toBe(true);
    expect(window.reachedEnd).toBe(true);
    expect(window.lineCount).toBe(7);
  });

  it('reads a null sample past the end as no lines and the end of the file', () => {
    const window = readSamplesAnswer(answer({ '8': null }));

    expect(window.lines).toEqual([]);
    expect(window.reachedEnd).toBe(true);
  });

  it('reads an empty file as no lines and zero lines counted', () => {
    const window = readSamplesAnswer(answer({ '1-1000': null }));

    expect(window.lines).toEqual([]);
    expect(window.reachedStart).toBe(true);
    expect(window.reachedEnd).toBe(true);
    expect(window.lineCount).toBe(0);
  });

  it('starts a line window at line 1 when the context reaches past it', () => {
    // seven.log, lines=-1&context=500: rx-go resolves -1 to 7 and still
    // reports before_context 500.
    const window = readSamplesAnswer(answer({ '7': fileLines(1, 7) }, 500));

    expect(window.lines.map((l) => l.lineNumber)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(window.lines.every((l) => l.content === `LINE ${l.lineNumber}`)).toBe(true);
    expect(window.reachedStart).toBe(true);
    expect(window.reachedEnd).toBe(true);
  });

  it('numbers a line window from the line minus its context', () => {
    const window = readSamplesAnswer(answer({ '5000': fileLines(4500, 5500) }, 500));

    expect(window.lines[0]).toEqual({ lineNumber: 4500, content: 'LINE 4500' });
    expect(window.lines.at(-1)).toEqual({ lineNumber: 5500, content: 'LINE 5500' });
    expect(window.reachedStart).toBe(false);
    expect(window.reachedEnd).toBe(false);
  });

  it('numbers a line window past the end from the line minus its context', () => {
    // seven.log, lines=10: the window 7-13 holds only line 7.
    const window = readSamplesAnswer(answer({ '10': ['LINE 7'] }));

    expect(window.lines).toEqual([{ lineNumber: 7, content: 'LINE 7' }]);
    expect(window.reachedEnd).toBe(true);
    expect(window.lineCount).toBe(7);
  });

  it('refuses a key that names neither a line nor a range', () => {
    expect(() => readSamplesAnswer(answer({ 'x-y': ['LINE 1'] }))).toThrow(/x-y/);
  });
});

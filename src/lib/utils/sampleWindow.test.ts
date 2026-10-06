import { describe, expect, it } from 'vitest';
import { readSamplesAnswer, readTimeAnswer } from './sampleWindow';

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

describe('readSamplesAnswer with line timestamps', () => {
  it('gives each line the effective timestamp the answer lists for it', () => {
    const window = readSamplesAnswer({
      ...answer({ '10': fileLines(8, 12) }, 2),
      line_timestamps: { '10': [1000, null, 3000, 3000, null] },
    });

    expect(window.lines.map((l) => l.timestampMs)).toEqual([1000, null, 3000, 3000, null]);
  });

  it('gives no timestamp when the file has no timestamp format', () => {
    const window = readSamplesAnswer({
      ...answer({ '1-3': fileLines(1, 3) }),
      line_timestamps: null,
    });

    expect(window.lines[0]).toEqual({ lineNumber: 1, content: 'LINE 1' });
  });
});

describe('readTimeAnswer', () => {
  const value = '2025-12-10T07:30:00.000Z';

  it('numbers the window around the line a time found', () => {
    const found = readTimeAnswer(
      {
        ...answer({ [value]: fileLines(4500, 5500) }, 500),
        timestamps: { [value]: 5000 },
        line_timestamps: { [value]: fileLines(4500, 5500).map((_, i) => 1_000_000 + i) },
      },
      value,
    );

    if (!found.found) throw new Error('expected a line');
    expect(found.line).toBe(5000);
    expect(found.window.lines[0]).toEqual({
      lineNumber: 4500,
      content: 'LINE 4500',
      timestampMs: 1_000_000,
    });
    expect(found.window.lines.at(-1)?.lineNumber).toBe(5500);
  });

  it('reads a time after the last line as no line', () => {
    const found = readTimeAnswer(
      { ...answer({ [value]: null }), timestamps: { [value]: -1 }, line_timestamps: null },
      value,
    );

    expect(found.found).toBe(false);
  });

  it('numbers a time range from its first line, without context', () => {
    const range = '07:30:00..07:30:01';
    const found = readTimeAnswer(
      { ...answer({ [range]: fileLines(70, 74) }, 3), timestamps: { [range]: 70 } },
      range,
    );

    if (!found.found) throw new Error('expected a line');
    expect(found.line).toBe(70);
    expect(found.window.lines.map((l) => l.lineNumber)).toEqual([70, 71, 72, 73, 74]);
  });

  it('refuses an answer that does not list the time asked', () => {
    expect(() => readTimeAnswer({ ...answer({}), timestamps: {} }, value)).toThrow(/07:30/);
  });
});

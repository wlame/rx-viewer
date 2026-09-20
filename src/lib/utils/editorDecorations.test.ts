import { describe, expect, it } from 'vitest';
import { HIDDEN_MARKER } from './processContent';
import {
  anomalyCategoryDecorations,
  hiddenMarkerDecorations,
  highlightedRangeDecorations,
  matchLineDecorations,
  paneDecorations,
  regexHighlightDecorations,
  toMonacoLine,
  type LineSource,
} from './editorDecorations';

/** A window holding file lines 101..110 in Monaco lines 1..10. */
const editorWindow = { startLine: 101, lineCount: 10 };

function lines(...text: string[]): LineSource {
  return {
    getLineCount: () => text.length,
    getLineContent: (n: number) => text[n - 1],
  };
}

function spans(decorations: { range: { startColumn: number; endColumn: number } }[]) {
  return decorations.map((d) => [d.range.startColumn, d.range.endColumn]);
}

describe('toMonacoLine', () => {
  it('maps a file line inside the window to its Monaco line', () => {
    expect(toMonacoLine(101, editorWindow)).toBe(1);
    expect(toMonacoLine(110, editorWindow)).toBe(10);
  });

  it('returns null for a file line the window does not hold', () => {
    expect(toMonacoLine(100, editorWindow)).toBeNull();
    expect(toMonacoLine(111, editorWindow)).toBeNull();
  });
});

describe('matchLineDecorations', () => {
  it('marks each matched line in the window and skips the rest', () => {
    const decorations = matchLineDecorations([99, 102, 105, 200], editorWindow);

    expect(decorations.map((d) => d.range.startLineNumber)).toEqual([2, 5]);
    expect(decorations[0].options.className).toBe('monaco-match-line');
  });
});

describe('highlightedRangeDecorations', () => {
  it('marks every line of the range that the window holds', () => {
    const decorations = highlightedRangeDecorations({ start: 108, end: 112 }, editorWindow);

    expect(decorations.map((d) => d.range.startLineNumber)).toEqual([8, 9, 10]);
  });

  it('returns nothing when no range is highlighted', () => {
    expect(highlightedRangeDecorations(null, editorWindow)).toEqual([]);
    expect(highlightedRangeDecorations(undefined, editorWindow)).toEqual([]);
  });
});

describe('anomalyCategoryDecorations', () => {
  const anomaly = {
    start_line: 103,
    end_line: 104,
    start_offset: 0,
    end_offset: 0,
    severity: 0.9,
    description: 'Python traceback',
    detector: 'traceback-python',
  };

  it('marks the lines of anomalies in the selected category only', () => {
    const anomalies = [
      { ...anomaly, category: 'log-traceback' },
      { ...anomaly, category: 'secrets', start_line: 106, end_line: 106 },
    ];

    const decorations = anomalyCategoryDecorations(
      anomalies,
      'log-traceback',
      { color: '#14b8a6', decorationClass: 'palette-4' },
      editorWindow,
    );

    expect(decorations.map((d) => d.range.startLineNumber)).toEqual([3, 4]);
    expect(decorations[0].options.className).toContain('monaco-anomaly-palette-4');
    expect(decorations[0].options.glyphMarginClassName).toContain('monaco-anomaly-palette-4-glyph');
    expect(decorations[0].options.glyphMarginHoverMessage).toMatchObject({
      value: expect.stringContaining('traceback-python'),
    });
  });
});

describe('regexHighlightDecorations', () => {
  it('highlights the whole match when the pattern has no group', () => {
    expect(spans(regexHighlightDecorations('ab', lines('xab ab')))).toEqual([
      [2, 4],
      [5, 7],
    ]);
  });

  it('highlights a captured group at its own position in the match', () => {
    expect(spans(regexHighlightDecorations('a.(a)', lines('aba')))).toEqual([[3, 4]]);
  });

  it('highlights the whole match of a pattern whose only paren is escaped', () => {
    expect(spans(regexHighlightDecorations('\\(x\\)', lines('f(x)')))).toEqual([[2, 5]]);
  });

  it('highlights only the captured groups when the pattern has them', () => {
    expect(spans(regexHighlightDecorations('user=(u\\d+)', lines('a user=u42 b')))).toEqual([
      [8, 11],
    ]);
  });

  it('stops on a pattern that can match the empty string', () => {
    expect(regexHighlightDecorations('x*', lines('abc')).length).toBeGreaterThan(0);
  });

  it('marks every match of a pattern that can match the empty string, empty ones included', () => {
    expect(spans(regexHighlightDecorations('x*', lines('axb')))).toEqual([
      [1, 1],
      [2, 3],
      [3, 3],
      [4, 4],
    ]);
  });

  it('returns nothing for a pattern that does not compile', () => {
    expect(regexHighlightDecorations('(', lines('abc'))).toEqual([]);
  });
});

describe('hiddenMarkerDecorations', () => {
  it('puts a marker on each hidden span, carrying the hidden text as its hover', () => {
    const text = `a${HIDDEN_MARKER}b${HIDDEN_MARKER}`;
    const hidden = new Map([
      ['1:0', 'secret1'],
      ['1:1', 'secret2'],
    ]);

    const decorations = hiddenMarkerDecorations('hide', lines(text), hidden);

    expect(spans(decorations)).toEqual([
      [2, 3],
      [4, 5],
    ]);
    expect(decorations[0].options.inlineClassName).toBe('monaco-hidden-marker-red');
    expect(decorations[1].options.hoverMessage).toEqual({ value: 'secret2' });
  });

  it('colors the markers blue in show-only mode', () => {
    const decorations = hiddenMarkerDecorations('show', lines(HIDDEN_MARKER), new Map());

    expect(decorations[0].options.inlineClassName).toBe('monaco-hidden-marker-blue');
  });
});

describe('paneDecorations', () => {
  const anomaly = {
    start_line: 105,
    end_line: 105,
    start_offset: 0,
    end_offset: 0,
    severity: 0.5,
    description: '',
    detector: 'secrets-scan',
    category: 'secrets',
  };
  const filter = { enabled: true, pattern: 'b', mode: 'highlight' as const, compiledRegex: /b/ };
  const nothingShown = {
    editorWindow,
    matchedFileLines: [],
    highlightedRange: null,
    anomalies: null,
    selectedCategory: null,
    filter: null,
    text: lines('abc', `a${HIDDEN_MARKER}c`),
    hiddenContent: new Map([['2:0', 'b']]),
  };

  it('marks the matched lines, the highlighted range and the selected category together', () => {
    const decorations = paneDecorations({
      ...nothingShown,
      matchedFileLines: [102],
      highlightedRange: { start: 103, end: 103 },
      anomalies: [anomaly, { ...anomaly, category: 'format', start_line: 106, end_line: 106 }],
      selectedCategory: {
        name: 'secrets',
        style: { color: '#0ea5e9', decorationClass: 'palette-0' },
      },
    });

    expect(decorations.map((d) => d.range.startLineNumber)).toEqual([2, 3, 5]);
  });

  it('marks no anomaly while no category is selected', () => {
    expect(paneDecorations({ ...nothingShown, anomalies: [anomaly] })).toEqual([]);
  });

  it.each([
    ['highlight', 'monaco-regex-highlight', 1],
    ['hide', 'monaco-hidden-marker-red', 2],
    ['show', 'monaco-hidden-marker-blue', 2],
  ] as const)('marks what a %s filter does on the line it does it', (mode, className, line) => {
    const decorations = paneDecorations({ ...nothingShown, filter: { ...filter, mode } });

    expect(decorations).toHaveLength(1);
    expect(decorations[0].range.startLineNumber).toBe(line);
    expect(decorations[0].options.inlineClassName).toBe(className);
  });

  it.each([
    ['disabled', { ...filter, enabled: false }],
    ['not compiled', { ...filter, compiledRegex: null }],
  ])('marks nothing for a filter that is %s', (_, inactive) => {
    expect(paneDecorations({ ...nothingShown, filter: inactive })).toEqual([]);
  });

  it('marks no filter result before the editor has text', () => {
    expect(paneDecorations({ ...nothingShown, filter, text: null })).toEqual([]);
  });
});

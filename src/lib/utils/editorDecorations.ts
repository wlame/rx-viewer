/**
 * The Monaco decorations the editor pane paints, built as plain data.
 *
 * The editor holds a window of the file: Monaco line 1 is file line
 * `startLine`, and `lineCount` lines are loaded. Builders that start from
 * file line numbers take that window and drop what falls outside it, so
 * the conversion happens in one place (`toMonacoLine`). Builders that
 * scan the editor's text take a `LineSource`, which a Monaco model
 * satisfies and a test can fake.
 *
 * The class names here are styled in components/editor/editorDecorations.css.
 */
import type * as Monaco from 'monaco-editor';
import type { AnomalyRangeResult, RegexFilter } from '../types';
import type { CategoryStyle } from './categoryStyle';
import type { GutterRun } from './chainZones';
import { HIDDEN_MARKER } from './processContent';
import { matchedSpans } from './regexMatches';

type Decoration = Monaco.editor.IModelDeltaDecoration;
type DecorationOptions = Monaco.editor.IModelDecorationOptions;

/** Monaco's MinimapPosition.Inline, spelled out so this module needs no Monaco runtime. */
const MINIMAP_INLINE = 1;

/** The part of the file the editor holds. */
export interface EditorWindow {
  /** File line number shown on Monaco line 1. */
  startLine: number;
  /** How many lines are loaded. */
  lineCount: number;
}

/** Read access to the editor's text; a Monaco model satisfies it. */
export interface LineSource {
  getLineCount(): number;
  getLineContent(lineNumber: number): string;
}

/** Maps a file line number to its Monaco line, or null when the window does not hold it. */
export function toMonacoLine(fileLine: number, editorWindow: EditorWindow): number | null {
  const monacoLine = fileLine - editorWindow.startLine + 1;
  return monacoLine >= 1 && monacoLine <= editorWindow.lineCount ? monacoLine : null;
}

function wholeLine(monacoLine: number, options: DecorationOptions): Decoration {
  return {
    range: { startLineNumber: monacoLine, startColumn: 1, endLineNumber: monacoLine, endColumn: 1 },
    options,
  };
}

function inlineSpan(
  lineNumber: number,
  startColumn: number,
  endColumn: number,
  options: DecorationOptions,
): Decoration {
  return {
    range: { startLineNumber: lineNumber, startColumn, endLineNumber: lineNumber, endColumn },
    options,
  };
}

/** Whole-line decorations for every file line in [first, last] that the window holds. */
function fileLineRange(
  first: number,
  last: number,
  editorWindow: EditorWindow,
  options: DecorationOptions,
): Decoration[] {
  const out: Decoration[] = [];
  for (let fileLine = first; fileLine <= last; fileLine++) {
    const monacoLine = toMonacoLine(fileLine, editorWindow);
    if (monacoLine !== null) out.push(wholeLine(monacoLine, options));
  }
  return out;
}

/** Marks every line a trace search matched. */
export function matchLineDecorations(
  matchedFileLines: readonly number[],
  editorWindow: EditorWindow,
): Decoration[] {
  const options = {
    isWholeLine: true,
    className: 'monaco-match-line',
    glyphMarginClassName: 'monaco-match-glyph',
  };
  return matchedFileLines.flatMap((fileLine) =>
    fileLineRange(fileLine, fileLine, editorWindow, options),
  );
}

/** Marks a highlighted range of file lines, such as one anomaly picked from a list. */
export function highlightedRangeDecorations(
  range: { start: number; end: number } | null | undefined,
  editorWindow: EditorWindow,
): Decoration[] {
  if (!range) return [];
  return fileLineRange(range.start, range.end, editorWindow, {
    isWholeLine: true,
    className: 'monaco-anomaly-line',
    glyphMarginClassName: 'monaco-anomaly-glyph',
    minimap: { color: { id: 'minimap.findMatchHighlight' }, position: MINIMAP_INLINE },
  });
}

/**
 * Marks every line of every anomaly in the selected category, with the
 * anomaly's details on the glyph, and the category's classes and color
 * (see categoryStyle.ts) on the line and in the minimap.
 */
export function anomalyCategoryDecorations(
  anomalies: readonly AnomalyRangeResult[],
  category: string,
  style: Pick<CategoryStyle, 'color' | 'decorationClass'>,
  editorWindow: EditorWindow,
): Decoration[] {
  return anomalies
    .filter((anomaly) => anomaly.category === category)
    .flatMap((anomaly) =>
      fileLineRange(anomaly.start_line, anomaly.end_line, editorWindow, {
        isWholeLine: true,
        className: `monaco-anomaly-category-line monaco-anomaly-${style.decorationClass}`,
        glyphMarginClassName: `monaco-anomaly-category-glyph monaco-anomaly-${style.decorationClass}-glyph`,
        glyphMarginHoverMessage: {
          value: [
            `**${anomaly.category.toUpperCase()}** | Severity: ${anomaly.severity}`,
            ``,
            `**Detector:** ${anomaly.detector}`,
            ``,
            anomaly.description || '_No description_',
          ].join('\n'),
          isTrusted: true,
        },
        minimap: { color: style.color, position: MINIMAP_INLINE },
      }),
    );
}

/**
 * Highlight-mode filter: the captured groups when the pattern has any,
 * the whole match otherwise. A pattern that does not compile yields
 * nothing; the filter bar reports the error.
 */
export function regexHighlightDecorations(pattern: string, source: LineSource): Decoration[] {
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, 'g');
  } catch {
    return [];
  }
  const options = { inlineClassName: 'monaco-regex-highlight' };
  const out: Decoration[] = [];

  for (let lineNumber = 1; lineNumber <= source.getLineCount(); lineNumber++) {
    for (const span of matchedSpans(source.getLineContent(lineNumber), regex)) {
      out.push(inlineSpan(lineNumber, span.start + 1, span.end + 1, options));
    }
  }
  return out;
}

/**
 * Hide/show-mode filter: a colored marker on every character the filter
 * replaced with HIDDEN_MARKER, with the text it hid as the hover. The key
 * into `hiddenContent` is `"<monaco line>:<marker index on that line>"`,
 * as processContent builds it.
 */
export function hiddenMarkerDecorations(
  mode: 'hide' | 'show',
  source: LineSource,
  hiddenContent: ReadonlyMap<string, string>,
): Decoration[] {
  const inlineClassName =
    mode === 'hide' ? 'monaco-hidden-marker-red' : 'monaco-hidden-marker-blue';
  const out: Decoration[] = [];

  for (let lineNumber = 1; lineNumber <= source.getLineCount(); lineNumber++) {
    let column = 1;
    let markerIndex = 0;
    for (const char of source.getLineContent(lineNumber)) {
      if (char === HIDDEN_MARKER) {
        const hiddenText = hiddenContent.get(`${lineNumber}:${markerIndex}`);
        out.push(
          inlineSpan(lineNumber, column, column + 1, {
            inlineClassName,
            hoverMessage: hiddenText ? { value: hiddenText } : undefined,
          }),
        );
        markerIndex++;
      }
      column++;
    }
  }
  return out;
}

/** What the pane shows that its decorations mark. */
export interface PaneView {
  editorWindow: EditorWindow;
  /** File lines a trace search matched. */
  matchedFileLines: readonly number[];
  /** A highlighted range of file lines, such as one anomaly picked from a list. */
  highlightedRange: { start: number; end: number } | null | undefined;
  anomalies: readonly AnomalyRangeResult[] | null;
  /** The anomaly category whose lines are marked, with its look. */
  selectedCategory: { name: string; style: CategoryStyle } | null;
  filter: Pick<RegexFilter, 'enabled' | 'pattern' | 'mode' | 'compiledRegex'> | null;
  /** The editor's text, or null before the editor has a model. */
  text: LineSource | null;
  /** What the hide/show filter replaced, as processContent built it. */
  hiddenContent: ReadonlyMap<string, string>;
  /** A log chain's gutter classes, in runs of editor lines; none for a file. */
  gutterRuns?: readonly GutterRun[];
}

/** Whether two values of a field of a pane view are the same. */
type SameField<T> = (a: T, b: T) => boolean;

const isSameObject = <T>(a: T, b: T): boolean => a === b;

/**
 * How each field of two pane views is compared: as the same object,
 * except the window and the selected category, which a tab's update
 * builds anew from numbers and names that say the same.
 */
const SAME_PANE_FIELDS: { [K in keyof Required<PaneView>]: SameField<PaneView[K]> } = {
  editorWindow: (a, b) => a.startLine === b.startLine && a.lineCount === b.lineCount,
  matchedFileLines: isSameObject,
  highlightedRange: isSameObject,
  anomalies: isSameObject,
  selectedCategory: (a, b) =>
    a === b ||
    (a !== null &&
      b !== null &&
      a.name === b.name &&
      a.style.color === b.style.color &&
      a.style.decorationClass === b.style.decorationClass),
  filter: isSameObject,
  text: isSameObject,
  hiddenContent: isSameObject,
  gutterRuns: isSameObject,
};

const PANE_FIELDS = Object.keys(SAME_PANE_FIELDS) as (keyof PaneView)[];

function isSameField<K extends keyof PaneView>(key: K, a: PaneView, b: PaneView): boolean {
  return SAME_PANE_FIELDS[key](a[key], b[key]);
}

/**
 * Whether two pane views mark the same: every field the same. Objects
 * built from the lines or the text (the matched lines, the hidden
 * content, the gutter runs) count only as the same object, so a view
 * whose decorations would differ is never taken for the same one.
 */
export function isSamePaneView(a: PaneView, b: PaneView): boolean {
  return PANE_FIELDS.every((key) => isSameField(key, a, b));
}

/** The line numbers of each run of editor lines in the run's class. */
export function gutterDecorations(runs: readonly GutterRun[]): Decoration[] {
  return runs.map((run) => ({
    range: { startLineNumber: run.first, startColumn: 1, endLineNumber: run.last, endColumn: 1 },
    options: { isWholeLine: true, lineNumberClassName: run.className },
  }));
}

/** The decorations of each filter mode, over the editor's text. */
const FILTER_DECORATIONS: Record<
  RegexFilter['mode'],
  (pattern: string, text: LineSource, hiddenContent: ReadonlyMap<string, string>) => Decoration[]
> = {
  highlight: (pattern, text) => regexHighlightDecorations(pattern, text),
  hide: (_, text, hiddenContent) => hiddenMarkerDecorations('hide', text, hiddenContent),
  show: (_, text, hiddenContent) => hiddenMarkerDecorations('show', text, hiddenContent),
};

/**
 * Every decoration of the pane: matched lines, the highlighted range,
 * the selected category's anomalies, what an active filter does, and a
 * log chain's gutter classes. A filter is active when it is enabled and
 * its pattern compiled.
 */
export function paneDecorations(view: PaneView): Decoration[] {
  const { editorWindow, filter, text, selectedCategory } = view;
  const isFilterActive = Boolean(filter?.enabled && filter.compiledRegex);
  return [
    ...matchLineDecorations(view.matchedFileLines, editorWindow),
    ...highlightedRangeDecorations(view.highlightedRange, editorWindow),
    ...(selectedCategory && view.anomalies
      ? anomalyCategoryDecorations(
          view.anomalies,
          selectedCategory.name,
          selectedCategory.style,
          editorWindow,
        )
      : []),
    ...(filter && isFilterActive && text
      ? FILTER_DECORATIONS[filter.mode](filter.pattern, text, view.hiddenContent)
      : []),
    ...gutterDecorations(view.gutterRuns ?? []),
  ];
}

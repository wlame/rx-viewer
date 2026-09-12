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
import type { Anomaly } from '../types';
import type { CategoryStyle } from './categoryStyle';
import { HIDDEN_MARKER } from './processContent';

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
  anomalies: readonly Anomaly[],
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
  const hasGroups = /\([^?]/.test(pattern) || /\(\?</.test(pattern);
  const out: Decoration[] = [];

  for (let lineNumber = 1; lineNumber <= source.getLineCount(); lineNumber++) {
    const lineContent = source.getLineContent(lineNumber);
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(lineContent)) !== null) {
      if (hasGroups && match.length > 1) {
        let searchStart = match.index;
        for (let group = 1; group < match.length; group++) {
          const groupText = match[group];
          if (groupText === undefined) continue;
          const groupStart = lineContent.indexOf(groupText, searchStart);
          if (groupStart === -1) continue;
          out.push(
            inlineSpan(lineNumber, groupStart + 1, groupStart + groupText.length + 1, options),
          );
          searchStart = groupStart + groupText.length;
        }
      } else {
        out.push(
          inlineSpan(lineNumber, match.index + 1, match.index + match[0].length + 1, options),
        );
      }
      // A zero-width match would match again at the same place forever.
      if (match[0].length === 0) regex.lastIndex++;
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

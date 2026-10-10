/**
 * A stand-in for the Monaco editor in component tests, which jsdom cannot
 * run: the calls the editor pane makes on the editor `MonacoEditor` hands
 * it, with each decorations collection it creates recorded.
 */
import type * as Monaco from 'monaco-editor';

export interface FakeMonacoEditor {
  /** The decorations of each collection the pane created, oldest first. */
  decorationSets: Monaco.editor.IModelDeltaDecoration[][];
  /** Each list of gutter labels the pane passed `MonacoEditorStub`, oldest first. */
  passedLabels: (readonly string[] | null)[];
  /** How many times the pane focused the editor. */
  focusCount: number;
  /** The editor as the pane reads it. */
  editor: Monaco.editor.IStandaloneCodeEditor;
}

/** A fake editor whose text is `lines`. */
export function createFakeMonacoEditor(lines: readonly string[] = []): FakeMonacoEditor {
  const decorationSets: Monaco.editor.IModelDeltaDecoration[][] = [];
  const fake: FakeMonacoEditor = {
    decorationSets,
    passedLabels: [],
    focusCount: 0,
    editor: null as unknown as Monaco.editor.IStandaloneCodeEditor,
  };
  const model = {
    getLineCount: () => lines.length,
    getLineContent: (lineNumber: number) => lines[lineNumber - 1] ?? '',
    onDidChangeContent: () => ({ dispose: () => {} }),
  };
  const editor = {
    getModel: () => model,
    createDecorationsCollection: (decorations: Monaco.editor.IModelDeltaDecoration[]) => {
      decorationSets.push(decorations);
      return { clear: () => {} };
    },
    getVisibleRanges: () => [],
    getScrollTop: () => 0,
    getScrollLeft: () => 0,
    focus: () => {
      fake.focusCount += 1;
    },
  };
  fake.editor = editor as unknown as Monaco.editor.IStandaloneCodeEditor;
  return fake;
}

/** The fake editors `MonacoEditorStub` made, oldest first. */
export const fakeMonacoEditors: FakeMonacoEditor[] = [];

// @vitest-environment jsdom
import '$lib/testing/matchMediaStub';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { get } from 'svelte/store';
import { editorFocusRequested } from '$lib/stores/layout';
import { CHAIN_T0, chainDescription, chainPart, chainTabOf } from '$lib/testing/chainDescription';
import { fakeMonacoEditors } from '$lib/testing/fakeMonacoEditor';
import type { FileLine, OpenFile } from '$lib/types';
import { chainLineLabels } from '$lib/utils/chainPane';
import { chainGutterRuns } from '$lib/utils/chainZones';
import { paneDecorations } from '$lib/utils/editorDecorations';
import { processContent } from '$lib/utils/processContent';
import EditorPane from './EditorPane.svelte';

// jsdom cannot run Monaco: the pane gets a stub with a fake editor, and
// the log language, which registers itself with Monaco, only its ID.
vi.mock('./MonacoEditor.svelte', async () => ({
  default: (await import('$lib/testing/MonacoEditorStub.svelte')).default,
}));
vi.mock('$lib/utils/monacoLogLanguage', () => ({ LOG_LANGUAGE_ID: 'logfile' }));

// The work an update of the tab may do, counted.
vi.mock('$lib/utils/processContent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/utils/processContent')>();
  return { ...actual, processContent: vi.fn(actual.processContent) };
});
vi.mock('$lib/utils/editorDecorations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/utils/editorDecorations')>();
  return { ...actual, paneDecorations: vi.fn(actual.paneDecorations) };
});
vi.mock('$lib/utils/chainPane', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/utils/chainPane')>();
  return { ...actual, chainLineLabels: vi.fn(actual.chainLineLabels) };
});
vi.mock('$lib/utils/chainZones', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/utils/chainZones')>();
  return { ...actual, chainGutterRuns: vi.fn(actual.chainGutterRuns) };
});

function fileLines(count: number): FileLine[] {
  return Array.from({ length: count }, (_, i) => ({
    lineNumber: i + 1,
    content: `LINE ${i + 1}`,
  }));
}

function openFile(overrides: Partial<OpenFile> = {}): OpenFile {
  const lines = overrides.lines ?? fileLines(3);
  return {
    path: '/logs/a.log',
    name: 'a.log',
    lines,
    totalLines: lines.length,
    startLine: 1,
    endLine: lines.length,
    loading: false,
    error: null,
    isCompressed: false,
    compressionFormat: null,
    reachedStart: true,
    reachedEnd: true,
    syntaxHighlighting: false,
    fileSize: 1000,
    regexFilter: null,
    showInvisibleChars: false,
    wordWrap: false,
    // A marked range, so the pane has decorations to draw.
    highlightedLines: { start: 2, end: 2 },
    isIndexed: false,
    anomalies: null,
    anomalySummary: null,
    selectedAnomalyCategory: null,
    anchorLine: 1,
    indexBuild: null,
    fileType: null,
    pendingIndex: null,
    backgroundIndexBuild: null,
    timeRange: null,
    isReadingTimeRange: false,
    timeJump: null,
    ...overrides,
  };
}

/** The lines of a pending chain's tab: two of `agent.log.1`, one of `agent.log`. */
function chainLines(): FileLine[] {
  const base = 1_000_000;
  return [
    { lineNumber: base + 1, content: 'LINE 1', part: 'agent.log.1', localLine: 1 },
    { lineNumber: base + 2, content: 'LINE 2', part: 'agent.log.1', localLine: 2 },
    { lineNumber: base + 3, content: 'LINE 3', part: 'agent.log', localLine: 1 },
  ];
}

function chainFile(): OpenFile {
  const lines = chainLines();
  const description = chainDescription({
    state: 'pending',
    parts: [
      chainPart('agent.log.1', { key: '1', first_ms: CHAIN_T0 }),
      chainPart('agent.log', { is_active: true }),
    ],
  });
  return openFile({
    path: 'chain:/l/agent.log',
    name: 'agent.log',
    lines,
    startLine: lines[0].lineNumber,
    endLine: lines[2].lineNumber,
    anchorLine: lines[0].lineNumber,
    chain: chainTabOf(description),
  });
}

let pane: EditorPane | null = null;

/** Mount the pane on `file` and let the fake editor arrive and its first drawing run. */
async function mountPane(file: OpenFile) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  pane = new EditorPane({ target, props: { file, hideHeader: true, isActive: true } });
  await tick();
  await vi.runAllTimersAsync();
  const editor = fakeMonacoEditors.at(-1);
  if (!editor) throw new Error('the pane made no editor');
  return { pane, editor };
}

/** The tab's update for an index task's progress: a new tab object, nothing it shows changed. */
function progressTick(file: OpenFile, progress: number): OpenFile {
  return { ...file, indexBuild: { taskId: 'task-1', progress } };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});

afterEach(() => {
  pane?.$destroy();
  pane = null;
  editorFocusRequested.set(false);
  fakeMonacoEditors.length = 0;
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe('EditorPane updates', () => {
  it('reworks the text and redraws nothing when an update changes nothing it shows', async () => {
    const file = openFile();
    const { pane, editor } = await mountPane(file);
    const drawn = editor.decorationSets.length;
    const processed = vi.mocked(processContent).mock.calls.length;
    const decorated = vi.mocked(paneDecorations).mock.calls.length;
    expect(drawn).toBeGreaterThan(0);

    pane.$set({ file: progressTick(file, 0.25) });
    await tick();
    pane.$set({ file: progressTick(file, 0.5) });
    await tick();
    await vi.runAllTimersAsync();

    expect(vi.mocked(processContent).mock.calls.length).toBe(processed);
    expect(vi.mocked(paneDecorations).mock.calls.length).toBe(decorated);
    expect(editor.decorationSets).toHaveLength(drawn);
  });

  it('reworks the text and redraws the decorations for new lines', async () => {
    const file = openFile();
    const { pane, editor } = await mountPane(file);
    const drawn = editor.decorationSets.length;
    const processed = vi.mocked(processContent).mock.calls.length;

    pane.$set({ file: { ...file, lines: fileLines(4), endLine: 4 } });
    await tick();

    expect(vi.mocked(processContent).mock.calls.length).toBe(processed + 1);
    expect(editor.decorationSets).toHaveLength(drawn + 1);
  });

  it('redraws the decorations for a new marked range', async () => {
    const file = openFile();
    const { pane, editor } = await mountPane(file);
    const drawn = editor.decorationSets.length;

    pane.$set({ file: { ...file, highlightedLines: { start: 3, end: 3 } } });
    await tick();

    expect(editor.decorationSets).toHaveLength(drawn + 1);
    expect(editor.decorationSets.at(-1)?.[0].range.startLineNumber).toBe(3);
  });
});

describe('EditorPane updates of a log chain tab', () => {
  // The editor draws its gutter again only for another list of labels.
  it('works out the gutter labels and part colours once, and passes the same labels on', async () => {
    const file = chainFile();
    const { pane, editor } = await mountPane(file);
    const labelled = vi.mocked(chainLineLabels).mock.calls.length;
    const coloured = vi.mocked(chainGutterRuns).mock.calls.length;
    expect(labelled).toBeGreaterThan(0);

    pane.$set({ file: progressTick(file, 0.5) });
    await tick();

    expect(vi.mocked(chainLineLabels).mock.calls.length).toBe(labelled);
    expect(vi.mocked(chainGutterRuns).mock.calls.length).toBe(coloured);
    expect(editor.passedLabels.length).toBeGreaterThan(1);
    expect(new Set(editor.passedLabels).size).toBe(1);
    expect(editor.passedLabels[0]).toEqual(['1', '2', '1']);
  });

  // A scroll moves the anchor, which replaces the tab's chain record.
  it('redraws nothing when the anchor moves', async () => {
    const file = chainFile();
    const { pane, editor } = await mountPane(file);
    const drawn = editor.decorationSets.length;
    const chain = file.chain;
    if (!chain) throw new Error('the tab is no chain tab');

    const anchorLine = file.lines[1].lineNumber;
    const anchor = { part: 'agent.log.1', line: 2, timeMs: null };
    pane.$set({ file: { ...file, anchorLine, chain: { ...chain, anchor } } });
    await tick();

    expect(editor.decorationSets).toHaveLength(drawn);
  });

  it('colours the gutter again for a description with new parts, and keeps the labels', async () => {
    const file = chainFile();
    const { pane } = await mountPane(file);
    const labelled = vi.mocked(chainLineLabels).mock.calls.length;
    const coloured = vi.mocked(chainGutterRuns).mock.calls.length;
    const chain = file.chain;
    if (!chain?.description) throw new Error('the chain tab has no description');

    const description = { ...chain.description, parts: [...chain.description.parts] };
    pane.$set({ file: { ...file, chain: { ...chain, description } } });
    await tick();

    expect(vi.mocked(chainGutterRuns).mock.calls.length).toBe(coloured + 1);
    expect(vi.mocked(chainLineLabels).mock.calls.length).toBe(labelled);
  });
});

describe('EditorPane focus request', () => {
  it('focuses its editor when the file tree asks, and resets the request', async () => {
    const { editor } = await mountPane(openFile());

    editorFocusRequested.set(true);
    await tick();

    expect(editor.focusCount).toBe(1);
    expect(get(editorFocusRequested)).toBe(false);
  });

  // A switch of tabs by key asks the new tab's pane, which is mounted
  // with the request raised or raises it before its editor is drawn.
  it('focuses its editor once drawn, when it is mounted with the request raised', async () => {
    editorFocusRequested.set(true);
    const target = document.body.appendChild(document.createElement('div'));
    pane = new EditorPane({
      target,
      props: { file: openFile(), hideHeader: true, isActive: true },
    });
    await tick();
    await tick();

    expect(fakeMonacoEditors.at(-1)?.focusCount).toBe(1);
    expect(get(editorFocusRequested)).toBe(false);
  });

  it('holds the focus for its editor until the editor is ready, then hands it on', async () => {
    const target = document.body.appendChild(document.createElement('div'));
    pane = new EditorPane({
      target,
      props: { file: openFile(), hideHeader: true, isActive: true },
    });
    // The pane is drawn; its editor reports ready only after a tick.
    editorFocusRequested.set(true);
    await tick();
    await tick();

    expect(fakeMonacoEditors.at(-1)?.focusCount).toBe(1);
  });

  // A tab whose file is still loading shows no editor until its lines come.
  it('hands the focus to its editor when the lines of a loading file come', async () => {
    const target = document.body.appendChild(document.createElement('div'));
    const loading = openFile({ lines: [], loading: true });
    pane = new EditorPane({ target, props: { file: loading, hideHeader: true, isActive: true } });
    editorFocusRequested.set(true);
    await tick();
    expect(document.activeElement).toBe(target.firstElementChild);

    pane.$set({ file: openFile() });
    await tick();
    await tick();

    expect(fakeMonacoEditors.at(-1)?.focusCount).toBe(1);
  });

  it('keeps the focus where it went meanwhile when its editor becomes ready', async () => {
    const target = document.body.appendChild(document.createElement('div'));
    const field = document.body.appendChild(document.createElement('input'));
    const loading = openFile({ lines: [], loading: true });
    pane = new EditorPane({ target, props: { file: loading, hideHeader: true, isActive: true } });
    editorFocusRequested.set(true);
    await tick();
    field.focus();

    pane.$set({ file: openFile() });
    await tick();
    await tick();

    expect(fakeMonacoEditors.at(-1)?.focusCount).toBe(0);
    expect(document.activeElement).toBe(field);
  });

  it('focuses the pane itself when it shows no editor', async () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    pane = new EditorPane({
      target,
      props: { file: openFile({ lines: [], error: 'gone' }), hideHeader: true, isActive: true },
    });
    await tick();

    editorFocusRequested.set(true);
    await tick();

    expect(document.activeElement).toBe(target.firstElementChild);
    expect(get(editorFocusRequested)).toBe(false);
  });
});

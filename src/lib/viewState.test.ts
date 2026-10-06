import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { files } from './stores/files';
import { health } from './stores/health';
import { timeCursor } from './stores/timeCursor';
import { searchRequest, trace } from './stores/trace';
import { searchShowsOffsets, sidebarTab } from './stores/layout';
import { fileViewOf, restoreView, startViewSync } from './viewState';
import {
  DEFAULT_MAX_RESULTS,
  DEFAULT_VIEW,
  type SearchState,
  type ViewState,
} from './utils/urlState';
import type { OpenFile } from './types';

const ONE_MB = 1024 * 1024;

function openFile(overrides: Partial<OpenFile>): OpenFile {
  return {
    path: '/logs/a.log',
    name: 'a.log',
    lines: [],
    totalLines: null,
    startLine: 1,
    endLine: 0,
    loading: false,
    error: null,
    isCompressed: false,
    compressionFormat: null,
    reachedStart: true,
    reachedEnd: false,
    syntaxHighlighting: true,
    fileSize: 1000,
    regexFilter: null,
    showInvisibleChars: false,
    wordWrap: false,
    isIndexed: false,
    anomalies: null,
    anomalySummary: null,
    selectedAnomalyCategory: null,
    anchorLine: 1,
    indexBuild: null,
    timeRange: null,
    timeJump: null,
    cursorVersion: 0,
    ...overrides,
  };
}

describe('fileViewOf', () => {
  it('names no file when none is open', () => {
    expect(fileViewOf(undefined)).toEqual({
      file: null,
      line: null,
      highlight: null,
      filter: null,
      category: null,
      time: null,
    });
  });

  it('writes the time of a time jump and no line', () => {
    const view = fileViewOf(openFile({ anchorLine: 3_000, timeJump: 1_765_351_800_000 }));
    expect(view.time).toBe(1_765_351_800_000);
    expect(view.line).toBeNull();
  });

  // A file opened at its start used to write line=15, the middle of the
  // first screen.
  it('writes no line for a file anchored on line 1', () => {
    expect(fileViewOf(openFile({ anchorLine: 1 })).line).toBeNull();
  });

  // An anomaly click that highlights line 169 used to write line=168.
  it('writes the anchor line', () => {
    expect(fileViewOf(openFile({ anchorLine: 169 })).line).toBe(169);
  });

  it.each([
    { fileSize: 1000, syntaxHighlighting: true, expected: null },
    { fileSize: 1000, syntaxHighlighting: false, expected: false },
    { fileSize: 5 * ONE_MB, syntaxHighlighting: false, expected: null },
    { fileSize: 5 * ONE_MB, syntaxHighlighting: true, expected: true },
  ])(
    'writes highlighting $syntaxHighlighting of a $fileSize-byte file as $expected',
    ({ fileSize, syntaxHighlighting, expected }) => {
      expect(fileViewOf(openFile({ fileSize, syntaxHighlighting })).highlight).toBe(expected);
    },
  );

  it('writes an enabled filter with a pattern, and nothing for any other', () => {
    const filter = {
      enabled: true,
      pattern: 'ERROR',
      mode: 'hide' as const,
      compiledRegex: /ERROR/g,
      error: null,
      applying: false,
    };
    expect(fileViewOf(openFile({ regexFilter: filter })).filter).toEqual({
      pattern: 'ERROR',
      mode: 'hide',
    });
    expect(fileViewOf(openFile({ regexFilter: { ...filter, enabled: false } })).filter).toBeNull();
    expect(fileViewOf(openFile({ regexFilter: { ...filter, pattern: '' } })).filter).toBeNull();
  });

  it('writes the selected anomaly category', () => {
    expect(fileViewOf(openFile({ selectedAnomalyCategory: 'error' })).category).toBe('error');
  });
});

/** The line every time query finds in the files of `serveBackend`. */
const TIME_FOUND_LINE = 3_000;

/** The time queries `serveBackend` answered, newest last. */
let timeQueries: string[] = [];

/**
 * A backend with one search root, `/logs`, holding a 5 MB file and a
 * 1 KB file whose lines read `LINE <n>`; every file has 10,000 lines and
 * no index. It lists `features`; every time query finds line 3,000.
 */
function serveBackend(features: string[] = []) {
  timeQueries = [];
  const entries = [
    { type: 'file', path: '/logs/big.log', name: 'big.log', size: 5 * ONE_MB, is_indexed: false },
    { type: 'file', path: '/logs/small.log', name: 'small.log', size: 1000, is_indexed: false },
  ];
  const json = (body: unknown, status = 200) => ({
    ok: status === 200,
    status,
    statusText: status === 200 ? 'OK' : 'Not Found',
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const parsed = new URL(url, 'http://localhost');
      const path = parsed.searchParams.get('path');
      if (parsed.pathname === '/v1/tree') {
        return path
          ? json({ path, entries })
          : json({ entries: [{ type: 'directory', path: '/logs', name: 'logs' }] });
      }
      if (parsed.pathname === '/health') return json({ contract_version: '1.5', features });
      if (parsed.pathname === '/v1/time-range') {
        return json({
          path,
          format: 'iso',
          has_zone: false,
          day_first: null,
          display_zone: 'UTC',
          example: '2025-12-10 07:00:04.574',
          first_ms: Date.UTC(2025, 11, 10, 7, 0, 4, 574),
          last_ms: Date.UTC(2025, 11, 10, 8, 0, 4, 390),
          source: 'scan',
          cli_command: `rx time-range ${path}`,
        });
      }
      const time = parsed.searchParams.get('timestamps');
      if (parsed.pathname === '/v1/samples' && time !== null) {
        timeQueries.push(time);
        const content: string[] = [];
        for (let n = TIME_FOUND_LINE - 500; n <= TIME_FOUND_LINE + 500; n++)
          content.push(`LINE ${n}`);
        return json({
          path,
          samples: { [time]: content },
          timestamps: { [time]: TIME_FOUND_LINE },
          line_timestamps: { [time]: content.map(() => null) },
          before_context: 500,
          after_context: 500,
          lines: {},
          offsets: {},
          is_compressed: false,
          compression_format: null,
          cli_command: null,
        });
      }
      if (parsed.pathname === '/v1/samples') {
        const lines = parsed.searchParams.get('lines') ?? '1';
        const range = /^(\d+)-(\d+)$/.exec(lines);
        const center = Number(lines);
        const context = Number(parsed.searchParams.get('context') ?? 0);
        const first = range ? Number(range[1]) : Math.max(1, center - context);
        const last = Math.min(10_000, range ? Number(range[2]) : center + context);
        const content: string[] = [];
        for (let n = first; n <= last; n++) content.push(`LINE ${n}`);
        return json({
          path,
          samples: { [lines]: content },
          before_context: context,
          after_context: context,
          lines: {},
          offsets: {},
          is_compressed: false,
          compression_format: null,
          cli_command: null,
        });
      }
      return json({ detail: 'not found' }, 404);
    }),
  );
}

/** A window whose history records what was written and how. */
function stubWindow(search = '') {
  const calls: { mode: 'push' | 'replace'; url: string }[] = [];
  const move = (mode: 'push' | 'replace') => (_state: unknown, _title: string, next: string) => {
    calls.push({ mode, url: next });
    const parsed = new URL(next, 'http://localhost:5173');
    Object.assign(window.location, { search: parsed.search, hash: parsed.hash });
  };
  vi.stubGlobal('window', {
    location: { pathname: '/', search, hash: '' },
    history: { replaceState: move('replace'), pushState: move('push') },
    addEventListener: () => {},
    removeEventListener: () => {},
  });
  return calls;
}

function urlParams(): URLSearchParams {
  return new URLSearchParams(window.location.search);
}

function resetStores() {
  for (const file of get(files).openFiles) files.closeFile(file.path);
  searchRequest.set(null);
  trace.clear();
  sidebarTab.set('tree');
  searchShowsOffsets.set(false);
}

describe('the URL follows the view', () => {
  let stopSync: () => void = () => {};

  beforeEach(() => {
    serveBackend();
    stubWindow();
    stopSync = startViewSync();
  });

  afterEach(() => {
    resetStores();
    stopSync();
    vi.unstubAllGlobals();
  });

  it('names a file opened at its start and no line', async () => {
    await files.openFile('/logs/small.log', { fileSize: 1000, isIndexed: false });
    expect(window.location.search).toBe('?file=%2Flogs%2Fsmall.log');
  });

  it('names the line a jump went to', async () => {
    await files.openFile('/logs/small.log', { fileSize: 1000, isIndexed: false });
    files.setHighlightedLines('/logs/small.log', { start: 169, end: 175 });
    await files.jumpToLine('/logs/small.log', 169);
    expect(urlParams().get('line')).toBe('169');
  });

  it('stops naming a file when the last one is closed', async () => {
    await files.openFile('/logs/small.log', { scrollToLine: 40, fileSize: 1000, isIndexed: false });
    files.toggleSyntaxHighlighting('/logs/small.log');

    files.closeFile('/logs/small.log');

    expect(window.location.search).toBe('');
  });

  it('names the remaining file while one is still open', async () => {
    await files.openFile('/logs/small.log', { fileSize: 1000, isIndexed: false });
    await files.openFile('/logs/big.log', { fileSize: 5 * ONE_MB, isIndexed: false });

    files.closeFile('/logs/big.log');

    expect(urlParams().get('file')).toBe('/logs/small.log');
  });

  it('names the sidebar tab, the search and the offsets switch', () => {
    searchRequest.set({
      patterns: ['ERROR'],
      maxResults: DEFAULT_MAX_RESULTS,
      onlyOpenedFiles: false,
      flags: {},
    });
    sidebarTab.set('tree');
    searchShowsOffsets.set(true);
    expect(window.location.search).toBe('?tab=files&offsets=1&regexp=ERROR');
  });

  it('names the filter and the anomaly category of the active file', async () => {
    await files.openFile('/logs/small.log', { fileSize: 1000, isIndexed: false });
    files.setRegexFilter('/logs/small.log', { pattern: 'LINE 1\\d', mode: 'show' });
    files.setSelectedAnomalyCategory('/logs/small.log', 'error');
    expect(urlParams().get('filter')).toBe('LINE 1\\d');
    expect(urlParams().get('filter_mode')).toBe('show');
    expect(urlParams().get('category')).toBe('error');
  });
});

describe('restoreView', () => {
  beforeEach(() => {
    serveBackend();
    stubWindow();
  });

  afterEach(() => {
    resetStores();
    vi.unstubAllGlobals();
  });

  function activeFile(): OpenFile {
    const state = get(files);
    const file = state.openFiles.find((f) => f.path === state.activeFilePath);
    if (!file) throw new Error('no active file');
    return file;
  }

  it.each([
    { path: '/logs/big.log', highlight: null, expected: false },
    { path: '/logs/small.log', highlight: null, expected: true },
    { path: '/logs/big.log', highlight: true, expected: true },
    { path: '/logs/small.log', highlight: false, expected: false },
  ])(
    'opens $path with highlight=$highlight highlighted: $expected',
    async ({ path, highlight, expected }) => {
      await restoreView({ ...DEFAULT_VIEW, file: path, highlight });
      expect(activeFile().syntaxHighlighting).toBe(expected);
    },
  );

  it('rebuilds the file, its line, filter and category, the tab, the search and the switch', async () => {
    const view: ViewState = {
      file: '/logs/small.log',
      line: 4_200,
      time: null,
      highlight: null,
      filter: { pattern: 'LINE 42', mode: 'hide' },
      category: 'error',
      tab: 'search',
      offsets: true,
      search: { patterns: ['LINE 7'], maxResults: 50, onlyOpenedFiles: true, flags: {} },
    };

    await restoreView(view);

    const file = activeFile();
    expect(file.path).toBe('/logs/small.log');
    expect(file.anchorLine).toBe(4_200);
    expect(file.lines[0].lineNumber).toBeLessThanOrEqual(4_200);
    expect(file.regexFilter?.pattern).toBe('LINE 42');
    expect(file.regexFilter?.mode).toBe('hide');
    expect(file.selectedAnomalyCategory).toBe('error');
    expect(get(sidebarTab)).toBe('search');
    expect(get(searchShowsOffsets)).toBe(true);
    expect(get(searchRequest)).toEqual(view.search);
  });
});

/**
 * A browser history: a stack of entries, push and replace as a browser
 * does them, and Back and Forward that fire `popstate`.
 */
function stubBrowserHistory() {
  const entries = [''];
  const modes: ('push' | 'replace')[] = [];
  const listeners = new Set<() => void>();
  const location = { pathname: '/', search: '', hash: '' };
  let index = 0;
  const queryOf = (url: string) => new URL(url, 'http://localhost:5173').search;

  vi.stubGlobal('window', {
    location,
    history: {
      pushState: (_state: unknown, _title: string, url: string) => {
        modes.push('push');
        entries.splice(index + 1, entries.length, queryOf(url));
        index += 1;
        location.search = queryOf(url);
      },
      replaceState: (_state: unknown, _title: string, url: string) => {
        modes.push('replace');
        entries[index] = queryOf(url);
        location.search = queryOf(url);
      },
    },
    addEventListener: (type: string, listener: () => void) => {
      if (type === 'popstate') listeners.add(listener);
    },
    removeEventListener: (type: string, listener: () => void) => {
      if (type === 'popstate') listeners.delete(listener);
    },
  });

  const go = (delta: number) => {
    index += delta;
    location.search = entries[index];
    for (const listener of listeners) listener();
  };
  return { entries, modes, back: () => go(-1), forward: () => go(1) };
}

describe('Back and Forward', () => {
  let stopSync: () => void = () => {};
  let browser: ReturnType<typeof stubBrowserHistory>;

  beforeEach(() => {
    serveBackend();
    browser = stubBrowserHistory();
    stopSync = startViewSync();
  });

  afterEach(() => {
    stopSync();
    resetStores();
    vi.unstubAllGlobals();
  });

  const activePath = () => get(files).activeFilePath;
  const openPaths = () => get(files).openFiles.map((f) => f.path);
  const search: SearchState = {
    patterns: ['LINE 7'],
    maxResults: DEFAULT_MAX_RESULTS,
    onlyOpenedFiles: false,
    flags: {},
  };

  it('adds an entry for each file opened, and none for a jump inside one', async () => {
    await files.openFile('/logs/small.log', { fileSize: 1000, isIndexed: false });
    await files.jumpToLine('/logs/small.log', 500);
    await files.openFile('/logs/big.log', { fileSize: 5 * ONE_MB, isIndexed: false });

    expect(browser.entries).toEqual([
      '',
      '?file=%2Flogs%2Fsmall.log&line=500',
      '?file=%2Flogs%2Fbig.log',
    ]);
  });

  it('returns to the previous file, then to no file, and forward again', async () => {
    await files.openFile('/logs/small.log', {
      scrollToLine: 300,
      fileSize: 1000,
      isIndexed: false,
    });
    await files.openFile('/logs/big.log', { fileSize: 5 * ONE_MB, isIndexed: false });

    browser.back();
    await vi.waitFor(() => expect(activePath()).toBe('/logs/small.log'));
    expect(window.location.search).toBe('?file=%2Flogs%2Fsmall.log&line=300');

    browser.back();
    await vi.waitFor(() => expect(openPaths()).toEqual([]));

    browser.forward();
    await vi.waitFor(() => expect(openPaths()).toEqual(['/logs/small.log']));
    expect(get(files).openFiles[0].anchorLine).toBe(300);
  });

  it('returns from a file to the search run before it, then to no search', async () => {
    searchRequest.set(search);
    await files.openFile('/logs/small.log', { fileSize: 1000, isIndexed: false });

    browser.back();
    await vi.waitFor(() => expect(openPaths()).toEqual([]));
    expect(get(searchRequest)).toEqual(search);

    browser.back();
    await vi.waitFor(() => expect(get(searchRequest)).toBeNull());
  });

  it('returns to the sidebar tab of the previous step', async () => {
    sidebarTab.set('search');
    expect(browser.entries).toEqual(['', '?tab=search']);

    browser.back();
    await vi.waitFor(() => expect(get(sidebarTab)).toBe('tree'));
  });

  it('adds no entry while it restores a view', async () => {
    await files.openFile('/logs/small.log', { fileSize: 1000, isIndexed: false });
    await files.openFile('/logs/big.log', { fileSize: 5 * ONE_MB, isIndexed: false });
    const pushes = browser.modes.filter((mode) => mode === 'push').length;

    browser.back();
    await vi.waitFor(() => expect(activePath()).toBe('/logs/small.log'));
    browser.back();
    await vi.waitFor(() => expect(openPaths()).toEqual([]));

    expect(browser.modes.filter((mode) => mode === 'push')).toHaveLength(pushes);
    expect(browser.entries).toHaveLength(3);
  });
});

describe('a jump by time in the URL', () => {
  let stopSync: () => void = () => {};
  let browser: ReturnType<typeof stubBrowserHistory>;
  const instant = Date.UTC(2025, 11, 10, 7, 30, 0, 0);
  const path = '/logs/small.log';

  beforeEach(async () => {
    serveBackend(['samples_timestamps']);
    await health.check();
    browser = stubBrowserHistory();
    stopSync = startViewSync();
  });

  afterEach(async () => {
    stopSync();
    resetStores();
    timeCursor.clear();
    serveBackend();
    await health.check();
    vi.unstubAllGlobals();
  });

  const activeFile = () => {
    const state = get(files);
    return state.openFiles.find((f) => f.path === state.activeFilePath);
  };

  it('adds an entry with the time, and a later line move replaces it with the line', async () => {
    await files.openFile(path, { fileSize: 1000, isIndexed: false });
    await files.jumpToLine(path, 500);
    const entries = browser.entries.length;

    await files.jumpToTime(path, instant);

    expect(browser.entries).toHaveLength(entries + 1);
    expect(window.location.search).toBe(
      '?file=%2Flogs%2Fsmall.log&time=2025-12-10T07%3A30%3A00.000Z',
    );

    files.setAnchorLine(path, 3_200);
    expect(browser.entries).toHaveLength(entries + 1);
    expect(window.location.search).toBe('?file=%2Flogs%2Fsmall.log&line=3200');
  });

  it('returns to the line before a time jump with Back, and to the time with Forward', async () => {
    await files.openFile(path, { fileSize: 1000, isIndexed: false });
    await files.jumpToLine(path, 500);
    await files.jumpToTime(path, instant);

    browser.back();
    await vi.waitFor(() => expect(activeFile()?.anchorLine).toBe(500));
    expect(activeFile()?.timeJump).toBeNull();

    browser.forward();
    await vi.waitFor(() => expect(activeFile()?.anchorLine).toBe(TIME_FOUND_LINE));
    expect(activeFile()?.timeJump).toBe(instant);
    expect(timeQueries).toHaveLength(2);
  });

  it('opens a link with a time and no line at the line the time finds', async () => {
    await restoreView({ ...DEFAULT_VIEW, file: path, time: instant });

    expect(timeQueries).toEqual(['2025-12-10T07:30:00.000Z']);
    expect(activeFile()?.anchorLine).toBe(TIME_FOUND_LINE);
    expect(activeFile()?.timeJump).toBe(instant);
  });

  it('opens a link with a time and a line at the line', async () => {
    await restoreView({ ...DEFAULT_VIEW, file: path, line: 42, time: instant });

    expect(timeQueries).toEqual([]);
    expect(activeFile()?.anchorLine).toBe(42);
  });

  it('opens a link with a time at the start for a backend without time queries', async () => {
    serveBackend();
    await health.check();

    await restoreView({ ...DEFAULT_VIEW, file: path, time: instant });

    expect(timeQueries).toEqual([]);
    expect(activeFile()?.anchorLine).toBe(1);
    expect(activeFile()?.lines[0]?.lineNumber).toBe(1);
  });
  it('sets the cursor from a link, and opens a file opened later at the cursor', async () => {
    serveBackend(['samples_timestamps', 'time_range']);
    await health.check();

    await restoreView({ ...DEFAULT_VIEW, file: path, time: instant });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(get(timeCursor)).toMatchObject({ query: instant, instantMs: instant });
    expect(activeFile()?.anchorLine).toBe(TIME_FOUND_LINE);
    expect(timeQueries).toEqual(['2025-12-10T07:30:00.000Z']);

    await files.openFile('/logs/big.log', { fileSize: 5 * ONE_MB, isIndexed: false });
    await vi.waitFor(() => expect(activeFile()?.anchorLine).toBe(TIME_FOUND_LINE));
    expect(activeFile()?.path).toBe('/logs/big.log');
    expect(timeQueries).toEqual(['2025-12-10T07:30:00.000Z', '2025-12-10T07:30:00.000Z']);
  });

  it('sets the cursor from a link that names a line too, and keeps the file at the line', async () => {
    serveBackend(['samples_timestamps', 'time_range']);
    await health.check();

    await restoreView({ ...DEFAULT_VIEW, file: path, line: 42, time: instant });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(get(timeCursor)).toMatchObject({ query: instant });
    expect(activeFile()?.anchorLine).toBe(42);
    expect(timeQueries).toEqual([]);
  });

  it('keeps the cursor on Back to a line, and writes the line in place of the time once it is cleared', async () => {
    await files.openFile(path, { fileSize: 1000, isIndexed: false });
    await files.jumpToLine(path, 500);
    await files.goToTime(path, instant);

    browser.back();
    await vi.waitFor(() => expect(activeFile()?.anchorLine).toBe(500));
    expect(get(timeCursor)).toMatchObject({ query: instant });

    browser.forward();
    await vi.waitFor(() => expect(activeFile()?.anchorLine).toBe(TIME_FOUND_LINE));
    const entries = browser.entries.length;

    files.clearTimeCursor();

    expect(get(timeCursor)).toBeNull();
    expect(browser.entries).toHaveLength(entries);
    expect(window.location.search).toBe('?file=%2Flogs%2Fsmall.log&line=3000');
  });
});

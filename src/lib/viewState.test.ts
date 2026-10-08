import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { fileZones } from './stores/fileZones';
import { files } from './stores/files';
import { health } from './stores/health';
import { timeCursor } from './stores/timeCursor';
import { timeStash } from './stores/timeStash';
import { searchRequest, trace } from './stores/trace';
import { searchShowsOffsets, sidebarTab } from './stores/layout';
import { chainMode } from './stores/chainMode';
import { settings } from './stores/settings';
import { chainKey } from './utils/tabKey';
import { fileViewOf, linkView, loadView, restoreView, startViewSync, tabViewOf } from './viewState';
import { switchChainMode } from './stores/chainModeSwitch';
import {
  DEFAULT_MAX_RESULTS,
  DEFAULT_VIEW,
  readViewState,
  serializeViewState,
  type SearchState,
  type ViewState,
} from './utils/urlState';
import type { ChainAnchor, ChainTab, OpenFile } from './types';
import { chainDescription } from './testing/chainDescription';
import { FakeChain, T0_MS, serveChain, type FakePart } from './testing/fakeChain';
import { notifications } from './stores/notifications';

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
    fileType: null,
    pendingIndex: null,
    backgroundIndexBuild: null,
    timeRange: null,
    isReadingTimeRange: false,
    timeJump: null,
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
      chain: null,
      part: null,
      line: 4_200,
      time: null,
      fingerprint: null,
      highlight: null,
      filter: { pattern: 'LINE 42', mode: 'hide' },
      category: 'error',
      tab: 'search',
      chains: false,
      offsets: true,
      search: { patterns: ['LINE 7'], maxResults: 50, onlyOpenedFiles: true, flags: {} },
      stash: [],
      fileZones: [],
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

  it('rewrites the time with each later jump', async () => {
    const later = instant + 15 * 60_000;
    await files.openFile(path, { fileSize: 1000, isIndexed: false });
    await files.jumpToTime(path, instant);

    await files.jumpToTime(path, later);

    expect(urlParams().get('time')).toBe('2025-12-10T07:45:00.000Z');
    expect(get(timeCursor)).toBe(later);
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

  it('opens a link with a time and no line at the line the time finds, and sets the cursor', async () => {
    await restoreView({ ...DEFAULT_VIEW, file: path, time: instant });

    expect(timeQueries).toEqual(['2025-12-10T07:30:00.000Z']);
    expect(activeFile()?.anchorLine).toBe(TIME_FOUND_LINE);
    expect(activeFile()?.timeJump).toBe(instant);
    expect(get(timeCursor)).toBe(instant);
  });

  it('opens a link with a time and a line at the line, and sets no cursor', async () => {
    await restoreView({ ...DEFAULT_VIEW, file: path, line: 42, time: instant });

    expect(timeQueries).toEqual([]);
    expect(activeFile()?.anchorLine).toBe(42);
    expect(get(timeCursor)).toBeNull();
  });

  it('opens a link with a time at the start for a backend without time queries', async () => {
    serveBackend();
    await health.check();

    await restoreView({ ...DEFAULT_VIEW, file: path, time: instant });

    expect(timeQueries).toEqual([]);
    expect(activeFile()?.anchorLine).toBe(1);
    expect(activeFile()?.lines[0]?.lineNumber).toBe(1);
  });
  it('moves no other file to the time of a link', async () => {
    serveBackend(['samples_timestamps', 'time_range']);
    await health.check();
    await restoreView({ ...DEFAULT_VIEW, file: path, time: instant });

    await files.openFile('/logs/big.log', { fileSize: 5 * ONE_MB, isIndexed: false });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(activeFile()?.path).toBe('/logs/big.log');
    expect(activeFile()?.anchorLine).toBe(1);
    expect(get(timeCursor)).toBe(instant);
    expect(timeQueries).toEqual(['2025-12-10T07:30:00.000Z']);
  });

  it('keeps the cursor on Back to a line, and writes the line in place of the time once it is cleared', async () => {
    await files.openFile(path, { fileSize: 1000, isIndexed: false });
    await files.jumpToLine(path, 500);
    await files.jumpToTime(path, instant);

    browser.back();
    await vi.waitFor(() => expect(activeFile()?.anchorLine).toBe(500));
    expect(get(timeCursor)).toBe(instant);

    browser.forward();
    await vi.waitFor(() => expect(activeFile()?.anchorLine).toBe(TIME_FOUND_LINE));
    const entries = browser.entries.length;

    files.clearTimeCursor();

    expect(get(timeCursor)).toBeNull();
    expect(browser.entries).toHaveLength(entries);
    expect(window.location.search).toBe('?file=%2Flogs%2Fsmall.log&line=3000');
  });
});

describe('the stash in the URL', () => {
  let stopSync: () => void = () => {};
  const path = '/logs/small.log';
  const first = Date.UTC(2025, 11, 10, 7, 30, 0, 0);
  const second = Date.UTC(2025, 11, 10, 7, 45, 0, 250);
  const stashParam = () => new URLSearchParams(window.location.search).get('stash');

  beforeEach(() => {
    serveBackend();
  });

  afterEach(() => {
    stopSync();
    stopSync = () => {};
    resetStores();
    timeStash.replace([]);
    vi.unstubAllGlobals();
  });

  it('rewrites the current entry with each saved or removed moment and adds none', async () => {
    const browser = stubBrowserHistory();
    stopSync = startViewSync();
    await files.openFile(path, { fileSize: 1000, isIndexed: false });
    const entries = browser.entries.length;

    timeStash.add(second);
    timeStash.add(first);
    expect(stashParam()).toBe('2025-12-10T07:30:00.000Z,2025-12-10T07:45:00.250Z');

    timeStash.remove(first);
    expect(stashParam()).toBe('2025-12-10T07:45:00.250Z');
    expect(browser.entries).toHaveLength(entries);
    expect(browser.modes.slice(-3)).toEqual(['replace', 'replace', 'replace']);
  });

  it('keeps the stash over a reload of the link', async () => {
    stubWindow();
    stopSync = startViewSync();
    timeStash.add(first);
    timeStash.add(second);
    const link = window.location.search;
    stopSync();

    timeStash.replace([]);
    stubWindow(link);
    await loadView(readViewState());

    expect(get(timeStash)).toEqual([first, second]);
  });

  it('drops the invalid entries of a link and writes the stash it kept', async () => {
    stubWindow(`?stash=${encodeURIComponent('07:30,2025-12-10T07:30:00.000Z,oops')}`);
    await loadView(readViewState());
    stopSync = startViewSync();

    expect(get(timeStash)).toEqual([first]);
    expect(stashParam()).toBe('2025-12-10T07:30:00.000Z');
  });

  it('keeps the stash on Back and Forward, and writes it into the entry it returns to', async () => {
    const browser = stubBrowserHistory();
    stopSync = startViewSync();
    await files.openFile(path, { fileSize: 1000, isIndexed: false });
    await files.openFile('/logs/big.log', { fileSize: 5 * ONE_MB, isIndexed: false });
    timeStash.add(first);

    browser.back();
    await vi.waitFor(() => expect(get(files).activeFilePath).toBe(path));

    expect(get(timeStash)).toEqual([first]);
    await vi.waitFor(() => expect(stashParam()).toBe('2025-12-10T07:30:00.000Z'));
  });
});

describe('the file zones in the URL', () => {
  let stopSync: () => void = () => {};
  const path = '/logs/small.log';
  const notOpen = '/logs/user@host/other.log';
  const zoneParams = () => new URLSearchParams(window.location.search).getAll('ftz');
  /** The file_tz of every samples and time-range request for `file`, in order. */
  const sentZones = (file: string) =>
    vi
      .mocked(fetch)
      .mock.calls.map(([url]) => new URL(String(url), 'http://localhost').searchParams)
      .filter((params) => params.get('path') === file)
      .map((params) => params.get('file_tz'));

  beforeEach(async () => {
    serveBackend(['time_range', 'file_tz']);
    await health.check();
  });

  afterEach(async () => {
    stopSync();
    stopSync = () => {};
    resetStores();
    fileZones.replace([]);
    serveBackend();
    await health.check();
    vi.unstubAllGlobals();
  });

  it('rewrites the current entry when a zone is chosen or reset and adds none', async () => {
    const browser = stubBrowserHistory();
    stopSync = startViewSync();
    await files.openFile(path, { fileSize: 1000, isIndexed: false });
    const entries = browser.entries.length;

    await files.setFileZone(path, 'Europe/Berlin');
    expect(zoneParams()).toEqual([`Europe/Berlin@${path}`]);

    await files.setFileZone(path, null);
    expect(zoneParams()).toEqual([]);
    expect(browser.entries).toHaveLength(entries);
  });

  it('keeps the zones over a reload and sends them for a file the link opens', async () => {
    stubWindow();
    stopSync = startViewSync();
    fileZones.replace([
      { path, zone: 'Europe/Berlin' },
      { path: notOpen, zone: '+05:30' },
    ]);
    const link = `${window.location.search}&file=${encodeURIComponent(path)}`;
    stopSync();

    fileZones.replace([]);
    stubWindow(link);
    vi.mocked(fetch).mockClear();
    await loadView(readViewState());

    expect(get(fileZones)).toEqual([
      { path, zone: 'Europe/Berlin' },
      { path: notOpen, zone: '+05:30' },
    ]);
    await vi.waitFor(() => expect(sentZones(path)).toEqual(['Europe/Berlin', 'Europe/Berlin']));
  });

  it('drops the invalid entries of a link and writes the zones it kept', async () => {
    const query = new URLSearchParams([
      ['ftz', 'Mars/Base@/logs/a.log'],
      ['ftz', `UTC@${path}`],
      ['ftz', 'no-separator'],
    ]);
    stubWindow(`?${query}`);
    await loadView(readViewState());
    stopSync = startViewSync();

    expect(get(fileZones)).toEqual([{ path, zone: 'UTC' }]);
    expect(zoneParams()).toEqual([`UTC@${path}`]);
  });

  it('keeps the zones on Back and Forward', async () => {
    const browser = stubBrowserHistory();
    stopSync = startViewSync();
    await files.openFile(path, { fileSize: 1000, isIndexed: false });
    await files.openFile('/logs/big.log', { fileSize: 5 * ONE_MB, isIndexed: false });
    await files.setFileZone('/logs/big.log', '-03:00');

    browser.back();
    await vi.waitFor(() => expect(get(files).activeFilePath).toBe(path));

    expect(get(fileZones)).toEqual([{ path: '/logs/big.log', zone: '-03:00' }]);
    await vi.waitFor(() => expect(zoneParams()).toEqual(['-03:00@/logs/big.log']));
  });
});

describe('tabViewOf', () => {
  it('writes a file tab as fileViewOf does, with no chain', () => {
    const file = openFile({ path: '/logs/a.log', anchorLine: 169 });

    expect(tabViewOf(file)).toEqual({
      ...fileViewOf(file),
      chain: null,
      part: null,
      fingerprint: null,
    });
  });

  // The URL names a chain by its handle, never by its tab key, and a
  // chain tab is never written as a file.
  it('writes a chain tab as its handle, with no file', () => {
    const view = tabViewOf(openFile({ path: chainKey('/logs/app.log'), anchorLine: 169 }));

    expect(view.chain).toBe('/logs/app.log');
    expect(view.file).toBeNull();
  });

  it('writes no chain when no tab is open', () => {
    expect(tabViewOf(undefined)).toEqual({
      ...fileViewOf(undefined),
      chain: null,
      part: null,
      fingerprint: null,
    });
  });

  it('writes the part, the local line and the time of a chain tab anchor', () => {
    const tab = openFile({ path: chainKey('/logs/app.log'), anchorLine: 3500 });
    tab.chain = chainTabWith({ part: 'app.log.1', line: 500, timeMs: 1_790_000_000_123 });

    expect(tabViewOf(tab)).toMatchObject({
      chain: '/logs/app.log',
      file: null,
      part: 'app.log.1',
      line: 500,
      time: 1_790_000_000_123,
    });
  });

  it('writes no line for an anchor on line 1 of its part, and keeps the part', () => {
    const tab = openFile({ path: chainKey('/logs/app.log') });
    tab.chain = chainTabWith({ part: 'app.log.1', line: 1, timeMs: null });

    expect(tabViewOf(tab)).toMatchObject({ part: 'app.log.1', line: null, time: null });
  });

  // A line without a timestamp has nothing but the fingerprint to tell,
  // after a rotation, that its part's name holds another file.
  it("writes the fingerprint of the chain's files beside the part and line, also of a line without a time", () => {
    const tab = openFile({ path: chainKey('/logs/app.log'), anchorLine: 3500 });
    tab.chain = {
      ...chainTabWith({ part: 'app.log.1', line: 500, timeMs: null }),
      description: chainDescription({ fingerprint: '00000000000000a1' }),
    };

    const view = tabViewOf(tab);
    const query = new URLSearchParams(
      serializeViewState({ ...DEFAULT_VIEW, chains: true, ...view }, ''),
    );

    expect(view).toMatchObject({ part: 'app.log.1', line: 500, time: null });
    expect(view.fingerprint).toBe('00000000000000a1');
    expect(query.get('fp')).toBe('00000000000000a1');
    expect(query.has('time')).toBe(false);
  });

  // Until the tab reads the line a link named, it names it as the link
  // did: a reload then checks the link's files again.
  it('writes the fingerprint a link named its anchor with until the tab reads the line', () => {
    const tab = openFile({ path: chainKey('/logs/app.log') });
    tab.chain = {
      ...chainTabWith({
        part: 'app.log.1',
        line: 500,
        timeMs: null,
        fingerprint: '00000000000000a1',
      }),
      description: chainDescription({ fingerprint: '00000000000000b2' }),
    };

    expect(tabViewOf(tab).fingerprint).toBe('00000000000000a1');
  });

  it('writes no fingerprint for a chain tab at its start, which names no line', () => {
    const tab = openFile({ path: chainKey('/logs/app.log') });
    tab.chain = { ...chainTabWith({ part: 'x', line: 1, timeMs: null }), anchor: null };
    tab.chain.description = chainDescription();

    expect(tabViewOf(tab)).toMatchObject({ part: null, fingerprint: null });
  });
});

/** The chain fields of a tab anchored on `anchor`. */
function chainTabWith(anchor: ChainAnchor): ChainTab {
  return {
    handle: '/logs/app.log',
    description: null,
    numbering: 'global',
    bases: new Map(),
    counts: new Map(),
    anchor,
    indexTask: null,
    indexProblem: null,
    buildRefused: null,
    invalidDetail: null,
  };
}

describe('a chain tab in the URL', () => {
  let stopSync: () => void = () => {};
  let chain: FakeChain;

  beforeEach(() => {
    chain = new FakeChain({
      dir: '/l',
      name: 'app.log',
      parts: [
        { name: 'app.log.2.gz', lines: 3000, compression: 'gzip' },
        { name: 'app.log.1', lines: 1500 },
        { name: 'app.log', lines: 2000, isActive: true },
      ],
    });
    serveChain(chain);
  });

  afterEach(() => {
    stopSync();
    stopSync = () => {};
    resetStores();
    chainMode.set(false);
    vi.unstubAllGlobals();
  });

  function chainTab(): OpenFile {
    const found = get(files).openFiles.find((f) => f.path === chainKey('/l/app.log'));
    if (!found) throw new Error('the chain tab is not open');
    return found;
  }

  it('opens the chain at the part and line of a link, in chain mode, and keeps them', async () => {
    const calls = stubWindow('?chain=%2Fl%2Fapp.log&part=app.log.1&line=20');
    await health.check();

    await loadView(readViewState());
    stopSync = startViewSync();

    expect(get(chainMode)).toBe(true);
    expect(chainTab().anchorLine).toBe(3020);
    expect(chain.samplesRequests[0].get('part')).toBe('app.log.1');
    expect(chain.samplesRequests[0].get('lines')).toBe('20');
    expect(urlParams().get('chain')).toBe('/l/app.log');
    expect(urlParams().get('part')).toBe('app.log.1');
    expect(urlParams().get('line')).toBe('20');
    expect(urlParams().get('time')).toBe(new Date(T0_MS + 3020_000).toISOString());
    expect(urlParams().get('chains')).toBe('1');
    expect(urlParams().has('file')).toBe(false);
    expect(calls.filter((call) => call.mode === 'push')).toEqual([]);
  });

  it('finds the line by its time when the part of a link is gone', async () => {
    const time = new Date(T0_MS + 3500_000).toISOString();
    stubWindow(
      `?chains=1&chain=%2Fl%2Fapp.log&part=app.log.9&line=5&time=${encodeURIComponent(time)}`,
    );
    await health.check();

    await loadView(readViewState());

    expect(chain.samplesRequests[0].getAll('timestamps')).toEqual([time]);
    expect(chain.samplesRequests[0].has('part')).toBe(false);
    expect(chainTab().anchorLine).toBe(3500);
    expect(chainTab().chain?.anchor).toMatchObject({ part: 'app.log.1', line: 500 });
    expect(chain.samplesRequests).toHaveLength(1);
    expect(get(notifications).map((n) => n.message)).toContainEqual(
      expect.stringContaining('changed since this link was made'),
    );
  });

  it('rewrites the entry as the anchor moves through the parts, and adds none', async () => {
    const calls = stubWindow('?chains=1');
    await health.check();
    await loadView(readViewState());
    stopSync = startViewSync();
    await files.openChain('/l/app.log');
    const pushes = calls.filter((call) => call.mode === 'push').length;

    files.setAnchorLine(chainKey('/l/app.log'), 3001);
    files.setAnchorLine(chainKey('/l/app.log'), 2999);

    expect(calls.filter((call) => call.mode === 'push')).toHaveLength(pushes);
    expect(urlParams().get('part')).toBe('app.log.2.gz');
    expect(urlParams().get('line')).toBe('2999');
  });
});

describe('a link to a chain line opened after a rotation', () => {
  /**
   * Files whose lines keep their text and times under any name: A (3000
   * lines from second 1), B (1500 from 3001) and C, the active file
   * (2000 from 4501).
   */
  const A: FakePart = {
    name: 'app.log.2.gz',
    lines: 3000,
    compression: 'gzip',
    text: 'A',
    startSecond: 1,
  };
  const B: FakePart = { name: 'app.log.1', lines: 1500, text: 'B', startSecond: 3001 };
  const C: FakePart = {
    name: 'app.log',
    lines: 2000,
    isActive: true,
    text: 'C',
    startSecond: 4501,
  };
  /** A numbered rotation: A deleted, B compressed into app.log.2.gz, C renamed app.log.1, a new active file. */
  const ROTATED: FakePart[] = [
    { ...B, name: 'app.log.2.gz', compression: 'gzip' },
    { ...C, name: 'app.log.1', isActive: false },
    { name: 'app.log', lines: 10, isActive: true, text: 'D', startSecond: 6600 },
  ];
  /** The time of B's line 500, which a link made before the rotation names. */
  const B500_TIME = new Date(T0_MS + 3500_000).toISOString();
  const LINK_TO_B500 = `?chains=1&chain=%2Fl%2Fapp.log&part=app.log.1&line=500&time=${encodeURIComponent(B500_TIME)}`;

  let chain: FakeChain;

  beforeEach(() => {
    for (const shown of get(notifications)) notifications.dismiss(shown.id);
    chain = new FakeChain({ dir: '/l', name: 'app.log', parts: [A, B, C], state: 'ready' });
    serveChain(chain);
  });

  afterEach(() => {
    resetStores();
    for (const shown of get(notifications)) notifications.dismiss(shown.id);
    fileZones.replace([]);
    chainMode.set(false);
    vi.unstubAllGlobals();
  });

  function chainTab(): OpenFile {
    const found = get(files).openFiles.find((f) => f.path === chainKey('/l/app.log'));
    if (!found) throw new Error('the chain tab is not open');
    return found;
  }

  function anchorText(): string | undefined {
    const tab = chainTab();
    const line = tab.lines[tab.anchorLine - tab.startLine];
    return line?.lineNumber === tab.anchorLine ? line.content : undefined;
  }

  function messages(): string[] {
    return get(notifications).map((n) => n.message);
  }

  it('opens the line of the part it names, and says nothing, while that line has its time', async () => {
    stubWindow(LINK_TO_B500);
    await health.check();

    await loadView(readViewState());

    expect(anchorText()).toContain('B local=500');
    expect(chain.samplesRequests.map((q) => q.has('timestamps'))).toEqual([false]);
    expect(messages()).toEqual([]);
  });

  it("goes by the link's time when the part it names holds another file now, and says so", async () => {
    stubWindow(LINK_TO_B500);
    chain.rotateTo(ROTATED, 'ready');
    await health.check();

    await loadView(readViewState());

    expect(anchorText()).toContain('B local=500');
    expect(chainTab().chain?.anchor).toMatchObject({ part: 'app.log.2.gz', line: 500 });
    expect(chain.samplesRequests.at(-1)?.getAll('timestamps')).toEqual([B500_TIME]);
    expect(messages()).toContainEqual(
      "The files of app.log changed since this link was made; the view shows the line at the link's time",
    );
  });

  it("goes by the link's time once a pending chain is ready, when the part holds another file", async () => {
    stubWindow(LINK_TO_B500);
    chain.rotateTo(ROTATED, 'pending');
    await health.check();

    const loading = loadView(readViewState());
    await vi.waitFor(() =>
      expect(chain.samplesRequests.some((q) => q.has('timestamps'))).toBe(true),
    );
    chain.finishTask();
    await loading;
    await vi.waitFor(() => expect(chainTab().loading).toBe(false));

    expect(anchorText()).toContain('B local=500');
    expect(chainTab().chain?.anchor).toMatchObject({ part: 'app.log.2.gz', line: 500 });
  });

  it("says so when no line has the link's time after the rotation", async () => {
    const time = new Date(T0_MS + 2900_000).toISOString();
    stubWindow(
      `?chains=1&chain=%2Fl%2Fapp.log&part=app.log.2.gz&line=2900&time=${encodeURIComponent(time)}`,
    );
    chain.rotateTo(ROTATED, 'ready');
    await health.check();

    await loadView(readViewState());

    expect(anchorText()).toContain('B local=1');
    expect(messages()).toContainEqual(
      'Cannot find line 2900 of app.log.2.gz that this link names, in app.log, whose files changed since it was made; the view shows the first line at or after its time',
    );
  });

  it('goes by the time of an entry Back returns to when the open tab took a rotation in since', async () => {
    stubWindow(LINK_TO_B500);
    await health.check();
    const entry = readViewState();
    await loadView(entry);
    chain.rotateTo(ROTATED, 'ready');
    await files.loadMore(chainKey('/l/app.log'), 'after');
    await vi.waitFor(() => expect(chainTab().loading).toBe(false));
    await files.goToChainLine(chainKey('/l/app.log'), { kind: 'global', line: 1600 });
    expect(anchorText()).toContain('C local=100');

    await restoreView(entry);

    expect(anchorText()).toContain('B local=500');
    expect(messages()).toContainEqual(expect.stringContaining('changed since this link was made'));
  });

  /** The fingerprint of the files before the rotation, which a link made then carries. */
  const FP_BEFORE = '00000000000000a1';

  /** A chain link to line `line` of `part`, made on the files of `fp`, at `time` when given. */
  function linkTo(part: string, line: number, fp: string, time?: string): string {
    const params = new URLSearchParams({ chains: '1', chain: '/l/app.log', part });
    params.set('line', String(line));
    if (time !== undefined) params.set('time', time);
    params.set('fp', fp);
    return `?${params.toString()}`;
  }

  /** Whether any samples request read the part `part` of the files as they are now. */
  function readPartNow(part: string): boolean {
    return chain.samplesRequests.some(
      (q) => q.get('part') === part && q.get('fingerprint') === chain.fingerprint,
    );
  }

  // The link names B's line 500, which has no time of its own; the part's
  // name holds C now. Only the fingerprint can tell.
  it('opens a link to a line without a time made before a rotation at the start, and says the line is not found again', async () => {
    stubWindow(linkTo('app.log.1', 500, FP_BEFORE));
    chain.rotateTo(ROTATED, 'ready');
    await health.check();

    await loadView(readViewState());

    expect(readPartNow('app.log.1')).toBe(false);
    expect(anchorText()).not.toContain('C local=500');
    expect(chainTab().anchorLine).toBe(1);
    expect(anchorText()).toContain('B local=1');
    expect(messages()).toEqual([
      'The files of app.log changed since this link was made; the line could not be found again',
    ]);
  });

  it("goes by the time of a link made before a rotation, and reads no line of the file that took its part's name", async () => {
    stubWindow(linkTo('app.log.1', 500, FP_BEFORE, B500_TIME));
    chain.rotateTo(ROTATED, 'ready');
    await health.check();

    await loadView(readViewState());

    expect(readPartNow('app.log.1')).toBe(false);
    expect(anchorText()).toContain('B local=500');
    expect(chainTab().chain?.anchor).toMatchObject({ part: 'app.log.2.gz', line: 500 });
    expect(messages()).toEqual([
      "The files of app.log changed since this link was made; the view shows the line at the link's time",
    ]);
  });

  it('opens the part and line of a link made on the files as they are, and says nothing', async () => {
    chain.rotateTo(ROTATED, 'ready');
    stubWindow(linkTo('app.log.1', 500, chain.fingerprint));
    await health.check();

    await loadView(readViewState());

    expect(anchorText()).toContain('C local=500');
    expect(chain.samplesRequests.map((q) => q.get('part'))).toEqual(['app.log.1']);
    expect(messages()).toEqual([]);
  });

  // A part's line in a link is read by global number only through the
  // files the link was made on.
  it('opens a global line of a link made before a rotation at the start, with the notice', async () => {
    stubWindow(`?chains=1&chain=%2Fl%2Fapp.log&line=3500&fp=${FP_BEFORE}`);
    chain.rotateTo(ROTATED, 'ready');
    await health.check();

    await loadView(readViewState());

    expect(chainTab().anchorLine).toBe(1);
    expect(messages()).toEqual([
      'The files of app.log changed since this link was made; the line could not be found again',
    ]);
  });

  it('goes by the time of an entry Back returns to, made before a rotation the open tab took in', async () => {
    stubWindow(linkTo('app.log.1', 500, FP_BEFORE, B500_TIME));
    await health.check();
    const entry = readViewState();
    await loadView(entry);
    chain.rotateTo(ROTATED, 'ready');
    await files.loadMore(chainKey('/l/app.log'), 'after');
    await vi.waitFor(() => expect(chainTab().loading).toBe(false));
    // The tab now sits at the part and line the entry names, in other files.
    await files.goToChainLine(chainKey('/l/app.log'), {
      kind: 'local',
      part: 'app.log.1',
      line: 500,
    });
    expect(anchorText()).toContain('C local=500');
    for (const shown of get(notifications)) notifications.dismiss(shown.id);
    const reads = chain.samplesRequests.length;

    await restoreView(entry);

    expect(anchorText()).toContain('B local=500');
    expect(chain.samplesRequests.slice(reads).some((q) => q.get('part') === 'app.log.1')).toBe(
      false,
    );
    expect(messages()).toContainEqual(expect.stringContaining('changed since this link was made'));
  });

  it('goes to the start for an entry without a time that Back returns to, made before a rotation the open tab took in', async () => {
    stubWindow(linkTo('app.log.1', 500, FP_BEFORE));
    await health.check();
    const entry = readViewState();
    await loadView(entry);
    chain.rotateTo(ROTATED, 'ready');
    await files.goToChainLine(chainKey('/l/app.log'), { kind: 'global', line: 1600 });
    await vi.waitFor(() => expect(chainTab().loading).toBe(false));
    for (const shown of get(notifications)) notifications.dismiss(shown.id);

    await restoreView(entry);

    expect(anchorText()).not.toContain('C local=500');
    expect(chainTab().anchorLine).toBe(1);
    expect(messages()).toContainEqual(
      'The files of app.log changed since this link was made; the line could not be found again',
    );
  });

  // The open tab still holds the files of before; the link names them as
  // they are now, so the tab takes the rotation in before it moves.
  it('takes in a rotation the open tab has not seen before it opens a link made after it', async () => {
    stubWindow(linkTo('app.log.1', 100, FP_BEFORE));
    await health.check();
    await loadView(readViewState());
    expect(anchorText()).toContain('B local=100');
    chain.rotateTo(ROTATED, 'ready');
    for (const shown of get(notifications)) notifications.dismiss(shown.id);

    stubWindow(linkTo('app.log.1', 500, chain.fingerprint));
    await restoreView(readViewState());
    await vi.waitFor(() => expect(chainTab().loading).toBe(false));

    expect(anchorText()).toContain('C local=500');
    expect(messages().some((m) => m.includes('changed since this link was made'))).toBe(false);
  });

  // A file link names a path and carries no fingerprint; a time beside its
  // line still tells the chain's tab that the part's name holds another file.
  it("goes by the time of a file link in chain mode when the file's line has another time now", async () => {
    stubWindow(`?chains=1&file=%2Fl%2Fapp.log.1&line=500&time=${encodeURIComponent(B500_TIME)}`);
    chain.rotateTo(ROTATED, 'ready');
    await health.check();

    await loadView(readViewState());

    expect(anchorText()).toContain('B local=500');
    expect(messages()).toContainEqual(expect.stringContaining('changed since this link was made'));
  });

  // A link written by hand names the files as they are when it is opened;
  // nothing tells whether its part's name holds the file it was made on.
  it('opens the part and line of a link without a fingerprint or a time as the files are now, and says so', async () => {
    stubWindow('?chains=1&chain=%2Fl%2Fapp.log&part=app.log.1&line=500');
    chain.rotateTo(ROTATED, 'ready');
    await health.check();

    await loadView(readViewState());

    expect(anchorText()).toContain('C local=500');
    expect(messages()).toEqual([
      'This link does not say which files of app.log it was made on: the view shows line 500 of app.log.1 as the files are now',
    ]);
  });

  // A zone moves every time a link names; an entry made in another zone
  // than the chain is read in now names times that cannot be compared.
  it('compares no time of an entry made in another zone than the chain is read in now', async () => {
    const shifted = new Date(T0_MS + 3500_000 + 7200_000).toISOString();
    stubWindow(
      `?chains=1&chain=%2Fl%2Fapp.log&ftz=${encodeURIComponent('+02:00@chain:/l/app.log')}`,
    );
    await health.check();
    await loadView(readViewState());
    expect(fileZones.zoneOf(chainKey('/l/app.log'))).toBe('+02:00');

    stubWindow(
      `?chains=1&chain=%2Fl%2Fapp.log&part=app.log.1&line=500&time=${encodeURIComponent(shifted)}`,
    );
    await restoreView(readViewState());

    expect(anchorText()).toContain('B local=500');
    expect(chain.samplesRequests.some((q) => q.get('timestamps') === shifted)).toBe(false);
  });
});

describe('the chain mode switch in the URL', () => {
  let stopSync: () => void = () => {};
  let chain: FakeChain;

  beforeEach(() => {
    chain = new FakeChain({
      dir: '/l',
      name: 'app.log',
      parts: [
        { name: 'app.log.2.gz', lines: 3000, compression: 'gzip' },
        { name: 'app.log.1', lines: 1500 },
        { name: 'app.log', lines: 2000, isActive: true },
      ],
    });
    serveChain(chain);
  });

  afterEach(() => {
    stopSync();
    stopSync = () => {};
    resetStores();
    chainMode.set(false);
    vi.unstubAllGlobals();
  });

  async function settled(key: string): Promise<void> {
    await vi.waitFor(() =>
      expect(get(files).openFiles.find((f) => f.path === key)?.loading).toBe(false),
    );
  }

  it('rewrites the entry with the part and its line when the mode turns off, and with the chain when it turns on', async () => {
    const calls = stubWindow('?chains=1&chain=%2Fl%2Fapp.log&part=app.log.1&line=750');
    await health.check();
    await loadView(readViewState());
    stopSync = startViewSync();
    const pushes = calls.filter((call) => call.mode === 'push').length;

    await switchChainMode(false);
    await settled('/l/app.log.1');

    expect(urlParams().get('file')).toBe('/l/app.log.1');
    expect(urlParams().get('line')).toBe('750');
    expect(urlParams().has('chain')).toBe(false);
    expect(urlParams().has('chains')).toBe(false);

    await switchChainMode(true);
    await settled(chainKey('/l/app.log'));

    expect(urlParams().get('chain')).toBe('/l/app.log');
    expect(urlParams().get('part')).toBe('app.log.1');
    expect(urlParams().get('line')).toBe('750');
    expect(urlParams().get('chains')).toBe('1');
    expect(urlParams().has('file')).toBe(false);
    expect(calls.filter((call) => call.mode === 'push')).toHaveLength(pushes);
  });

  it("opens the chain's tab for a link with chains=1 and a file that is one of its parts", async () => {
    stubWindow('?chains=1&file=%2Fl%2Fapp.log.1&line=20');
    await health.check();

    await loadView(readViewState());
    stopSync = startViewSync();

    expect(get(files).openFiles.map((f) => f.path)).toEqual([chainKey('/l/app.log')]);
    const tab = get(files).openFiles[0];
    expect(tab.chain?.anchor).toMatchObject({ part: 'app.log.1', line: 20 });
    expect(tab.lines[tab.anchorLine - tab.startLine]?.content).toBe(
      chain.partLineText('app.log.1', 20),
    );
    expect(urlParams().get('chain')).toBe('/l/app.log');
    expect(urlParams().get('part')).toBe('app.log.1');
    expect(urlParams().has('file')).toBe(false);
  });

  it('opens the file of a link without chains=1 as a file', async () => {
    stubWindow('?file=%2Fl%2Fapp.log.1&line=20');
    await health.check();

    await loadView(linkView(window.location.search, false));

    expect(get(files).openFiles.map((f) => f.path)).toEqual(['/l/app.log.1']);
  });

  // The older restore waits for the chain listing while the newer one sets its stores.
  it('leaves the stores of a newer restore as they are when an older one turning tabs over ends after it', async () => {
    stubWindow();
    await health.check();
    await files.openFile('/l/app.log.1', { scrollToLine: 20 });
    const view = { ...DEFAULT_VIEW, chains: true, file: '/l/app.log.1', line: 20 };

    const older = restoreView({ ...view, tab: 'search' });
    const newer = restoreView({ ...view, tab: 'tree' });
    await Promise.all([older, newer]);

    expect(get(sidebarTab)).toBe('tree');
  });

  it('turns the open file tabs of a chain into its tab when a view in chain mode is restored', async () => {
    stubWindow();
    await health.check();
    await files.openFile('/l/app.log.1', { scrollToLine: 20 });

    await restoreView({ ...DEFAULT_VIEW, chains: true, file: '/l/app.log.1', line: 20 });

    expect(get(files).openFiles.map((f) => f.path)).toEqual([chainKey('/l/app.log')]);
    expect(get(files).openFiles[0].chain?.anchor).toMatchObject({ part: 'app.log.1', line: 20 });
  });
});

describe('chain mode in the URL', () => {
  let stopSync: () => void = () => {};

  beforeEach(() => {
    serveBackend();
    stubWindow();
  });

  afterEach(() => {
    stopSync();
    stopSync = () => {};
    resetStores();
    chainMode.set(false);
    vi.unstubAllGlobals();
  });

  it('turns chain mode on for a link with chains=1, and off for one without', async () => {
    await loadView(readViewState());
    expect(get(chainMode)).toBe(false);

    await restoreView({ ...DEFAULT_VIEW, chains: true });
    expect(get(chainMode)).toBe(true);

    await restoreView(DEFAULT_VIEW);
    expect(get(chainMode)).toBe(false);
  });

  it('keeps chains=1 in the address bar, beside the file, and rewrites the entry', async () => {
    const calls = stubWindow('?chains=1');
    await loadView(readViewState());
    stopSync = startViewSync();
    await files.openFile('/logs/small.log', { fileSize: 1000, isIndexed: false });

    expect(urlParams().get('chains')).toBe('1');
    expect(urlParams().get('file')).toBe('/logs/small.log');

    const pushes = calls.filter((call) => call.mode === 'push').length;
    chainMode.set(false);
    expect(urlParams().has('chains')).toBe(false);
    expect(calls.filter((call) => call.mode === 'push')).toHaveLength(pushes);
  });

  it('opens nothing for a link whose file is a chain key, and writes the default view', async () => {
    stubWindow('?file=chain%3A%2Fx');

    await loadView(readViewState());
    stopSync = startViewSync();

    expect(get(files).openFiles).toEqual([]);
    expect(window.location.search).toBe('');
  });

  it('does not open the file of a link that names a chain too', async () => {
    stubWindow('?file=%2Flogs%2Fsmall.log&chain=%2Flogs%2Fapp.log');

    await loadView(readViewState());

    expect(get(files).openFiles.some((f) => f.path === '/logs/small.log')).toBe(false);
  });
});

describe('chain mode of a link that does not name it', () => {
  it.each([
    ['?chains=1', false, true],
    ['?chains=0', true, false],
    ['?file=%2Flogs%2Fa.log', true, true],
    ['?file=%2Flogs%2Fa.log', false, false],
    ['?chains=yes', true, true],
  ])('opens %j with the mode last chosen %s in chain mode %s', (query, remembered, expected) => {
    expect(linkView(query, remembered).chains).toBe(expected);
  });

  it('keeps the rest of the link as it reads', () => {
    expect(linkView('?file=%2Flogs%2Fa.log&line=5', true)).toEqual({
      ...DEFAULT_VIEW,
      file: '/logs/a.log',
      line: 5,
      chains: true,
    });
  });
});

describe('the chain mode remembered for a link that does not name it', () => {
  let stopSync: () => void = () => {};

  beforeEach(() => {
    serveBackend();
  });

  afterEach(() => {
    stopSync();
    stopSync = () => {};
    resetStores();
    chainMode.set(false);
    settings.update((current) => ({ ...current, chainMode: false }));
    vi.unstubAllGlobals();
  });

  it('is the mode the view is in, whatever set it, once the URL follows the view', async () => {
    stubWindow('?chains=1');
    await loadView(readViewState());
    stopSync = startViewSync();
    expect(get(settings).chainMode).toBe(true);

    // Back to an entry written while the mode was off.
    await restoreView(DEFAULT_VIEW);
    expect(get(settings).chainMode).toBe(false);

    chainMode.set(true);
    expect(get(settings).chainMode).toBe(true);
  });

  // The address the view writes leaves an off mode out: a reload of it
  // must open off, not in a mode chosen earlier.
  it('opens a reload of the address it wrote in the same mode', async () => {
    settings.update((current) => ({ ...current, chainMode: true }));
    stubWindow('?chains=0');

    await loadView(linkView(window.location.search, get(settings).chainMode));
    stopSync = startViewSync();

    expect(window.location.search).toBe('');
    expect(linkView(window.location.search, get(settings).chainMode).chains).toBe(false);
  });
});

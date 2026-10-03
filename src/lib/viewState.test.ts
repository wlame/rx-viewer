import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { files } from './stores/files';
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
    });
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

/**
 * A backend with one search root, `/logs`, holding a 5 MB file and a
 * 1 KB file whose lines read `LINE <n>`; every file has 10,000 lines and
 * no index.
 */
function serveBackend() {
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

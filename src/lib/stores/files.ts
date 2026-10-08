import { writable, get } from 'svelte/store';
import { api, ApiError } from '../api';
import { contractGate } from '../contractGate';
import { IndexBuildFollows } from '../indexBuildFollows';
import { loadSamples, loadSamplesByTime } from '../samplesWait';
import { countAnomaliesByCategory } from '../utils/anomalyCategories';
import { LatestRequestMap, SUPERSEDED, isAbortError } from '../utils/latestRequest';
import { clampAnchor } from '../utils/anchorLine';
import type { FilterState } from '../utils/urlState';
import { readSamplesAnswer, readTimeAnswer, type SampleWindow } from '../utils/sampleWindow';
import { defaultSyntaxHighlighting } from '../utils/highlighting';
import { formatInFileLayout } from '../utils/timeFormat';
import { addPage, linesPerPage, maxHeldLines } from '../utils/slidingWindow';
import { taskPolls } from '../utils/taskPolling';
import { chainKey, isChainKey, type TabKey } from '../utils/tabKey';
import { anchorAt } from '../utils/chainWindow';
import type {
  OpenFile,
  FileMatch,
  IndexBuild,
  IndexResponse,
  SamplesResponse,
  TimeRangeResponse,
} from '../types';
import { createChainTabs, type ChainPosition, type OpenChainOptions } from './chainTabs';
import { commandLog } from './commands';
import { fileZones, requestZoneOf } from './fileZones';
import { backendHas } from './health';
import { notifications } from './notifications';
import { forgetPane } from './paneMemory';
import { timeCursor } from './timeCursor';
import { tree } from './tree';

/**
 * A time to jump to: an instant (UTC ms), sent as RFC 3339 with ms and
 * `Z`, or a text the backend reads as `--timestamps` does, sent as is.
 */
export type TimeQuery = number | string;

/**
 * At most one window load per tab may write to the store.
 *
 * Every load below updates the tab it matches by key, so two
 * overlapping loads for the same tab both applied, in arrival order.
 * Jump to line 1,000,000 and then to line 5 on a slow link and the
 * editor could settle on the first target. Keyed by the tab key so a
 * load in one tab does not cancel another tab's, a chain's included.
 */
const fileLoads = new LatestRequestMap();

/** The time-range request of each open tab, by its key; a newer one supersedes an older one. */
const timeRangeLoads = new LatestRequestMap();

/** The line index build each open tab follows in the background, by its key. */
const indexFollows = new IndexBuildFollows(taskPolls);

/** The status of the backend's refusal of a request it cannot read, such as an unknown `file_tz`. */
const HTTP_BAD_REQUEST = 400;

/**
 * The first and last loaded line of a window, and whether paging may go
 * on past either. An empty window has no lines: start 1, end 0.
 */
function windowBounds(window: SampleWindow) {
  const { lines } = window;
  return {
    lines,
    startLine: lines.length > 0 ? lines[0].lineNumber : 1,
    endLine: lines.length > 0 ? lines[lines.length - 1].lineNumber : 0,
    reachedStart: window.reachedStart,
    reachedEnd: window.reachedEnd,
  };
}

/**
 * Lines asked before and after the target of a jump to a line, a time
 * or the end of the file: the most rx-go serves on a side (it answers
 * 422 to more). Paging loads the rest as the view moves.
 */
const JUMP_CONTEXT = 100;

/**
 * How a jump by time ended: the line it found; no line at or after the
 * time (the file shows its end); the backend's refusal or another
 * failure, with its message (the file stays as it was); a backend that
 * does not list `samples_timestamps`; or a newer load of the file that
 * took over.
 */
export type TimeJumpOutcome =
  | { kind: 'found'; line: number }
  | { kind: 'none' }
  | { kind: 'refused'; message: string }
  | { kind: 'unsupported' }
  | { kind: 'superseded' };

/** The value a time query sends. */
function timeQueryValue(query: TimeQuery): string {
  return typeof query === 'number' ? new Date(query).toISOString() : query;
}

/** A time query as a person reads it: an instant in the file's layout when the file has one. */
function timeQueryLabel(query: TimeQuery, file: OpenFile): string {
  if (typeof query === 'string') return query;
  return file.timeRange?.format ? formatInFileLayout(query, file.timeRange) : timeQueryValue(query);
}

/**
 * The fields a move to `line` by line sets: the file shows the line and
 * is anchored on it, and it is no longer where a jump by time put it.
 */
function movedByLine(line: number): Pick<OpenFile, 'scrollToLine' | 'anchorLine' | 'timeJump'> {
  return { scrollToLine: line, anchorLine: line, timeJump: null };
}

/** What the caller of `openFile` knows about the file; every field may be left out. */
export interface OpenFileOptions {
  /** The line to show; without one the file opens at line 1. */
  scrollToLine?: number;
  /** The file's size in bytes, which picks the highlighting default; null when unknown. */
  fileSize?: number | null;
  /** Highlighting as a link gives it, in place of the size-based default. */
  syntaxHighlighting?: boolean;
  /** Whether the file is indexed; false skips the index request. */
  isIndexed?: boolean;
  /** The file's line count, when the tree lists it. */
  lineCount?: number | null;
  /**
   * The file's compression format as the tree lists it (`gzip`, `zstd`,
   * …), null for a plain file; it sets the size of the first page.
   */
  compressionFormat?: string | null;
}

/**
 * The open tabs, the search matches of each and the active one. A tab is
 * found by its key (`utils/tabKey.ts`), which it holds in `path`: a
 * file's path, or `chain:` and the handle for a log chain, so a chain and
 * the file at its handle are two tabs. The functions that read a file's
 * lines, index or time range take the file's path, which is its key.
 */
interface FilesState {
  openFiles: OpenFile[];
  /** Each tab's search matches, by its key. */
  matches: Map<TabKey, FileMatch[]>;
  /** The key of the active tab. */
  activeFilePath: TabKey | null;
}

/**
 * The tab the editor shows: the one `activeFilePath` names, or the last
 * open tab when it names none that is open.
 */
export function activeOpenFile(state: Pick<FilesState, 'openFiles' | 'activeFilePath'>) {
  return state.openFiles.find((f) => f.path === state.activeFilePath) ?? state.openFiles.at(-1);
}

export { defaultSyntaxHighlighting };

/** A filter pattern compiled the way the editor applies it, or the reason it does not compile. */
function compileFilterPattern(pattern: string): {
  compiledRegex: RegExp | null;
  error: string | null;
} {
  if (!pattern.trim()) return { compiledRegex: null, error: null };
  try {
    return { compiledRegex: new RegExp(pattern, 'g'), error: null };
  } catch (e) {
    return { compiledRegex: null, error: e instanceof Error ? e.message : 'Invalid regex pattern' };
  }
}

function createFilesStore() {
  const { subscribe, update } = writable<FilesState>({
    openFiles: [],
    matches: new Map(),
    activeFilePath: null,
  });

  /** The tabs of log chains, built on this store's tabs and request slots. */
  const chains = createChainTabs({
    getTab: (key) => get({ subscribe }).openFiles.find((f) => f.path === key),
    addTab: (tab) =>
      update((s) => ({ ...s, openFiles: [...s.openFiles, tab], activeFilePath: tab.path })),
    patchTab: (key, fields) =>
      update((s) => ({
        ...s,
        openFiles: s.openFiles.map((f) => (f.path === key ? { ...f, ...fields(f) } : f)),
      })),
    closeTab: (key) => closeFile(key),
    setActive: (key) => setActiveFile(key),
    loads: fileLoads,
    openFileAt: (path, line) => openFile(path, { scrollToLine: line }),
    dropMatches: (key) => {
      const hadMatches = (get({ subscribe }).matches.get(key)?.length ?? 0) > 0;
      if (hadMatches) setMatches(key, []);
      return hadMatches;
    },
  });

  /**
   * Fetch file index in the background and update file metadata
   * Uses GET /v1/index to get cached index data including anomalies
   */
  function fetchFileIndex(path: string, isIndexed?: boolean) {
    // If we know the file is not indexed, skip the fetch
    if (isIndexed === false) {
      return;
    }

    api
      .getIndex(path)
      .then((indexData) => applyIndex(path, indexData))
      .catch((e) => {
        // Silently ignore index errors - it's just for enhancement
        // 404 means no index exists, which is fine
        update((s) => ({
          ...s,
          openFiles: s.openFiles.map((f) => (f.path === path ? { ...f, isIndexed: false } : f)),
        }));
        console.debug('File index fetch failed (non-critical):', path, e);
      });
  }

  /**
   * Ask the backend for a file's time range and keep it on the file,
   * superseding any ask still out for it. A backend that does not list
   * `time_range` is asked nothing. The features are known once the
   * contract gate opens: a file named in the link opens before the
   * first `/health` answer. A failed call leaves the range as it was
   * (null for a file that has none yet); the file opens all the same.
   * The file is marked as reading its range until the last ask ends.
   *
   * The ask carries the file's chosen zone. A zone the backend refuses
   * (400) is dropped with a notice, and the file is read again as its
   * lines write times.
   */
  async function loadTimeRange(path: string) {
    setReadingTimeRange(path, true);
    let range: TimeRangeResponse | null = null;
    let sentZone: string | undefined;
    try {
      const answer = await timeRangeLoads.run(path, async (signal) => {
        await contractGate.pass(signal);
        if (!backendHas('time_range')) return null;
        sentZone = requestZoneOf(path);
        return api.getTimeRange(path, { signal, fileTz: sentZone });
      });
      // A newer ask for the file took over, and ends the reading.
      if (answer === SUPERSEDED) return;
      range = answer;
    } catch (e) {
      // Cancelled by a newer ask or by closing the file.
      if (isAbortError(e)) return;
      if (sentZone !== undefined && e instanceof ApiError && e.status === HTTP_BAD_REQUEST) {
        setReadingTimeRange(path, false);
        void dropRefusedZone(path, sentZone, e.message);
        return;
      }
      console.debug('File time range fetch failed (non-critical):', path, e);
    }
    update((s) => ({
      ...s,
      openFiles: s.openFiles.map((f) =>
        f.path === path ? { ...f, timeRange: range ?? f.timeRange, isReadingTimeRange: false } : f,
      ),
    }));
  }

  /**
   * Drop the zone chosen for `path` after the backend refused it, say so,
   * and read the file again as its lines write times. A zone chosen since
   * the refused one was sent stays.
   */
  async function dropRefusedZone(path: string, zone: string, reason: string) {
    if (fileZones.zoneOf(path) !== zone) return;
    fileZones.clear(path);
    const name = path.split('/').pop() ?? path;
    notifications.error(`Cannot read ${name} in the zone ${zone}: ${reason}`, 5000);
    await readAgainInItsZone(path);
  }

  /** Whether the tab `key` is open. */
  function isOpen(key: TabKey): boolean {
    return get({ subscribe }).openFiles.some((f) => f.path === key);
  }

  /**
   * Read `path`'s timestamps as wall clock in `zone`, or as its lines
   * write them with null; the choice is kept for the file when it is not
   * open. An open file asks for its time range again and loads its window
   * again around its anchor line, so the times of its lines and the
   * status bar's command follow the zone; it stays on that line, and a
   * jump by time it was at ends. Returns false when the zone cannot be
   * kept: not a zone, or every file holding one is open and no more fit.
   */
  async function setFileZone(path: string, zone: string | null): Promise<boolean> {
    if (zone === null) {
      fileZones.clear(path);
    } else if (!fileZones.set(path, zone, isOpen)) {
      return false;
    }
    await readAgainInItsZone(path);
    return true;
  }

  /**
   * Ask an open file's time range and its window around its anchor line
   * again, each in the zone its requests now carry. The file stays on its
   * line and is no longer where a jump by time put it.
   */
  async function readAgainInItsZone(path: string) {
    if (isChainKey(path)) return chains.reload(path);
    const file = get({ subscribe }).openFiles.find((f) => f.path === path);
    if (!file) return;
    const line = file.anchorLine;
    update((s) => ({
      ...s,
      openFiles: s.openFiles.map((f) => (f.path === path ? { ...f, ...movedByLine(line) } : f)),
    }));
    void loadTimeRange(path);
    await loadLinesAroundCenter(path, line, JUMP_CONTEXT);
  }

  /** Mark a file as reading its time range, or done reading it. */
  function setReadingTimeRange(path: string, isReadingTimeRange: boolean) {
    update((s) => ({
      ...s,
      openFiles: s.openFiles.map((f) => (f.path === path ? { ...f, isReadingTimeRange } : f)),
    }));
  }

  /**
   * Whether a file's first window should be followed by another ask for
   * its range. The backend builds the line index of every compressed file
   * it reads, sometimes inside the samples answer with no build to
   * follow, and a compressed file's range is unknown (`source: none`)
   * until it has that index.
   */
  function rangeWaitsForIndex(path: string): boolean {
    const file = get({ subscribe }).openFiles.find((f) => f.path === path);
    if (!file || !file.isCompressed) return false;
    // A build followed in the background asks for the range when it ends.
    if (file.pendingIndex === 'building') return false;
    return file.timeRange === null || file.timeRange.source === 'none';
  }

  /**
   * Take a file's line count and anomalies from its index. A file that is
   * not open is left alone. The file waits for no index any more: a build
   * it followed in the background is no longer followed.
   */
  function applyIndex(path: string, indexData: IndexResponse) {
    indexFollows.stop(path);
    update((s) => ({
      ...s,
      openFiles: s.openFiles.map((f) => {
        if (f.path !== path) return f;
        return {
          ...f,
          totalLines: indexData.line_count ?? f.totalLines,
          isIndexed: true,
          fileType: indexData.file_type ?? f.fileType,
          pendingIndex: null,
          backgroundIndexBuild: null,
          anomalies: indexData.anomalies ?? null,
          anomalySummary: countAnomaliesByCategory(indexData.anomalies),
        };
      }),
    }));
  }

  /**
   * Open a file and load its first window, or bring an open file to the
   * front, moved to `scrollToLine` when one is given.
   */
  async function openFile(path: string, options: OpenFileOptions = {}) {
    // A chain's key never names a file: the chain opens with openChain.
    if (isChainKey(path)) throw new Error(`${path} is a log chain's key, not a file`);
    const { scrollToLine, fileSize, isIndexed, lineCount, compressionFormat = null } = options;
    const state = get({ subscribe });

    // Check if already open
    const existingIndex = state.openFiles.findIndex((f) => f.path === path);
    if (existingIndex >= 0) {
      // An open file brought forward without a line is a tab shown again.
      if (scrollToLine === undefined) {
        setActiveFile(path);
        return;
      }
      update((s) => ({
        ...s,
        activeFilePath: path,
        openFiles: s.openFiles.map((f, i) =>
          i === existingIndex ? { ...f, ...movedByLine(scrollToLine) } : f,
        ),
      }));
      return;
    }

    // Create placeholder file entry
    const name = path.split('/').pop() || path;

    // The size-based default, unless the caller (a link) says otherwise.
    const syntaxHighlighting = options.syntaxHighlighting ?? defaultSyntaxHighlighting(fileSize);

    const newFile: OpenFile = {
      path,
      name,
      lines: [],
      totalLines: lineCount ?? null,
      startLine: 1,
      endLine: 0,
      loading: true,
      error: null,
      isCompressed: compressionFormat !== null,
      compressionFormat,
      fileType: null,
      scrollToLine,
      reachedStart: false,
      reachedEnd: false,
      syntaxHighlighting,
      fileSize: fileSize ?? null,
      regexFilter: null, // Disabled by default
      showInvisibleChars: false, // Disabled by default
      wordWrap: false, // Disabled by default (horizontal scroll)
      // Anomaly data - will be populated from index fetch
      isIndexed: isIndexed ?? false,
      anomalies: null,
      anomalySummary: null,
      selectedAnomalyCategory: null,
      anchorLine: scrollToLine ?? 1,
      indexBuild: null,
      pendingIndex: null,
      backgroundIndexBuild: null,
      timeRange: null,
      isReadingTimeRange: false,
      timeJump: null,
    };

    // Add file to the end and make it active
    update((s) => ({
      ...s,
      openFiles: [...s.openFiles, newFile],
      activeFilePath: path,
    }));

    // Fetch file index in background to get total line count and anomalies
    fetchFileIndex(path, isIndexed);
    // The time range loads beside the window and never holds it up.
    void loadTimeRange(path);

    // Load initial content
    if (scrollToLine) {
      // If scrolling to a specific line, load the lines around it
      await loadLinesAroundCenter(path, scrollToLine, JUMP_CONTEXT);
    } else {
      // When opening a file, always start from line 1
      await loadLinesFromStart(path, linesPerPage(newFile));
    }

    if (rangeWaitsForIndex(path)) void loadTimeRange(path);
  }

  /**
   * Report a window load that failed. A backend that refuses a binary
   * file with an error naming it (rx-python's 400) gets a notification
   * and the tab closes; anything else shows in the file's tab.
   */
  function showLoadError(path: string, e: unknown) {
    const errorMessage = e instanceof Error ? e.message : 'Failed to load file';

    if (errorMessage.includes('binary') || errorMessage.includes('Binary')) {
      notifications.error(`Cannot open binary file: ${path.split('/').pop()}`, 5000);
      update((s) => ({
        ...s,
        openFiles: s.openFiles.filter((f) => f.path !== path),
      }));
    } else {
      update((s) => ({
        ...s,
        openFiles: s.openFiles.map((f) =>
          f.path === path ? { ...f, loading: false, error: errorMessage, indexBuild: null } : f,
        ),
      }));
    }
    console.error('Failed to load file:', e);
  }

  /**
   * Show the index build a window load of `path` waits for, or clear it
   * with null.
   */
  function showIndexBuild(path: string, build: IndexBuild | null) {
    update((s) => ({
      ...s,
      openFiles: s.openFiles.map((f) => (f.path === path ? { ...f, indexBuild: build } : f)),
    }));
  }

  /** Set some fields of the open tab `key`; a tab that is not open is left alone. */
  function setFileFields(key: TabKey, fields: Partial<OpenFile>) {
    update((s) => ({
      ...s,
      openFiles: s.openFiles.map((f) => (f.path === key ? { ...f, ...fields } : f)),
    }));
  }

  /**
   * Follow the line index build a samples answer for `path` names, while
   * the file shows its lines: the file is marked as waiting for its index
   * and shows the build's progress. When the build ends the index is
   * applied as after an Index from the tree's menu, and the file's time
   * range is asked again; a failed build is said in a quiet notice and the
   * file stays without an index. An answer that names no build changes
   * nothing: only an index ends the wait.
   */
  function followIndexBuild(path: string, response: SamplesResponse) {
    // A backend older than the field leaves it out.
    const build = response.index_build ?? null;
    if (build === null || !isOpen(path)) return;
    setFileFields(path, { pendingIndex: 'building' });
    indexFollows.follow(path, build.task_id, {
      onStatus: (progress) => setFileFields(path, { backgroundIndexBuild: progress }),
      onBuilt: (index) => {
        tree.markIndexed(path, index.line_count ?? null);
        applyIndex(path, index);
        void loadTimeRange(path);
      },
      onFailed: (error) => {
        setFileFields(path, { pendingIndex: 'failed', backgroundIndexBuild: null });
        const name = path.split('/').pop() ?? path;
        const reason = error instanceof Error ? error.message : String(error);
        notifications.info(`The line index of ${name} could not be built: ${reason}`);
      },
    });
  }

  /**
   * The options of a window load of `path`: its signal, the build it may
   * wait for, and the index that build leaves, which gives the file its
   * line count and anomalies as an Index from the tree's menu does. A
   * load that waits for a build marks the file as waiting for its index.
   */
  function loadOptions(path: string, signal: AbortSignal) {
    return {
      signal,
      onIndexBuild: (build: IndexBuild | null) => {
        showIndexBuild(path, build);
        if (build !== null) setFileFields(path, { pendingIndex: 'building' });
      },
      onIndexBuilt: (index: IndexResponse) => {
        applyIndex(path, index);
        // The range may now come from the index: a compressed file's
        // range is known only from there.
        void loadTimeRange(path);
      },
    };
  }

  /**
   * Replace a file's lines with a freshly loaded window. The window's own
   * ends decide whether paging may continue in either direction, and a
   * window that shows where the file ends also gives its line count,
   * and moves a target past that end onto the last line.
   * `extra` holds any other fields to set in the same update.
   */
  function showWindow(
    path: string,
    window: SampleWindow,
    response: SamplesResponse,
    extra: Partial<OpenFile> = {},
  ) {
    const bounds = windowBounds(window);
    update((s) => ({
      ...s,
      openFiles: s.openFiles.map((f) =>
        f.path === path
          ? {
              ...f, // Preserve all existing fields
              ...bounds,
              totalLines: window.lineCount ?? f.totalLines,
              loading: false,
              indexBuild: null,
              isCompressed: response.is_compressed,
              compressionFormat: response.compression_format,
              anchorLine: clampAnchor(f.anchorLine, bounds),
              scrollToLine:
                f.scrollToLine === undefined ? undefined : clampAnchor(f.scrollToLine, bounds),
              ...extra,
            }
          : f,
      ),
    }));
    followIndexBuild(path, response);
  }

  /**
   * Load lines from the start of the file
   * This loads lines 1 to totalLines
   */
  async function loadLinesFromStart(path: string, totalLines: number) {
    update((s) => ({
      ...s,
      openFiles: s.openFiles.map((f) =>
        f.path === path ? { ...f, loading: true, error: null } : f,
      ),
    }));

    try {
      const range = `1-${totalLines}`;
      const response = await fileLoads.run(path, (signal) =>
        loadSamples(path, [range], undefined, loadOptions(path, signal)),
      );
      if (response === SUPERSEDED) return;

      commandLog.record(response.cli_command, 'file');
      showWindow(path, readSamplesAnswer(response), response);
    } catch (e) {
      // A superseded load was cancelled on purpose; it is not a failure.
      if (isAbortError(e)) return;
      showLoadError(path, e);
    }
  }

  /**
   * Load lines around a center line using context parameter
   * Uses /v1/samples?path=...&lines=<centerLine>&context=<contextLines>
   * This returns lines from max(1, centerLine - context) to (centerLine + context)
   *
   * A center so far past the end that its window holds no line shows the
   * end of the file instead, the nearest lines that exist.
   */
  async function loadLinesAroundCenter(
    path: string,
    centerLine: number,
    contextLines: number = JUMP_CONTEXT,
  ) {
    update((s) => ({
      ...s,
      openFiles: s.openFiles.map((f) =>
        f.path === path ? { ...f, loading: true, error: null } : f,
      ),
    }));

    try {
      const response = await fileLoads.run(path, (signal) =>
        loadSamples(path, [centerLine.toString()], contextLines, loadOptions(path, signal)),
      );
      if (response === SUPERSEDED) return;

      commandLog.record(response.cli_command, 'file');
      const window = readSamplesAnswer(response);
      if (window.lines.length === 0 && !window.reachedStart) {
        await jumpToEnd(path);
        return;
      }
      showWindow(path, window, response);
    } catch (e) {
      // A superseded load was cancelled on purpose; it is not a failure.
      if (isAbortError(e)) return;
      showLoadError(path, e);
    }
  }

  /**
   * Load more lines (before or after current content)
   */
  async function loadMore(path: string, direction: 'before' | 'after') {
    if (isChainKey(path)) return chains.loadMore(path, direction);
    const state = get({ subscribe });
    const file = state.openFiles.find((f) => f.path === path);
    if (!file || file.loading || file.lines.length === 0) return;

    // Check if we've already reached the boundary
    if (direction === 'before' && file.reachedStart) return;
    if (direction === 'after' && file.reachedEnd) return;

    // Calculate the range to load based on direction
    const pageSize = linesPerPage(file);
    let startLine: number;
    let endLine: number;

    if (direction === 'before') {
      // Load lines before the current start
      endLine = file.startLine - 1;
      startLine = Math.max(1, endLine - pageSize + 1);
    } else {
      // Load lines after the current end
      startLine = file.endLine + 1;
      endLine = startLine + pageSize - 1;
    }

    update((s) => ({
      ...s,
      openFiles: s.openFiles.map((f) => (f.path === path ? { ...f, loading: true } : f)),
    }));

    try {
      const range = `${startLine}-${endLine}`;
      const response = await fileLoads.run(path, (signal) =>
        loadSamples(path, [range], undefined, loadOptions(path, signal)),
      );
      if (response === SUPERSEDED) return;

      const window = readSamplesAnswer(response);
      const maxLines = maxHeldLines(pageSize);

      update((s) => ({
        ...s,
        openFiles: s.openFiles.map((f) => {
          if (f.path !== path) return f;

          // The page joins the held lines, and the cap drops lines at
          // the other end; paging back loads them again.
          const held = addPage(f.lines, window.lines, direction, maxLines);
          const newStartLine = held.lines[0]?.lineNumber ?? 1;
          const newEndLine = held.lines.at(-1)?.lineNumber ?? 0;
          // A range after the loaded lines that comes back short or null
          // ends the file, and the loaded lines run up to that end. Lines
          // dropped at the end mean the window stops short of it again.
          const reachedEnd = direction === 'after' ? window.reachedEnd : f.reachedEnd;
          return {
            ...f,
            lines: held.lines,
            startLine: newStartLine,
            endLine: newEndLine,
            reachedStart: newStartLine === 1,
            reachedEnd: reachedEnd && !held.droppedAfter,
            totalLines: direction === 'after' && reachedEnd ? newEndLine : f.totalLines,
            loading: false,
          };
        }),
      }));
      followIndexBuild(path, response);
    } catch (e) {
      // A superseded load was cancelled on purpose. The load that
      // replaced this one owns the loading flag now.
      if (isAbortError(e)) return;

      update((s) => ({
        ...s,
        openFiles: s.openFiles.map((f) => (f.path === path ? { ...f, loading: false } : f)),
      }));
      console.error('Failed to load more lines:', e);
    }
  }

  /**
   * Jump to a specific line in a file, loading the lines around it
   * (`JUMP_CONTEXT` on each side) when the window does not hold it
   */
  async function jumpToLine(path: string, lineNumber: number) {
    if (isChainKey(path)) return chains.jumpToPosition(path, lineNumber);
    const state = get({ subscribe });
    const file = state.openFiles.find((f) => f.path === path);

    if (!file) {
      // Open file and scroll to line
      await openFile(path, { scrollToLine: lineNumber });
      return;
    }

    // Check if line is already loaded
    if (lineNumber >= file.startLine && lineNumber <= file.endLine) {
      // Line is already loaded, just scroll to it and make file active
      update((s) => ({
        ...s,
        activeFilePath: path,
        openFiles: s.openFiles.map((f) =>
          f.path === path ? { ...f, ...movedByLine(lineNumber) } : f,
        ),
      }));
    } else {
      // Set scroll position and active file BEFORE loading
      update((s) => ({
        ...s,
        activeFilePath: path,
        openFiles: s.openFiles.map((f) =>
          f.path === path ? { ...f, ...movedByLine(lineNumber) } : f,
        ),
      }));

      // Load lines around the target
      await loadLinesAroundCenter(path, lineNumber, JUMP_CONTEXT);
    }
  }

  /**
   * Jump to the end of a file using -1 line number
   * This fetches the last N lines and discovers the total line count
   */
  async function jumpToEnd(path: string) {
    if (isChainKey(path)) return chains.jumpToEnd(path);
    const state = get({ subscribe });
    const file = state.openFiles.find((f) => f.path === path);

    if (!file) {
      // Open file first, then jump to end
      await openFile(path);
      // After opening, call jumpToEnd again
      await jumpToEnd(path);
      return;
    }

    await showEnd(path, null);
  }

  /**
   * Load and show the last window of an open file, anchored on its last
   * line. `timeJump` is the time jump that moved it there, or null.
   */
  async function showEnd(path: string, timeJump: number | null) {
    update((s) => ({
      ...s,
      openFiles: s.openFiles.map((f) =>
        f.path === path ? { ...f, loading: true, error: null } : f,
      ),
    }));

    try {
      // Request line -1 with context to get the last lines
      const response = await fileLoads.run(path, (signal) =>
        loadSamples(path, ['-1'], JUMP_CONTEXT, loadOptions(path, signal)),
      );
      if (response === SUPERSEDED) return;

      commandLog.record(response.cli_command, 'file');
      // rx-go answers -1 under the key of the last line, so the window
      // ends at the end of the file whatever context was asked for.
      const window = readSamplesAnswer(response);
      const { endLine } = windowBounds(window);
      showWindow(path, { ...window, reachedEnd: true, lineCount: endLine }, response, {
        scrollToLine: endLine,
        anchorLine: endLine,
        timeJump,
      });
    } catch (e) {
      // A superseded load was cancelled on purpose; it is not a failure.
      if (isAbortError(e)) return;
      const errorMessage = e instanceof Error ? e.message : 'Failed to load file';

      update((s) => ({
        ...s,
        openFiles: s.openFiles.map((f) =>
          f.path === path
            ? {
                ...f,
                loading: false,
                error: errorMessage,
              }
            : f,
        ),
      }));
      console.error('Failed to jump to end:', e);
    }
  }

  /**
   * Move an open file to the first line at or after a time, the way
   * `jumpToLine` moves it to a line: the window around the found line,
   * anchored on it. The file is made active.
   *
   * The file keeps the jump's instant (`timeJump`): the query for an
   * instant, the found line's own time for a typed text. No line at or
   * after the time shows the file's last window with a notice. A refusal
   * leaves the file as it was, and a file that held no lines yet loads
   * its start. A backend that does not list `samples_timestamps` is
   * asked nothing; the features are known once the contract gate opens.
   *
   * A jump that reads its value makes that instant the time cursor; a
   * typed text the file reads with no line at or after it has no instant
   * and leaves the cursor as it was. A refused value sets nothing, so a
   * mistyped value never moves the cursor. No other file moves. A log
   * chain's tab moves the same way (`stores/chainTabs.ts`).
   */
  async function jumpToTime(path: string, query: TimeQuery): Promise<TimeJumpOutcome> {
    if (isChainKey(path)) return chains.jumpToTime(path, query);
    if (!get({ subscribe }).openFiles.some((f) => f.path === path)) {
      return { kind: 'refused', message: `${path} is not open` };
    }
    update((s) => ({ ...s, activeFilePath: path }));
    await contractGate.pass();
    if (!backendHas('samples_timestamps')) return { kind: 'unsupported' };

    const value = timeQueryValue(query);
    setLoading(path, true);
    try {
      const response = await fileLoads.run(path, (signal) =>
        loadSamplesByTime(path, value, JUMP_CONTEXT, loadOptions(path, signal)),
      );
      if (response === SUPERSEDED) return { kind: 'superseded' };

      commandLog.record(response.cli_command, 'file');
      const answer = readTimeAnswer(response, value);
      const instant = typeof query === 'number' ? query : null;
      if (!answer.found) {
        await showEnd(path, instant);
        if (instant !== null) timeCursor.set(instant);
        const file = get({ subscribe }).openFiles.find((f) => f.path === path);
        if (file) {
          notifications.info(`No line at or after ${timeQueryLabel(query, file)} in ${file.name}`);
        }
        return { kind: 'none' };
      }

      const foundTime = answer.window.lines.find((l) => l.lineNumber === answer.line)?.timestampMs;
      const jumpInstant = instant ?? foundTime ?? null;
      showWindow(path, answer.window, response, {
        scrollToLine: answer.line,
        anchorLine: answer.line,
        timeJump: jumpInstant,
      });
      if (jumpInstant !== null) timeCursor.set(jumpInstant);
      return { kind: 'found', line: answer.line };
    } catch (e) {
      if (isAbortError(e)) return { kind: 'superseded' };
      setLoading(path, false);
      const file = get({ subscribe }).openFiles.find((f) => f.path === path);
      if (file && file.lines.length === 0) void loadLinesFromStart(path, linesPerPage(file));
      return { kind: 'refused', message: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * Clear the time cursor (the × in the tab row). No file is held as a
   * jump by time any more: each stays where it is, and the URL names its
   * line in place of the time.
   */
  function clearTimeCursor() {
    timeCursor.clear();
    update((s) => ({
      ...s,
      openFiles: s.openFiles.map((f) => (f.timeJump === null ? f : { ...f, timeJump: null })),
    }));
  }

  /** Mark a tab loading, or done loading; loading also clears its error. */
  function setLoading(key: TabKey, loading: boolean) {
    update((s) => ({
      ...s,
      openFiles: s.openFiles.map((f) =>
        f.path === key ? (loading ? { ...f, loading, error: null } : { ...f, loading }) : f,
      ),
    }));
  }

  /** Close a tab, and cancel and forget everything kept for its key. */
  function closeFile(key: TabKey) {
    // Cancel anything still loading for this file and drop its slot.
    fileLoads.forget(key);
    if (isChainKey(key)) chains.forget(key);
    timeRangeLoads.forget(key);
    indexFollows.stop(key);
    forgetPane(key);

    update((s) => ({
      ...s,
      openFiles: s.openFiles.filter((f) => f.path !== key),
      matches: (() => {
        const newMatches = new Map(s.matches);
        newMatches.delete(key);
        return newMatches;
      })(),
    }));
  }

  /** Set the search matches the tab `key` highlights. */
  function setMatches(key: TabKey, matches: FileMatch[]) {
    update((s) => {
      const newMatches = new Map(s.matches);
      newMatches.set(key, matches);
      return { ...s, matches: newMatches };
    });
  }

  /**
   * Remove the search-match highlights from every file. They belong to
   * one search, so a new search starts from none.
   */
  function clearMatches() {
    update((s) => (s.matches.size === 0 ? s : { ...s, matches: new Map() }));
  }

  /**
   * Clear scroll position after scrolling is done
   */
  function clearScrollPosition(key: TabKey) {
    update((s) => ({
      ...s,
      openFiles: s.openFiles.map((f) => (f.path === key ? { ...f, scrollToLine: undefined } : f)),
    }));
  }

  /**
   * Reorder files (for drag and drop)
   */
  function reorderFiles(fromIndex: number, toIndex: number) {
    update((s) => {
      const newOpenFiles = [...s.openFiles];
      const [movedFile] = newOpenFiles.splice(fromIndex, 1);
      newOpenFiles.splice(toIndex, 0, movedFile);
      return { ...s, openFiles: newOpenFiles };
    });
  }

  /** Turn syntax highlighting of a file on or off. */
  function setSyntaxHighlighting(key: TabKey, on: boolean) {
    update((s) => ({
      ...s,
      openFiles: s.openFiles.map((f) => (f.path === key ? { ...f, syntaxHighlighting: on } : f)),
    }));
  }

  /**
   * Set the line the URL names for a file; the editor reports it after a
   * scroll. A different line is a move by line, which ends the time jump.
   * A chain's tab also keeps the line's part, its line in it and its time.
   */
  function setAnchorLine(key: TabKey, line: number) {
    update((s) => ({
      ...s,
      openFiles: s.openFiles.map((f) => {
        if (f.path !== key || line === f.anchorLine) return f;
        const anchor = f.chain ? anchorAt(f.lines, f.startLine, line) : null;
        const chain = f.chain && anchor ? { ...f.chain, anchor } : f.chain;
        return { ...f, anchorLine: line, timeJump: null, ...(chain ? { chain } : {}) };
      }),
    }));
  }

  /**
   * Open the tab of the log chain `handle` (`stores/chainTabs.ts`), or
   * bring it forward at `options.position`. Resolves false when the
   * chain's files are not the ones `options.fingerprint` names.
   */
  function openChain(handle: string, options: OpenChainOptions = {}): Promise<boolean> {
    return chains.openChain(handle, options);
  }

  /**
   * Describe the chain `handle` again in its open tab, as after its index
   * task ended; nothing when no tab of it is open.
   */
  function refreshChain(handle: string): Promise<void> {
    return chains.refresh(chainKey(handle));
  }

  /** Move a chain's tab to a position: a global line, a part's line, its start or end. */
  function goToChainLine(key: TabKey, position: ChainPosition): Promise<void> {
    return chains.moveTo(key, position);
  }

  /**
   * Toggle syntax highlighting for a specific file
   */
  function toggleSyntaxHighlighting(key: TabKey) {
    update((s) => ({
      ...s,
      openFiles: s.openFiles.map((f) =>
        f.path === key ? { ...f, syntaxHighlighting: !f.syntaxHighlighting } : f,
      ),
    }));
  }

  /**
   * Toggle regex filter for a specific file
   */
  function toggleRegexFilter(key: TabKey) {
    update((s) => ({
      ...s,
      openFiles: s.openFiles.map((f) => {
        if (f.path !== key) return f;

        if (f.regexFilter === null) {
          // Enable with default settings
          return {
            ...f,
            regexFilter: {
              enabled: true,
              pattern: '',
              mode: 'highlight',
              compiledRegex: null,
              error: null,
              applying: false,
            },
          };
        } else {
          // Toggle enabled state
          return {
            ...f,
            regexFilter: {
              ...f.regexFilter,
              enabled: !f.regexFilter.enabled,
            },
          };
        }
      }),
    }));
  }

  /**
   * Apply the filter bar's pattern and mode to a file. A file without a
   * filter gets one, enabled; one with a filter keeps its enabled state.
   */
  function updateRegexFilter(key: TabKey, pattern: string, mode: 'hide' | 'show' | 'highlight') {
    update((s) => ({
      ...s,
      openFiles: s.openFiles.map((f) => {
        if (f.path !== key) return f;
        const current = f.regexFilter ?? { enabled: true, applying: false };
        return {
          ...f,
          regexFilter: {
            enabled: current.enabled,
            applying: current.applying,
            pattern,
            mode,
            ...compileFilterPattern(pattern),
          },
        };
      }),
    }));
  }

  /** Apply a filter to a file, enabled, or remove its filter when given null. */
  function setRegexFilter(key: TabKey, filter: FilterState | null) {
    update((s) => ({
      ...s,
      openFiles: s.openFiles.map((f) => {
        if (f.path !== key) return f;
        if (!filter) return { ...f, regexFilter: null };
        return {
          ...f,
          regexFilter: {
            enabled: true,
            applying: false,
            pattern: filter.pattern,
            mode: filter.mode,
            ...compileFilterPattern(filter.pattern),
          },
        };
      }),
    }));
  }

  /**
   * Clear regex filter for a specific file
   */
  function clearRegexFilter(key: TabKey) {
    update((s) => ({
      ...s,
      openFiles: s.openFiles.map((f) => (f.path === key ? { ...f, regexFilter: null } : f)),
    }));
  }

  /**
   * Toggle invisible characters display for a specific file
   */
  function toggleInvisibleChars(key: TabKey) {
    update((s) => ({
      ...s,
      openFiles: s.openFiles.map((f) =>
        f.path === key ? { ...f, showInvisibleChars: !f.showInvisibleChars } : f,
      ),
    }));
  }

  /**
   * Toggle word wrap for a specific file
   */
  function toggleWordWrap(key: TabKey) {
    update((s) => ({
      ...s,
      openFiles: s.openFiles.map((f) => (f.path === key ? { ...f, wordWrap: !f.wordWrap } : f)),
    }));
  }

  /** Make the tab `key` the active one (a click on its tab, say). */
  function setActiveFile(key: TabKey) {
    update((s) => ({
      ...s,
      activeFilePath: key,
    }));
  }

  /**
   * Set highlighted line range for a file (e.g., from anomaly click)
   */
  function setHighlightedLines(key: TabKey, lines: { start: number; end: number } | null) {
    update((s) => ({
      ...s,
      openFiles: s.openFiles.map((f) => (f.path === key ? { ...f, highlightedLines: lines } : f)),
    }));
  }

  /**
   * Set the selected anomaly category for highlighting
   * @param key - The tab's key
   * @param category - Category name to highlight, or null to clear
   */
  function setSelectedAnomalyCategory(key: TabKey, category: string | null) {
    update((s) => ({
      ...s,
      openFiles: s.openFiles.map((f) =>
        f.path === key ? { ...f, selectedAnomalyCategory: category, highlightedLines: null } : f,
      ),
    }));
  }

  /**
   * Toggle an anomaly category for highlighting (radio button behavior)
   * If the category is already selected, it will be deselected
   */
  function toggleAnomalyCategory(key: TabKey, category: string) {
    const state = get({ subscribe });
    const file = state.openFiles.find((f) => f.path === key);
    if (!file) return;

    const newCategory = file.selectedAnomalyCategory === category ? null : category;
    setSelectedAnomalyCategory(key, newCategory);
  }

  return {
    subscribe,
    openFile,
    openChain,
    refreshChain,
    goToChainLine,
    applyIndex,
    closeFile,
    loadMore,
    jumpToLine,
    jumpToEnd,
    jumpToTime,
    clearTimeCursor,
    setFileZone,
    setMatches,
    clearMatches,
    clearScrollPosition,
    reorderFiles,
    toggleSyntaxHighlighting,
    setSyntaxHighlighting,
    setAnchorLine,
    toggleRegexFilter,
    updateRegexFilter,
    setRegexFilter,
    clearRegexFilter,
    toggleInvisibleChars,
    toggleWordWrap,
    setActiveFile,
    setHighlightedLines,
    setSelectedAnomalyCategory,
    toggleAnomalyCategory,
  };
}

export const files = createFilesStore();

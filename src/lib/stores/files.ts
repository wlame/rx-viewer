import { writable, get } from 'svelte/store';
import { api } from '../api';
import { countAnomaliesByCategory } from '../utils/anomalyCategories';
import { LatestRequestMap, SUPERSEDED, isAbortError } from '../utils/latestRequest';
import { clampAnchor } from '../utils/anchorLine';
import type { FilterState } from '../utils/urlState';
import { readSamplesAnswer, type SampleWindow } from '../utils/sampleWindow';
import { addPage, maxHeldLines } from '../utils/slidingWindow';
import type { OpenFile, FileMatch, IndexResponse, SamplesResponse } from '../types';
import { commandLog } from './commands';
import { notifications } from './notifications';
import { forgetPane } from './paneMemory';
import { settings } from './settings';

/**
 * At most one window load per file may write to the store.
 *
 * Every load below updates the file it matches by path, so two
 * overlapping loads for the same file both applied, in arrival order.
 * Jump to line 1,000,000 and then to line 5 on a slow link and the
 * editor could settle on the first target. Keyed by path so a load in
 * one tab does not cancel another tab's.
 */
const fileLoads = new LatestRequestMap();

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

interface FilesState {
  openFiles: OpenFile[];
  matches: Map<string, FileMatch[]>; // path -> matches
  activeFilePath: string | null; // Currently active/focused file
}

/**
 * The file the editor shows: the one `activeFilePath` names, or the last
 * open file when it names none that is open.
 */
export function activeOpenFile(state: Pick<FilesState, 'openFiles' | 'activeFilePath'>) {
  return state.openFiles.find((f) => f.path === state.activeFilePath) ?? state.openFiles.at(-1);
}

/** Files this size and larger open with syntax highlighting off. */
const HIGHLIGHT_SIZE_LIMIT = 1024 * 1024;

/**
 * Whether a file opens with syntax highlighting: on below 1 MB, off from
 * 1 MB up, on when the size is unknown.
 */
export function defaultSyntaxHighlighting(fileSize: number | null | undefined): boolean {
  return fileSize === null || fileSize === undefined || fileSize < HIGHLIGHT_SIZE_LIMIT;
}

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
   * Take a file's line count and anomalies from its index. A file that is
   * not open is left alone.
   */
  function applyIndex(path: string, indexData: IndexResponse) {
    update((s) => ({
      ...s,
      openFiles: s.openFiles.map((f) => {
        if (f.path !== path) return f;
        return {
          ...f,
          totalLines: indexData.line_count ?? f.totalLines,
          isIndexed: true,
          anomalies: indexData.anomalies ?? null,
          anomalySummary: countAnomaliesByCategory(indexData.anomalies),
        };
      }),
    }));
  }

  /**
   * Open a file and load initial content
   */
  async function openFile(
    path: string,
    scrollToLine?: number,
    fileSize?: number | null,
    syntaxHighlightingOverride?: boolean,
    isIndexed?: boolean,
    lineCount?: number | null,
  ) {
    const state = get({ subscribe });

    // Check if already open
    const existingIndex = state.openFiles.findIndex((f) => f.path === path);
    if (existingIndex >= 0) {
      // File is already open - activate it and update scroll position if provided
      update((s) => ({
        ...s,
        activeFilePath: path,
        openFiles:
          scrollToLine !== undefined
            ? s.openFiles.map((f, i) =>
                i === existingIndex ? { ...f, scrollToLine, anchorLine: scrollToLine } : f,
              )
            : s.openFiles,
      }));
      return;
    }

    // Create placeholder file entry
    const name = path.split('/').pop() || path;

    // The size-based default, unless the caller (a link) says otherwise.
    const syntaxHighlighting = syntaxHighlightingOverride ?? defaultSyntaxHighlighting(fileSize);

    const newFile: OpenFile = {
      path,
      name,
      lines: [],
      totalLines: lineCount ?? null,
      startLine: 1,
      endLine: 0,
      loading: true,
      error: null,
      isCompressed: false,
      compressionFormat: null,
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
    };

    // Add file to the end and make it active
    update((s) => ({
      ...s,
      openFiles: [...s.openFiles, newFile],
      activeFilePath: path,
    }));

    // Fetch file index in background to get total line count and anomalies
    fetchFileIndex(path, isIndexed);

    // Load initial content
    const linesPerPage = get(settings).linesPerPage;
    if (scrollToLine) {
      // If scrolling to a specific line, load around that line with context of 500
      await loadLinesAroundCenter(path, scrollToLine, 500);
    } else {
      // When opening a file, always start from line 1
      await loadLinesFromStart(path, linesPerPage);
    }
  }

  /**
   * Report a window load that failed. A binary file is refused with a
   * notification and closed; anything else shows in the file's tab.
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
          f.path === path ? { ...f, loading: false, error: errorMessage } : f,
        ),
      }));
    }
    console.error('Failed to load file:', e);
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
        api.getSamples(path, [range], undefined, { signal }),
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
    contextLines: number = 500,
  ) {
    update((s) => ({
      ...s,
      openFiles: s.openFiles.map((f) =>
        f.path === path ? { ...f, loading: true, error: null } : f,
      ),
    }));

    try {
      const response = await fileLoads.run(path, (signal) =>
        api.getSamples(path, [centerLine.toString()], contextLines, { signal }),
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
    const state = get({ subscribe });
    const file = state.openFiles.find((f) => f.path === path);
    if (!file || file.loading || file.lines.length === 0) return;

    // Check if we've already reached the boundary
    if (direction === 'before' && file.reachedStart) return;
    if (direction === 'after' && file.reachedEnd) return;

    const linesPerPage = get(settings).linesPerPage;

    // Calculate the range to load based on direction
    let startLine: number;
    let endLine: number;

    if (direction === 'before') {
      // Load lines before the current start
      endLine = file.startLine - 1;
      startLine = Math.max(1, endLine - linesPerPage + 1);
    } else {
      // Load lines after the current end
      startLine = file.endLine + 1;
      endLine = startLine + linesPerPage - 1;
    }

    update((s) => ({
      ...s,
      openFiles: s.openFiles.map((f) => (f.path === path ? { ...f, loading: true } : f)),
    }));

    try {
      const range = `${startLine}-${endLine}`;
      const response = await fileLoads.run(path, (signal) =>
        api.getSamples(path, [range], undefined, { signal }),
      );
      if (response === SUPERSEDED) return;

      const window = readSamplesAnswer(response);
      const maxLines = maxHeldLines(linesPerPage);

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
   * Jump to a specific line in a file
   * Uses context=500 to load lines from (lineNumber - 500) to (lineNumber + 500)
   */
  async function jumpToLine(path: string, lineNumber: number) {
    const state = get({ subscribe });
    const file = state.openFiles.find((f) => f.path === path);

    if (!file) {
      // Open file and scroll to line
      await openFile(path, lineNumber);
      return;
    }

    // Check if line is already loaded
    if (lineNumber >= file.startLine && lineNumber <= file.endLine) {
      // Line is already loaded, just scroll to it and make file active
      update((s) => ({
        ...s,
        activeFilePath: path,
        openFiles: s.openFiles.map((f) =>
          f.path === path ? { ...f, scrollToLine: lineNumber, anchorLine: lineNumber } : f,
        ),
      }));
    } else {
      // Set scroll position and active file BEFORE loading
      update((s) => ({
        ...s,
        activeFilePath: path,
        openFiles: s.openFiles.map((f) =>
          f.path === path ? { ...f, scrollToLine: lineNumber, anchorLine: lineNumber } : f,
        ),
      }));

      // Load lines around the target with context of 500 lines
      await loadLinesAroundCenter(path, lineNumber, 500);
    }
  }

  /**
   * Jump to the end of a file using -1 line number
   * This fetches the last N lines and discovers the total line count
   */
  async function jumpToEnd(path: string) {
    const state = get({ subscribe });
    const file = state.openFiles.find((f) => f.path === path);

    if (!file) {
      // Open file first, then jump to end
      await openFile(path);
      // After opening, call jumpToEnd again
      await jumpToEnd(path);
      return;
    }

    update((s) => ({
      ...s,
      openFiles: s.openFiles.map((f) =>
        f.path === path ? { ...f, loading: true, error: null } : f,
      ),
    }));

    try {
      const linesPerPage = get(settings).linesPerPage;
      const context = Math.floor(linesPerPage / 2);

      // Request line -1 with context to get the last lines
      const response = await fileLoads.run(path, (signal) =>
        api.getSamples(path, ['-1'], context, { signal }),
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
   * Close a file
   */
  function closeFile(path: string) {
    // Cancel anything still loading for this file and drop its slot.
    fileLoads.forget(path);
    forgetPane(path);

    update((s) => ({
      ...s,
      openFiles: s.openFiles.filter((f) => f.path !== path),
      matches: (() => {
        const newMatches = new Map(s.matches);
        newMatches.delete(path);
        return newMatches;
      })(),
    }));
  }

  /**
   * Set matches for a file (for highlighting)
   */
  function setMatches(path: string, matches: FileMatch[]) {
    update((s) => {
      const newMatches = new Map(s.matches);
      newMatches.set(path, matches);
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
  function clearScrollPosition(path: string) {
    update((s) => ({
      ...s,
      openFiles: s.openFiles.map((f) => (f.path === path ? { ...f, scrollToLine: undefined } : f)),
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
  function setSyntaxHighlighting(path: string, on: boolean) {
    update((s) => ({
      ...s,
      openFiles: s.openFiles.map((f) => (f.path === path ? { ...f, syntaxHighlighting: on } : f)),
    }));
  }

  /** Set the line the URL names for a file; the editor reports it after a scroll. */
  function setAnchorLine(path: string, line: number) {
    update((s) => ({
      ...s,
      openFiles: s.openFiles.map((f) => (f.path === path ? { ...f, anchorLine: line } : f)),
    }));
  }

  /**
   * Toggle syntax highlighting for a specific file
   */
  function toggleSyntaxHighlighting(path: string) {
    update((s) => ({
      ...s,
      openFiles: s.openFiles.map((f) =>
        f.path === path ? { ...f, syntaxHighlighting: !f.syntaxHighlighting } : f,
      ),
    }));
  }

  /**
   * Toggle regex filter for a specific file
   */
  function toggleRegexFilter(path: string) {
    update((s) => ({
      ...s,
      openFiles: s.openFiles.map((f) => {
        if (f.path !== path) return f;

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
  function updateRegexFilter(path: string, pattern: string, mode: 'hide' | 'show' | 'highlight') {
    update((s) => ({
      ...s,
      openFiles: s.openFiles.map((f) => {
        if (f.path !== path) return f;
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
  function setRegexFilter(path: string, filter: FilterState | null) {
    update((s) => ({
      ...s,
      openFiles: s.openFiles.map((f) => {
        if (f.path !== path) return f;
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
  function clearRegexFilter(path: string) {
    update((s) => ({
      ...s,
      openFiles: s.openFiles.map((f) => (f.path === path ? { ...f, regexFilter: null } : f)),
    }));
  }

  /**
   * Toggle invisible characters display for a specific file
   */
  function toggleInvisibleChars(path: string) {
    update((s) => ({
      ...s,
      openFiles: s.openFiles.map((f) =>
        f.path === path ? { ...f, showInvisibleChars: !f.showInvisibleChars } : f,
      ),
    }));
  }

  /**
   * Toggle word wrap for a specific file
   */
  function toggleWordWrap(path: string) {
    update((s) => ({
      ...s,
      openFiles: s.openFiles.map((f) => (f.path === path ? { ...f, wordWrap: !f.wordWrap } : f)),
    }));
  }

  /**
   * Set the active file path (used when switching tabs manually)
   */
  function setActiveFile(path: string) {
    update((s) => ({
      ...s,
      activeFilePath: path,
    }));
  }

  /**
   * Set highlighted line range for a file (e.g., from anomaly click)
   */
  function setHighlightedLines(path: string, lines: { start: number; end: number } | null) {
    update((s) => ({
      ...s,
      openFiles: s.openFiles.map((f) => (f.path === path ? { ...f, highlightedLines: lines } : f)),
    }));
  }

  /**
   * Clear highlighted lines for a file
   */
  function clearHighlightedLines(path: string) {
    setHighlightedLines(path, null);
  }

  /**
   * Set the selected anomaly category for highlighting
   * @param path - File path
   * @param category - Category name to highlight, or null to clear
   */
  function setSelectedAnomalyCategory(path: string, category: string | null) {
    update((s) => ({
      ...s,
      openFiles: s.openFiles.map((f) =>
        f.path === path ? { ...f, selectedAnomalyCategory: category, highlightedLines: null } : f,
      ),
    }));
  }

  /**
   * Toggle an anomaly category for highlighting (radio button behavior)
   * If the category is already selected, it will be deselected
   */
  function toggleAnomalyCategory(path: string, category: string) {
    const state = get({ subscribe });
    const file = state.openFiles.find((f) => f.path === path);
    if (!file) return;

    const newCategory = file.selectedAnomalyCategory === category ? null : category;
    setSelectedAnomalyCategory(path, newCategory);
  }

  return {
    subscribe,
    openFile,
    applyIndex,
    closeFile,
    loadMore,
    jumpToLine,
    jumpToEnd,
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
    clearHighlightedLines,
    setSelectedAnomalyCategory,
    toggleAnomalyCategory,
  };
}

export const files = createFilesStore();

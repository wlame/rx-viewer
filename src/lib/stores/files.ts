import { writable, get } from 'svelte/store';
import { api } from '../api';
import type { OpenFile, FileLine, FileMatch } from '../types';
import { notifications } from './notifications';
import { settings } from './settings';

interface FilesState {
  openFiles: OpenFile[];
  matches: Map<string, FileMatch[]>; // path -> matches
  activeFilePath: string | null; // Currently active/focused file
}

function createFilesStore() {
  const { subscribe, set, update } = writable<FilesState>({
    openFiles: [],
    matches: new Map(),
    activeFilePath: null,
  });

  /**
   * Fetch file index in the background and update totalLines when available
   * Uses GET /v1/index to get cached index data
   */
  function fetchFileIndex(path: string) {
    api.getIndex(path)
      .then((indexData) => {
        // Extract line_count from index data
        const lineCount = indexData.line_count;

        if (typeof lineCount === 'number' && lineCount > 0) {
          update((s) => ({
            ...s,
            openFiles: s.openFiles.map((f) =>
              f.path === path && f.totalLines === null
                ? { ...f, totalLines: lineCount }
                : f
            ),
          }));
        }
      })
      .catch((e) => {
        // Silently ignore index errors - it's just for enhancement
        // 404 means no index exists, which is fine
        console.debug('File index fetch failed (non-critical):', path, e);
      });
  }

  /**
   * Open a file and load initial content
   */
  async function openFile(
    path: string,
    scrollToLine?: number,
    fileSize?: number | null,
    syntaxHighlightingOverride?: boolean
  ) {
    const state = get({ subscribe });

    // Check if already open
    const existingIndex = state.openFiles.findIndex((f) => f.path === path);
    if (existingIndex >= 0) {
      // File is already open - activate it and update scroll position if provided
      update((s) => ({
        ...s,
        activeFilePath: path,
        openFiles: scrollToLine !== undefined
          ? s.openFiles.map((f, i) =>
              i === existingIndex ? { ...f, scrollToLine } : f
            )
          : s.openFiles,
      }));
      return;
    }

    // Create placeholder file entry
    const name = path.split('/').pop() || path;

    // Default syntax highlighting: enabled for files < 1MB, disabled for larger files
    // Can be overridden by syntaxHighlightingOverride parameter (from URL state)
    const ONE_MB = 1024 * 1024;
    const defaultSyntaxHighlighting = fileSize === null || fileSize === undefined || fileSize < ONE_MB;
    const syntaxHighlighting = syntaxHighlightingOverride !== undefined
      ? syntaxHighlightingOverride
      : defaultSyntaxHighlighting;

    const newFile: OpenFile = {
      path,
      name,
      lines: [],
      totalLines: null,
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
    };

    // Add file to the end and make it active
    update((s) => ({
      ...s,
      openFiles: [...s.openFiles, newFile],
      activeFilePath: path,
    }));

    // Fetch file analysis in background to get total line count
    fetchFileIndex(path);

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
   * Load lines from the start of the file
   * This loads lines 1 to totalLines
   */
  async function loadLinesFromStart(path: string, totalLines: number) {
    update((s) => ({
      ...s,
      openFiles: s.openFiles.map((f) =>
        f.path === path ? { ...f, loading: true, error: null } : f
      ),
    }));

    try {
      // Request lines 1 to totalLines as a range
      const range = `1-${totalLines}`;
      const response = await api.getSamples(path, [range]);

      // Parse response - samples key is the range string (e.g., "1-100")
      const lines: FileLine[] = [];

      for (const [rangeKey, contentArr] of Object.entries(response.samples)) {
        // Parse the range key to get the start line
        // Range format: "start-end" (e.g., "1-100")
        const dashIndex = rangeKey.indexOf('-');
        const startLineNum = dashIndex > 0 ? parseInt(rangeKey.substring(0, dashIndex), 10) : parseInt(rangeKey, 10);

        for (let i = 0; i < contentArr.length; i++) {
          const actualLineNum = startLineNum + i;
          lines.push({
            lineNumber: actualLineNum,
            content: contentArr[i],
          });
        }
      }

      // Sort by line number and dedupe
      const lineMap = new Map<number, FileLine>();
      for (const line of lines) {
        lineMap.set(line.lineNumber, line);
      }
      const sortedLines = Array.from(lineMap.values()).sort(
        (a, b) => a.lineNumber - b.lineNumber
      );

      update((s) => ({
        ...s,
        openFiles: s.openFiles.map((f) =>
          f.path === path
            ? {
                ...f, // Preserve all existing fields including scrollToLine
                lines: sortedLines,
                startLine: sortedLines.length > 0 ? sortedLines[0].lineNumber : 1,
                endLine: sortedLines.length > 0 ? sortedLines[sortedLines.length - 1].lineNumber : 0,
                loading: false,
                isCompressed: response.is_compressed,
                compressionFormat: response.compression_format,
              }
            : f
        ),
      }));
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : 'Failed to load file';

      // Check if it's a binary file error
      if (errorMessage.includes('binary') || errorMessage.includes('Binary')) {
        // Show notification instead of creating an error tab
        notifications.error(`Cannot open binary file: ${path.split('/').pop()}`, 5000);

        // Remove the file from open files
        update((s) => ({
          ...s,
          openFiles: s.openFiles.filter((f) => f.path !== path),
        }));
      } else if (errorMessage.includes('EOF reached') || errorMessage.includes('out of bounds')) {
        // Handle EOF errors specifically
        update((s) => ({
          ...s,
          openFiles: s.openFiles.map((f) =>
            f.path === path
              ? {
                  ...f,
                  loading: false,
                  error: errorMessage,
                }
              : f
          ),
        }));
      } else {
        // For other errors, show in the tab
        update((s) => ({
          ...s,
          openFiles: s.openFiles.map((f) =>
            f.path === path
              ? {
                  ...f,
                  loading: false,
                  error: errorMessage,
                }
              : f
          ),
        }));
      }
      console.error('Failed to load file:', e);
    }
  }

  /**
   * Load lines around a center line using context parameter
   * Uses /v1/samples?path=...&lines=<centerLine>&context=<contextLines>
   * This returns lines from (centerLine - context) to (centerLine + context)
   */
  async function loadLinesAroundCenter(path: string, centerLine: number, contextLines: number = 500) {
    update((s) => ({
      ...s,
      openFiles: s.openFiles.map((f) =>
        f.path === path ? { ...f, loading: true, error: null } : f
      ),
    }));

    try {
      // Request the center line with context
      // Backend returns lines from (centerLine - context) to (centerLine + context)
      const response = await api.getSamples(path, [centerLine.toString()], contextLines);

      // Parse response - the key is the requested line number
      const lines: FileLine[] = [];

      for (const [lineNumStr, contentArr] of Object.entries(response.samples)) {
        const requestedLine = parseInt(lineNumStr, 10);

        // Calculate start line based on before_context from response
        const startLineNum = requestedLine - response.before_context;

        for (let i = 0; i < contentArr.length; i++) {
          const actualLineNum = startLineNum + i;
          if (actualLineNum > 0) {
            lines.push({
              lineNumber: actualLineNum,
              content: contentArr[i],
            });
          }
        }
      }

      // Sort by line number and dedupe
      const lineMap = new Map<number, FileLine>();
      for (const line of lines) {
        lineMap.set(line.lineNumber, line);
      }
      const sortedLines = Array.from(lineMap.values()).sort(
        (a, b) => a.lineNumber - b.lineNumber
      );

      update((s) => ({
        ...s,
        openFiles: s.openFiles.map((f) =>
          f.path === path
            ? {
                ...f, // Preserve all existing fields including scrollToLine
                lines: sortedLines,
                startLine: sortedLines.length > 0 ? sortedLines[0].lineNumber : 1,
                endLine: sortedLines.length > 0 ? sortedLines[sortedLines.length - 1].lineNumber : 0,
                loading: false,
                isCompressed: response.is_compressed,
                compressionFormat: response.compression_format,
              }
            : f
        ),
      }));
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : 'Failed to load file';

      // Check if it's a binary file error
      if (errorMessage.includes('binary') || errorMessage.includes('Binary')) {
        // Show notification instead of creating an error tab
        notifications.error(`Cannot open binary file: ${path.split('/').pop()}`, 5000);

        // Remove the file from open files
        update((s) => ({
          ...s,
          openFiles: s.openFiles.filter((f) => f.path !== path),
        }));
      } else if (errorMessage.includes('EOF reached') || errorMessage.includes('out of bounds')) {
        // If we tried to load around a line that's out of bounds, fall back to loading from start
        console.warn(`Line ${centerLine} is out of bounds, loading from start instead`);
        const linesPerPage = get(settings).linesPerPage;
        await loadLinesFromStart(path, linesPerPage);
      } else {
        // For other errors, show in the tab
        update((s) => ({
          ...s,
          openFiles: s.openFiles.map((f) =>
            f.path === path
              ? {
                  ...f,
                  loading: false,
                  error: errorMessage,
                }
              : f
          ),
        }));
      }
      console.error('Failed to load file:', e);
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
      openFiles: s.openFiles.map((f) =>
        f.path === path ? { ...f, loading: true } : f
      ),
    }));

    try {
      const range = `${startLine}-${endLine}`;
      const response = await api.getSamples(path, [range]);

      // Parse response
      const newLines: FileLine[] = [];

      for (const [rangeKey, contentArr] of Object.entries(response.samples)) {
        // Parse the range key to get the start line
        const dashIndex = rangeKey.indexOf('-');
        const startLineNum = dashIndex > 0 ? parseInt(rangeKey.substring(0, dashIndex), 10) : parseInt(rangeKey, 10);

        for (let i = 0; i < contentArr.length; i++) {
          const actualLineNum = startLineNum + i;
          newLines.push({
            lineNumber: actualLineNum,
            content: contentArr[i],
          });
        }
      }

      update((s) => ({
        ...s,
        openFiles: s.openFiles.map((f) => {
          if (f.path !== path) return f;

          // Merge with existing lines
          const lineMap = new Map<number, FileLine>();

          // Add existing lines
          for (const line of f.lines) {
            lineMap.set(line.lineNumber, line);
          }

          // Add new lines
          for (const line of newLines) {
            lineMap.set(line.lineNumber, line);
          }

          const mergedLines = Array.from(lineMap.values()).sort(
            (a, b) => a.lineNumber - b.lineNumber
          );

          const newStartLine = mergedLines.length > 0 ? mergedLines[0].lineNumber : 1;
          const newEndLine = mergedLines.length > 0 ? mergedLines[mergedLines.length - 1].lineNumber : 0;

          return {
            ...f,
            lines: mergedLines,
            startLine: newStartLine,
            endLine: newEndLine,
            loading: false,
            reachedStart: newStartLine === 1,
          };
        }),
      }));
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      const isEOF = errorMessage.includes('EOF reached') || errorMessage.includes('out of bounds');

      update((s) => ({
        ...s,
        openFiles: s.openFiles.map((f) => {
          if (f.path !== path) return f;

          return {
            ...f,
            loading: false,
            // Mark boundary reached if we got EOF error
            reachedEnd: isEOF && direction === 'after',
            reachedStart: isEOF && direction === 'before',
          };
        }),
      }));

      if (!isEOF) {
        console.error('Failed to load more lines:', e);
      }
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
          f.path === path ? { ...f, scrollToLine: lineNumber } : f
        ),
      }));
    } else {
      // Set scroll position and active file BEFORE loading
      update((s) => ({
        ...s,
        activeFilePath: path,
        openFiles: s.openFiles.map((f) =>
          f.path === path ? { ...f, scrollToLine: lineNumber } : f
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
        f.path === path ? { ...f, loading: true, error: null } : f
      ),
    }));

    try {
      const linesPerPage = get(settings).linesPerPage;
      const context = Math.floor(linesPerPage / 2);

      // Request line -1 with context to get the last lines
      const response = await api.getSamples(path, ['-1'], context);

      // Parse response - the key will be the actual last line number
      const lines: FileLine[] = [];
      let discoveredTotalLines: number | null = null;

      for (const [lineNumStr, contentArr] of Object.entries(response.samples)) {
        const lineNum = parseInt(lineNumStr, 10);

        // The line number in response is the actual last line number
        // This tells us the total line count
        if (discoveredTotalLines === null || lineNum > discoveredTotalLines) {
          discoveredTotalLines = lineNum;
        }

        // Calculate start line based on context
        const startLineNum = lineNum - response.before_context;

        for (let i = 0; i < contentArr.length; i++) {
          const actualLineNum = startLineNum + i;
          if (actualLineNum > 0) {
            lines.push({
              lineNumber: actualLineNum,
              content: contentArr[i],
            });
          }
        }
      }

      // Sort by line number and dedupe
      const lineMap = new Map<number, FileLine>();
      for (const line of lines) {
        lineMap.set(line.lineNumber, line);
      }
      const sortedLines = Array.from(lineMap.values()).sort(
        (a, b) => a.lineNumber - b.lineNumber
      );

      const newEndLine = sortedLines.length > 0 ? sortedLines[sortedLines.length - 1].lineNumber : 0;

      update((s) => ({
        ...s,
        openFiles: s.openFiles.map((f) =>
          f.path === path
            ? {
                ...f,
                lines: sortedLines,
                startLine: sortedLines.length > 0 ? sortedLines[0].lineNumber : 1,
                endLine: newEndLine,
                loading: false,
                isCompressed: response.is_compressed,
                compressionFormat: response.compression_format,
                scrollToLine: newEndLine, // Scroll to the last line
                totalLines: discoveredTotalLines, // Update total lines
                reachedEnd: true, // We're at the end
              }
            : f
        ),
      }));
    } catch (e) {
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
            : f
        ),
      }));
      console.error('Failed to jump to end:', e);
    }
  }

  /**
   * Close a file
   */
  function closeFile(path: string) {
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
   * Clear scroll position after scrolling is done
   */
  function clearScrollPosition(path: string) {
    update((s) => ({
      ...s,
      openFiles: s.openFiles.map((f) =>
        f.path === path ? { ...f, scrollToLine: undefined } : f
      ),
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

  /**
   * Toggle syntax highlighting for a specific file
   */
  function toggleSyntaxHighlighting(path: string) {
    update((s) => ({
      ...s,
      openFiles: s.openFiles.map((f) =>
        f.path === path ? { ...f, syntaxHighlighting: !f.syntaxHighlighting } : f
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
   * Update regex filter configuration for a specific file
   */
  function updateRegexFilter(path: string, pattern: string, mode: 'hide' | 'show' | 'highlight') {
    update((s) => ({
      ...s,
      openFiles: s.openFiles.map((f) => {
        if (f.path !== path || !f.regexFilter) return f;

        let compiledRegex: RegExp | null = null;
        let error: string | null = null;

        if (pattern.trim()) {
          try {
            compiledRegex = new RegExp(pattern, 'g');
            // No longer require capturing groups - if no groups, treat whole match as one group
          } catch (e) {
            error = e instanceof Error ? e.message : 'Invalid regex pattern';
            compiledRegex = null;
          }
        }

        return {
          ...f,
          regexFilter: {
            ...f.regexFilter,
            pattern,
            mode,
            compiledRegex,
            error,
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
      openFiles: s.openFiles.map((f) =>
        f.path === path ? { ...f, regexFilter: null } : f
      ),
    }));
  }

  /**
   * Toggle invisible characters display for a specific file
   */
  function toggleInvisibleChars(path: string) {
    update((s) => ({
      ...s,
      openFiles: s.openFiles.map((f) =>
        f.path === path ? { ...f, showInvisibleChars: !f.showInvisibleChars } : f
      ),
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

  return {
    subscribe,
    openFile,
    closeFile,
    loadMore,
    jumpToLine,
    jumpToEnd,
    setMatches,
    clearScrollPosition,
    reorderFiles,
    toggleSyntaxHighlighting,
    toggleRegexFilter,
    updateRegexFilter,
    clearRegexFilter,
    toggleInvisibleChars,
    setActiveFile,
  };
}

export const files = createFilesStore();

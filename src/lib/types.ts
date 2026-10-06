import type { components, operations } from './types.generated';

/**
 * The wire types are aliases of the generated schemas, so they cannot
 * drift from rx-go's OpenAPI document. Regenerate with `just gen-types`
 * after a backend change; `just ci` fails when the generated file is stale.
 *
 * The generated shapes are nullable wherever the spec says so — a Go nil
 * slice marshals as null — which is the actual contract: read a list
 * through `?? []` rather than assuming it is there.
 */
type Schemas = components['schemas'];

/**
 * `GET /health`. A backend released before `contract_version` existed
 * leaves it out; `checkContractVersion` reads that as unknown.
 */
export type HealthResponse = Schemas['HealthResponse'];

/** One file or directory in a `GET /v1/tree` listing; `type` is `file` or `directory`. */
export type TreeEntry = Schemas['TreeEntry'];

/** `GET /v1/tree`. */
export type TreeResponse = Schemas['TreeResponse'];

/**
 * `GET /v1/samples`. A sample is null when its window holds no line of
 * the file: past the end, or any window of an empty file. Read it with
 * `readSamplesAnswer` (`utils/sampleWindow.ts`).
 */
export type SamplesResponse = Schemas['SamplesResponse'];

// Trace endpoint (GET /v1/trace)

/** The query parameters of `GET /v1/trace`. */
export type TraceQuery = operations['trace']['parameters']['query'];

/**
 * ripgrep's matching flags as trace parameters (`ignore_case=true` is
 * `rx trace --ignore-case`). Check `backendHas('trace_matching_flags')`
 * before relying on them.
 */
export type TraceMatchingFlags = Pick<
  TraceQuery,
  'ignore_case' | 'word_regexp' | 'line_regexp' | 'fixed_strings' | 'pcre2'
>;

/**
 * The body both backends return with 403 for a path outside every
 * configured `--search-root`. `error` is the stable machine code to
 * branch on; `roots` is sorted, so the two backends' bodies match.
 */
export type SandboxError = Schemas['SandboxError'];

/**
 * A sandbox body that has been through `parseSandboxError`, which
 * rejects anything whose `roots` is not a list of strings. The generated
 * type allows null there because a Go nil slice marshals as one; a body
 * that arrived that way is not one this app can render, so the parser
 * refuses it rather than making every reader check.
 */
export type ParsedSandboxError = Omit<SandboxError, 'roots'> & { roots: string[] };

/** One highlighted span inside a matched line. */
export type Submatch = Schemas['Submatch'];

/** One line of context around a match. */
export type ContextLine = Schemas['ContextLine'];

export type TraceMatch = Schemas['Match'];

export type TraceResponse = Schemas['TraceResponse'];

// Index endpoint types (GET /v1/index, POST /v1/index)

/**
 * `GET /v1/index`: a file's cached index, with its analysis when one was
 * performed. The result of an index task has the same fields and two
 * more, so this type also holds what `POST /v1/index` builds.
 *
 * `line_length`, `longest_line`, `line_count` and the other statistics
 * are null when the index was built without an analysis.
 */
export type IndexResponse = Schemas['IndexResponse'];

/** The result of a completed index task: the index, where it is stored and `success`. */
export type IndexTaskResult = Schemas['IndexTaskResult'];

/** The result of a completed compress task. */
export type CompressTaskResult = Schemas['CompressTaskResult'];

/**
 * A line-index checkpoint: `[line_number, byte_offset]`, with a third
 * element, the frame number, in a seekable-zstd index.
 */
export type LineIndexEntry = Schemas['LineIndexEntry'];

/**
 * Line-length statistics; null without an analysis. Only `max` is always
 * there: the others are null when the backend cannot compute them.
 */
export type LineLengthStats = Schemas['LineLengthStats'];

/** Where the longest line is; null without an analysis. */
export type LongestLine = Schemas['LongestLine'];

/** One anomaly an analysis found: a line range, its detector, category and severity. */
export type AnomalyRangeResult = Schemas['AnomalyRangeResult'];

/**
 * The 409 body of `POST /v1/index` or `/v1/compress` while a task is
 * already running for the path. `task_id` names that task.
 */
export type TaskConflictError = Schemas['TaskConflictError'];

/**
 * `GET /v1/tasks/{id}`. `result` is null until the task completes, then
 * the result of its operation: an `IndexTaskResult` or a
 * `CompressTaskResult`.
 */
export type TaskStatus = Schemas['TaskStatusResponse'];

/** `POST /v1/index`: the task that builds the index. */
export type IndexTaskResponse = Schemas['TaskResponse'];

// Detectors endpoint types (GET /v1/detectors)

/** The severity band a detector can emit, 0.0 to 1.0. */
export type SeverityRange = Schemas['SeverityRange'];

/** One detector a backend has registered. */
export type DetectorInfo = Schemas['DetectorInfo'];

/** One category detectors report under. */
export type CategoryInfo = Schemas['CategoryInfo'];

/** One band of the severity scale. */
export type SeverityLevel = Schemas['SeverityScaleLevel'];

/** `GET /v1/detectors`. Both backends ship different sets; render whatever comes. */
export type DetectorsResponse = Schemas['DetectorsResponse'];

// Frontend-specific types

export interface TreeNode extends TreeEntry {
  expanded: boolean;
  loading: boolean;
  children: TreeNode[];
  level: number;
}

/** A line of content with its line number */
export interface FileLine {
  lineNumber: number;
  content: string;
}

/** Regex filter configuration for content transformation */
export interface RegexFilter {
  enabled: boolean;
  pattern: string;
  mode: 'hide' | 'show' | 'highlight';
  compiledRegex: RegExp | null;
  error: string | null;
  applying: boolean;
}

/** Represents an open file in the editor */
/** How far the build of a file's line index has got (`samplesWait.ts`). */
export interface IndexBuild {
  taskId: string;
  /** Share of the file read so far, 0 to 1; null while the backend does not say. */
  progress: number | null;
}

export interface OpenFile {
  path: string;
  name: string;
  lines: FileLine[];
  totalLines: number | null; // null if unknown (file not indexed)
  startLine: number; // First loaded line number
  endLine: number; // Last loaded line number
  loading: boolean;
  error: string | null;
  isCompressed: boolean;
  compressionFormat: string | null;
  scrollToLine?: number;
  reachedStart: boolean; // True if we've reached line 1
  reachedEnd: boolean; // True if we've hit EOF (can't load more after)
  syntaxHighlighting: boolean; // Per-file syntax highlighting state
  fileSize: number | null; // File size in bytes (for determining default highlighting state)
  regexFilter: RegexFilter | null; // Regex-based content filter
  showInvisibleChars: boolean; // Show invisible characters (spaces, tabs, CR, etc.)
  wordWrap: boolean; // Wrap long lines instead of horizontal scrolling
  highlightedLines?: { start: number; end: number } | null; // Highlighted line range (e.g., from anomaly click)
  // Anomaly data from index
  isIndexed: boolean; // Whether the file has an index
  anomalies: AnomalyRangeResult[] | null; // Anomalies detected in the file
  anomalySummary: Record<string, number> | null; // Category -> count
  selectedAnomalyCategory: string | null; // Currently selected category for highlighting (null = none)
  /** The line the URL names for this file; the rule is in `utils/anchorLine.ts`. */
  anchorLine: number;
  /**
   * The build of the file's line index a window load is waiting for, or
   * null. Set while the backend answers 202 (`samplesWait.ts`).
   */
  indexBuild: IndexBuild | null;
}

/** Match info for highlighting in file viewer */
export interface FileMatch {
  lineNumber: number;
  patternId: string;
  pattern: string;
}

export interface AppSettings {
  theme: 'light' | 'dark' | 'system';
  sidebarWidth: number;
  monacoTheme: MonacoTheme;
}

export type Theme = 'light' | 'dark';

export type MonacoTheme =
  'vs' | 'github-light' | 'github-dark' | 'monokai' | 'solarized-light' | 'solarized-dark';

/**
 * The editor themes the picker lists. `base` is the look of the swatch;
 * "app" is Monaco's light or dark VS theme, whichever the app shows.
 */
export const MONACO_THEMES: { id: MonacoTheme; name: string; base: 'vs' | 'vs-dark' | 'app' }[] = [
  { id: 'vs', name: 'VS (follows the app theme)', base: 'app' },
  { id: 'github-light', name: 'GitHub Light', base: 'vs' },
  { id: 'github-dark', name: 'GitHub Dark', base: 'vs-dark' },
  { id: 'monokai', name: 'Monokai', base: 'vs-dark' },
  { id: 'solarized-light', name: 'Solarized Light', base: 'vs' },
  { id: 'solarized-dark', name: 'Solarized Dark', base: 'vs-dark' },
];

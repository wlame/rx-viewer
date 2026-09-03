import type { components } from './types.generated';

// API Types matching backend models

export interface HealthResponse {
  status: string;
  app_version: string;
  /**
   * The HTTP wire contract the backend speaks, MAJOR.MINOR. Absent on
   * backends released before it existed — see checkContractVersion().
   */
  contract_version?: string;
  ripgrep_available: boolean;
  search_roots: string[] | null;
}

export interface TreeEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size: number | null;
  size_human: string | null;
  modified_at: string | null;
  is_text: boolean | null;
  is_compressed: boolean | null;
  compression_format: string | null;
  is_indexed: boolean | null;
  line_count: number | null;
  children_count: number | null;
}

export interface TreeResponse {
  path: string;
  parent: string | null;
  is_search_root: boolean;
  entries: TreeEntry[];
  total_entries: number;
  total_size: number | null;
  total_size_human: string | null;
}

// Backend samples endpoint response
// GET /v1/samples?path=file&lines=1,2,3&context=3
export interface SamplesResponse {
  path: string;
  offsets: Record<string, number>; // offset -> line_number
  lines: Record<string, number>; // line_number -> offset
  before_context: number;
  after_context: number;
  samples: Record<string, string[]>; // key (offset or line) -> array of context lines
  is_compressed: boolean;
  compression_format: string | null;
}

// Trace endpoint (GET /v1/trace)

/**
 * The trace wire types are aliases of the generated schemas, so they cannot
 * drift from rx-go's OpenAPI document. Regenerate with `just gen-types`
 * after a backend change; `just ci` fails when the generated file is stale.
 *
 * The generated shapes are nullable wherever the spec says so — a Go nil
 * slice marshals as null — which is stricter than the hand-written types
 * were, and is the actual contract.
 */
type Schemas = components['schemas'];

/** One highlighted span inside a matched line. */
export type Submatch = Schemas['Submatch'];

/** One line of context around a match. */
export type ContextLine = Schemas['ContextLine'];

export type TraceMatch = Schemas['Match'];

export type TraceResponse = Schemas['TraceResponse'];

export interface TaskStatus {
  task_id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  path: string;
  operation: string;
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
  result: IndexData | null;
}

// Index endpoint types (GET /v1/index, POST /v1/index)

/** Anomaly detected in a file */
export interface Anomaly {
  start_line: number;
  end_line: number;
  start_offset: number;
  end_offset: number;
  severity: number; // 0.0 to 1.0
  category: string; // 'error', 'warning', 'security', 'format', 'timing', etc.
  description: string;
  detector: string; // 'traceback', 'error_keyword', 'high_entropy', 'line_length_spike', etc.
}

/** Line length statistics */
export interface LineLengthStats {
  max: number;
  avg: number;
  median: number;
  p95: number;
  p99: number;
  stddev: number;
}

/** Longest line info */
export interface LongestLineInfo {
  line_number: number;
  byte_offset: number;
}

/** Index data returned by GET /v1/index or in task result */
export interface IndexData {
  path: string;
  file_type: string; // 'text', 'binary', etc.
  size_bytes: number;
  created_at: string;
  build_time_seconds: number;
  analysis_performed: boolean;
  line_index: [number, number][]; // Array of [line_number, byte_offset] tuples
  index_entries: number;
  line_count: number;
  empty_line_count: number;
  line_ending: string | null; // 'LF', 'CRLF', etc.
  line_length: LineLengthStats | null;
  longest_line: LongestLineInfo | null;
  compression_format: string | null;
  decompressed_size_bytes: number | null;
  compression_ratio: number | null;
  anomaly_count: number;
  anomaly_summary: Record<string, number> | null; // category -> count
  anomalies: Anomaly[] | null;
}

/** Response from POST /v1/index */
export interface IndexTaskResponse {
  task_id: string;
  status: string;
  message: string;
  path: string;
  started_at: string;
}

// Detectors endpoint types (GET /v1/detectors)

/** Severity range for a detector */
export interface SeverityRange {
  min: number;
  max: number;
}

/** Detector metadata */
export interface DetectorInfo {
  name: string;
  category: string;
  description: string;
  severity_range: SeverityRange;
  examples: string[];
}

/** Category metadata */
export interface CategoryInfo {
  name: string;
  description: string;
  detectors: string[];
}

/** Severity scale level */
export interface SeverityLevel {
  min: number;
  max: number;
  label: string;
  description: string;
}

/** Response from GET /v1/detectors */
export interface DetectorsResponse {
  detectors: DetectorInfo[];
  categories: CategoryInfo[];
  severity_scale: SeverityLevel[];
}

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
  anomalies: Anomaly[] | null; // Anomalies detected in the file
  anomalySummary: Record<string, number> | null; // Category -> count
  selectedAnomalyCategory: string | null; // Currently selected category for highlighting (null = none)
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
  editorFontSize: number;
  showLineNumbers: boolean;
  wrapLines: boolean;
  linesPerPage: number;
  showMinimap: boolean;
  monacoTheme: MonacoTheme;
}

export type Theme = 'light' | 'dark';

export type MonacoTheme =
  | 'vs'
  | 'vs-dark'
  | 'github-light'
  | 'github-dark'
  | 'monokai'
  | 'solarized-light'
  | 'solarized-dark';

export const MONACO_THEMES: { id: MonacoTheme; name: string; base: 'vs' | 'vs-dark' }[] = [
  { id: 'vs', name: 'Light (VS)', base: 'vs' },
  { id: 'vs-dark', name: 'Dark (VS)', base: 'vs-dark' },
  { id: 'github-light', name: 'GitHub Light', base: 'vs' },
  { id: 'github-dark', name: 'GitHub Dark', base: 'vs-dark' },
  { id: 'monokai', name: 'Monokai', base: 'vs-dark' },
  { id: 'solarized-light', name: 'Solarized Light', base: 'vs' },
  { id: 'solarized-dark', name: 'Solarized Dark', base: 'vs-dark' },
];

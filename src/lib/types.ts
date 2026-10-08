import type { components, operations } from './types.generated';
import type { TabKey } from './utils/tabKey';

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

/**
 * `GET /v1/time-range`: when a file's first and last timestamped lines
 * were written, as UTC instants in ms, with what the viewer needs to show
 * a time the way the file writes it (`format`, `example`, `day_first`,
 * `display_zone`). `format` is null for a file without timestamps, and
 * `first_ms`/`last_ms` are null while they are unknown (`source: none`
 * for a compressed file that has no line index yet).
 */
export type TimeRangeResponse = Schemas['TimeRangeResponse'];

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
 * the result of its operation: an `IndexTaskResult`, a
 * `CompressTaskResult` or a `ChainIndexTaskResult`.
 */
export type TaskStatus = Schemas['TaskStatusResponse'];

/**
 * The result of a completed log chain index task (`chain_index`): the
 * parts whose line index it built, in the chain's order.
 */
export type ChainIndexTaskResult = Schemas['ChainIndexTaskResult'];

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

// Log chain types (/v1/logs/*). rx-go serves them when `/health` lists
// `log_chains`; ask `backendHas('log_chains')` before calling a route.

/**
 * One log chain of a `GET /v1/logs/chains` listing, found from its files'
 * names alone. `path` is the chain's handle. A chain of more than 10,000
 * parts has `too_many_parts` and empty `parts` and `missing`;
 * `missing_count` says how many numbered parts are missing in all, of
 * which `missing` names at most 100; `unreadable` names the parts that
 * cannot be opened.
 */
export type ChainEntry = Schemas['ChainEntry'];

/** `GET /v1/logs/chains`: the chains of one directory, sorted by name. */
export type ChainsResponse = Schemas['ChainsResponse'];

/** Where a chain is: `pending` until its frozen parts are indexed, then `ready` or `invalid`. */
export type ChainState = Schemas['ChainResponse']['state'];

/** A check a chain failed, with the parts it names. */
export type ChainReason = Schemas['ChainReason'];

/** A time gap between two parts of a ready chain: no lines from `from_ms` to `to_ms`. */
export type ChainGap = Schemas['ChainGap'];

/**
 * One part of a described chain, in the chain's order. `global_start` is
 * null until the chain is ready; `day_first` and `example` show the part's
 * times in its own layout.
 */
export type ChainPart = Schemas['ChainPart'];

/**
 * `GET /v1/logs/chain`, also the body of a 409 from a chain route: the
 * chain's parts in time order, its state and reasons, its fingerprint,
 * and the index task a pending chain waits for. A chain of more than
 * 10,000 parts has `parts: []`.
 */
export type ChainResponse = Schemas['ChainResponse'];

/**
 * The lines of one part that a chain samples window touches. A window
 * that crosses part edges gives one piece per part.
 * `first_global_line` is -1 before the chain is ready.
 */
export type ChainPiece = Schemas['ChainPiece'];

/** `GET /v1/logs/samples`: each key's pieces, its target line, and the chain's parts. */
export type ChainSamplesResponse = Schemas['ChainSamplesResponse'];

/** One chain a chain search found, by its id (`c1`, `c2`, …). */
export type ChainRef = Schemas['ChainRef'];

/**
 * A match of a chain search: a trace match plus its chain id (null for a
 * file searched on its own) and its line in the chain (-1 when unknown).
 */
export type ChainMatch = Schemas['ChainMatch'];

/** `GET /v1/logs/trace`: a trace answer plus the chains it found. */
export type ChainTraceResponse = Schemas['ChainTraceResponse'];

/**
 * The answer of a search by either route: `/v1/trace`, or
 * `/v1/logs/trace` in chain mode, whose answer has every field of a
 * trace answer plus `chains` (`utils/chainSearch.ts` tells them apart).
 */
export type SearchResponse = TraceResponse | ChainTraceResponse;

/** A match of either route's answer: a chain search's also names its chain and chain line. */
export type SearchMatch = TraceMatch & Partial<Pick<ChainMatch, 'chain' | 'chain_line'>>;

// Frontend-specific types

export interface TreeNode extends TreeEntry {
  expanded: boolean;
  loading: boolean;
  children: TreeNode[];
  level: number;
  /**
   * A directory's log chains as `/v1/logs/chains` lists them, asked while
   * chain mode is on; absent until they are listed, and when the listing
   * failed. `children` keeps every entry `/v1/tree` lists either way
   * (`utils/chainTree.ts` shows a chain in place of its parts).
   */
  chains?: readonly ChainEntry[];
}

/** A line of content with its line number */
export interface FileLine {
  lineNumber: number;
  content: string;
  /**
   * The line's effective timestamp as the samples answer gives it
   * (`line_timestamps`): ms since the epoch, a UTC instant, or null for
   * a line without one. Absent when the answer carried no timestamps.
   */
  timestampMs?: number | null;
  /** In a log chain's tab: the name of the part the line comes from. */
  part?: string;
  /** In a log chain's tab: the line's number in its part, as `rx samples PART` numbers it. */
  localLine?: number;
}

/**
 * The line a chain's tab is anchored on, as its URL names it: the part
 * that holds it, its number in that part, and its effective timestamp
 * (null for a line without one), which finds it again when the part is
 * gone.
 */
export interface ChainAnchor {
  part: string;
  line: number;
  timeMs: number | null;
  /**
   * The fingerprint of the files a link named this line in, while the tab
   * has not read the line yet; absent for a line the tab read, which its
   * description's fingerprint names.
   */
  fingerprint?: string;
}

/**
 * How a chain's tab numbers the lines it holds. `global`: by the chain's
 * global line numbers, once the chain is ready. `local`: before that, a
 * part's line L sits at `bases.get(part) + L`, positions that keep the
 * held lines in order and one apart across a part edge; the gutter shows
 * L.
 */
export type ChainNumbering = 'global' | 'local';

/** What a log chain's tab holds besides its lines. */
export interface ChainTab {
  /** The chain's handle: its directory joined with its name. */
  handle: string;
  /** The chain's description, or null until the first one arrives. */
  description: ChainResponse | null;
  numbering: ChainNumbering;
  /** In local numbering, the position before each part's first line, by part name. */
  bases: ReadonlyMap<string, number>;
  /** Line counts of parts the tab has learned: from the description, or the end of a part read. */
  counts: ReadonlyMap<string, number>;
  /** The anchor line as the URL names it, or null while none is known. */
  anchor: ChainAnchor | null;
  /** The chain's index task the tab follows, with its progress, or null. */
  indexTask: IndexBuild | null;
  /** Why the index task cannot be followed or failed, in words, or null. */
  indexProblem: string | null;
  /**
   * Why the backend started no index task for the pending chain, as the
   * last description or answer about one part gave it
   * (`index_build_refused`), or null.
   */
  buildRefused: string | null;
  /** The backend's reasons for refusing to read an invalid chain (a 422), or null. */
  invalidDetail: string | null;
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

/** How far the build of a file's line index has got (`samplesWait.ts`). */
export interface IndexBuild {
  taskId: string;
  /** Share of the file read so far, 0 to 1; null while the backend does not say. */
  progress: number | null;
}

/**
 * An open tab in the editor: a file's, or a log chain's. A tab is found
 * by its key, which it holds in `path`.
 */
export interface OpenFile {
  /**
   * The tab's key (`utils/tabKey.ts`): a file's path, or `chain:` and the
   * handle for a log chain. Every store that belongs to a tab is keyed by
   * it. A file tab's lines load from `/v1/samples` with it as the path.
   */
  path: TabKey;
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
  /**
   * The kind of file its line index records (`file_type`), or null while
   * no index is known. Only the index tells a seekable zstd file from a
   * zstd stream.
   */
  fileType: IndexResponse['file_type'] | null;
  /** The line the URL names for this file; the rule is in `utils/anchorLine.ts`. */
  anchorLine: number;
  /**
   * The build of the file's line index a window load is waiting for, or
   * null. Set while the backend answers 202 (`samplesWait.ts`).
   */
  indexBuild: IndexBuild | null;
  /**
   * Why the file has no line index it needs yet: `building` while a
   * build runs (a samples answer named one, or a load waits for one),
   * `failed` when the build followed in the background failed; null
   * when it has its index or needs none. Jumps by time stay off while
   * it is set. Only an index clears it.
   */
  pendingIndex: 'building' | 'failed' | null;
  /**
   * The build of the file's line index that a samples answer named and
   * the file follows in the background while its lines show, or null.
   */
  backgroundIndexBuild: IndexBuild | null;
  /**
   * The file's time range, asked once when the file opens and again when
   * a line index build for it ends; null while unknown, when the call
   * failed, and for a backend that does not list `time_range`.
   */
  timeRange: TimeRangeResponse | null;
  /** Whether an ask for the file's time range is out. */
  isReadingTimeRange: boolean;
  /**
   * The instant (UTC ms) of the jump by time that put the file where it
   * is, or null when it was last moved another way. A move by line
   * clears it. The URL's `time` comes from it.
   */
  timeJump: number | null;
  /** A log chain's tab: what it holds besides its lines. Absent in a file's tab. */
  chain?: ChainTab;
}

/**
 * A search match a tab marks. In a file's tab `lineNumber` is the file's
 * line. In a log chain's tab the match names its `part` and `lineNumber`
 * is the line in that part, so the mark follows the line whether the tab
 * numbers its lines globally or, while the chain is pending, by part.
 */
export interface FileMatch {
  lineNumber: number;
  patternId: string;
  pattern: string;
  /** In a log chain's tab: the name of the part the match is in. */
  part?: string;
}

export interface AppSettings {
  theme: 'light' | 'dark' | 'system';
  sidebarWidth: number;
  monacoTheme: MonacoTheme;
  /**
   * The chain mode the view was last in, however it was set, which a
   * link that does not name the mode (`chains=`) opens in.
   */
  chainMode: boolean;
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

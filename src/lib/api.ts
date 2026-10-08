import type {
  HealthResponse,
  TreeResponse,
  SamplesResponse,
  TraceResponse,
  TraceMatchingFlags,
  TaskStatus,
  IndexResponse,
  IndexTaskResponse,
  DetectorsResponse,
  TimeRangeResponse,
  ChainsResponse,
  ChainResponse,
  ChainSamplesResponse,
  ChainTraceResponse,
} from './types';
import { parseSandboxError, describeSandboxError } from './utils/sandboxError';
import { getApiToken, tokenRequired } from './utils/apiToken';
import { API_BASE, HEALTH_PATH } from './backendRoutes';
import { contractGate } from './contractGate';

/**
 * Per-call options. Only a cancellation signal for now — pass the one a
 * LatestRequest hands you, so a superseded load stops instead of racing
 * the load that replaced it.
 */
export interface RequestOptions {
  signal?: AbortSignal;
}

class ApiError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    message: string,
    /** The unparsed response body, kept for logging and debugging. */
    public body: string = message,
    /**
     * The `Retry-After` header of a refusal, as sent: how long a busy
     * backend (503) asks the client to wait. Null without one.
     */
    public retryAfter: string | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Pull the human-readable reason out of an error response body.
 *
 * Both backends answer with an envelope that carries the sentence in
 * `detail` alongside a `$schema` link. Surfacing the raw body puts that
 * JSON in front of the user instead of the reason, so prefer `detail`,
 * then `message`, then the body itself, and fall back to the status text
 * when the body is empty.
 *
 * A sandbox refusal is the exception: its `detail` holds a machine code
 * for clients to branch on, so the sentence is built from the structured
 * fields instead.
 */
function errorMessageFrom(body: string, statusText: string): string {
  const text = body.trim();
  if (!text) return statusText;
  const sandbox = parseSandboxError(text);
  if (sandbox) return describeSandboxError(sandbox);
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object') {
      const { detail, message } = parsed as { detail?: unknown; message?: unknown };
      if (typeof detail === 'string' && detail) return detail;
      if (typeof message === 'string' && message) return message;
    }
  } catch {
    // Not JSON — an upstream proxy or a plain-text error. Use it as it is.
  }
  return text;
}

/** A successful answer's status and its parsed body. */
interface JsonAnswer<T> {
  status: number;
  body: T;
}

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  return (await fetchJsonAnswer<T>(url, options)).body;
}

/**
 * The status of a successful answer: 200 is the result, 202 says the
 * backend accepted the request and names the task that will make it
 * possible.
 */
const HTTP_ACCEPTED = 202;

/**
 * What `/v1/samples` answered: the lines, or the build of the file's line
 * index the backend is waiting for (a 202, from contract 1.4 on). After a
 * build, the same request is asked again; `samplesWait.ts` does that.
 */
export type SamplesAnswer =
  { kind: 'samples'; samples: SamplesResponse } | { kind: 'building'; task: IndexTaskResponse };

/**
 * Options of a samples request. `respondAsync` sends `Prefer:
 * respond-async`, without which the backend never answers 202: it waits
 * for the build and answers the lines, as a 1.3 backend does.
 */
export interface SamplesRequestOptions extends FileZoneRequestOptions {
  respondAsync?: boolean;
}

/**
 * Options of a request that reads a file's timestamps. `fileTz` reads
 * them as wall clock in that zone (`file_tz`); check
 * `backendHas('file_tz')` first. Without it the file is read as its
 * lines write times.
 */
export interface FileZoneRequestOptions extends RequestOptions {
  fileTz?: string;
}

/** Add `file_tz` to `params` when a zone is given. */
function withFileTz(params: URLSearchParams, fileTz: string | undefined): URLSearchParams {
  if (fileTz) params.set('file_tz', fileTz);
  return params;
}

/**
 * A samples request's answer, the lines (`T`) or the index build it
 * waits for (202). `Prefer: respond-async` goes only with `respondAsync`.
 */
async function fetchSamplesAnswer<T>(
  url: string,
  options: SamplesRequestOptions,
): Promise<{ kind: 'samples'; samples: T } | { kind: 'building'; task: IndexTaskResponse }> {
  const { respondAsync, fileTz: _fileTz, ...request } = options;
  const { status, body } = await fetchJsonAnswer<T | IndexTaskResponse>(url, {
    ...request,
    ...(respondAsync ? { headers: { Prefer: 'respond-async' } } : {}),
  });
  if (status === HTTP_ACCEPTED) return { kind: 'building', task: body as IndexTaskResponse };
  return { kind: 'samples', samples: body as T };
}

function fetchSamples(url: string, options: SamplesRequestOptions = {}): Promise<SamplesAnswer> {
  return fetchSamplesAnswer<SamplesResponse>(url, options);
}

/** The status of a chain request whose fingerprint no longer matches the chain's files. */
const HTTP_CONFLICT = 409;

/** The status of a samples request on a chain that cannot be read as one text. */
const HTTP_UNPROCESSABLE = 422;

/**
 * A chain changed on disk since the client described it (a rotation
 * renamed, compressed or removed a part, or added one): the backend
 * answers 409 with the chain's current description.
 */
export interface ChainChanged {
  kind: 'changed';
  chain: ChainResponse;
}

/** What `/v1/logs/chain` answered: the description, or the changed chain's new one. */
export type LogChainAnswer = { kind: 'chain'; chain: ChainResponse } | ChainChanged;

/**
 * What `/v1/logs/samples` answered: the pieces; the index task a request
 * by global line or time waits for (a 202, only with `respondAsync`); the
 * changed chain's new description; or, for an invalid chain, the reasons
 * as the backend words them.
 */
export type LogSamplesAnswer =
  | { kind: 'samples'; samples: ChainSamplesResponse }
  | { kind: 'building'; task: IndexTaskResponse }
  | ChainChanged
  | { kind: 'invalid'; detail: string };

/** What `/v1/logs/index` answered: the chain's index task, started or joined, or the changed chain. */
export type LogIndexAnswer = { kind: 'task'; task: IndexTaskResponse } | ChainChanged;

/** Options of a request about one chain. */
export interface ChainRequestOptions extends FileZoneRequestOptions {
  /**
   * The fingerprint of the description the client holds (16 hex digits).
   * When the chain's files changed since, the answer is the changed chain.
   */
  fingerprint?: string;
}

/** Options of a chain samples request: a chain request that may answer 202. */
export interface LogSamplesOptions extends SamplesRequestOptions {
  fingerprint?: string;
}

/** What a chain samples request reads, whatever its addressing. */
interface LogSamplesWindow {
  /** The chain's handle: its directory joined with its name. */
  handle: string;
  /** Lines before and after each single line or time; the backend's default without it. */
  context?: number;
  /** Override `context` before each single line or time. */
  beforeContext?: number;
  /** Override `context` after each single line or time. */
  afterContext?: number;
}

/**
 * A chain samples request: global lines or ranges (`-N` counts back from
 * the chain's end); a part's own lines with `part` (the only addressing
 * of a chain that is not ready yet); or times and time ranges as
 * `--timestamps` reads them.
 */
export type LogSamplesParams = LogSamplesWindow &
  ({ lines: string[]; part?: string } | { timestamps: string[] });

/** The query of a chain samples request. */
function logSamplesQuery(params: LogSamplesParams, options: LogSamplesOptions): URLSearchParams {
  const query = new URLSearchParams({ path: params.handle });
  if ('timestamps' in params) {
    for (const value of params.timestamps) query.append('timestamps', value);
  } else {
    query.set('lines', params.lines.join(','));
    if (params.part !== undefined) query.set('part', params.part);
  }
  const contexts: [string, number | undefined][] = [
    ['context', params.context],
    ['before_context', params.beforeContext],
    ['after_context', params.afterContext],
  ];
  for (const [name, value] of contexts) {
    if (value !== undefined) query.set(name, String(value));
  }
  withFileTz(query, options.fileTz);
  return withFingerprint(query, options.fingerprint);
}

/** Add `fingerprint` to `params` when one is given. */
function withFingerprint(params: URLSearchParams, fingerprint: string | undefined) {
  if (fingerprint) params.set('fingerprint', fingerprint);
  return params;
}

/** Whether a parsed body has the fields every chain description has. */
function isChainDescription(body: unknown): body is ChainResponse {
  if (body === null || typeof body !== 'object') return false;
  const { path, fingerprint, parts } = body as Record<string, unknown>;
  return typeof path === 'string' && typeof fingerprint === 'string' && Array.isArray(parts);
}

/**
 * The current description a chain route's 409 carries, or null for any
 * other refusal and for a 409 whose body is not a description (a proxy's
 * page, say), which stays an error.
 */
function changedChainOf(error: unknown): ChainChanged | null {
  if (!(error instanceof ApiError) || error.status !== HTTP_CONFLICT) return null;
  try {
    const body: unknown = JSON.parse(error.body);
    return isChainDescription(body) ? { kind: 'changed', chain: body } : null;
  } catch {
    return null;
  }
}

/** Run a chain request; a 409 with the chain's current description is its answer, not an error. */
async function orChanged<T>(request: Promise<T>): Promise<T | ChainChanged> {
  try {
    return await request;
  } catch (error) {
    const changed = changedChainOf(error);
    if (changed === null) throw error;
    return changed;
  }
}

/** The query of a search: repeated paths and patterns, the cap and the flags that are on. */
function traceQuery(
  paths: string[],
  patterns: string[],
  query: { maxResults?: number; flags?: TraceMatchingFlags },
): URLSearchParams {
  const params = new URLSearchParams();
  paths.forEach((p) => params.append('path', p));
  patterns.forEach((r) => params.append('regexp', r));
  if (query.maxResults !== undefined) {
    params.set('max_results', query.maxResults.toString());
  }
  for (const [name, on] of Object.entries(query.flags ?? {})) {
    if (on) params.set(name, 'true');
  }
  return params;
}

async function fetchJsonAnswer<T>(url: string, options?: RequestInit): Promise<JsonAnswer<T>> {
  // A /v1 request waits while the backend speaks a contract this viewer
  // would misread; /health is how the viewer finds that out, so it never waits.
  if (url.startsWith(API_BASE)) await contractGate.pass(options?.signal);
  const token = getApiToken();
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  });

  if (!response.ok) {
    // A backend started with RX_API_TOKEN refuses a request without it;
    // the prompt that asks for one listens to this.
    if (response.status === 401) tokenRequired.set(true);
    const text = await response.text();
    throw new ApiError(
      response.status,
      response.statusText,
      errorMessageFrom(text, response.statusText),
      text,
      response.headers?.get('Retry-After') ?? null,
    );
  }

  return { status: response.status, body: await response.json() };
}

export const api = {
  /**
   * Check API health status
   */
  async getHealth(): Promise<HealthResponse> {
    return fetchJson<HealthResponse>(HEALTH_PATH);
  },

  /**
   * Get directory tree listing
   * @param path - Directory path to list, or undefined for search roots
   */
  async getTree(path?: string, options?: RequestOptions): Promise<TreeResponse> {
    const url = path ? `${API_BASE}/tree?path=${encodeURIComponent(path)}` : `${API_BASE}/tree`;
    return fetchJson<TreeResponse>(url, options);
  },

  /**
   * Get file content samples for specific line ranges, or the index build
   * the backend waits for first; `samplesWait.ts` follows the build.
   * @param path - File path
   * @param ranges - Array of line ranges in format "start-end" (e.g., ["1-100", "200-300"])
   *                 Can also include negative numbers like "-1" for end of file
   * @param context - Optional context lines (used with single line numbers like "-1")
   */
  async getSamples(
    path: string,
    ranges: string[],
    context?: number,
    options?: SamplesRequestOptions,
  ): Promise<SamplesAnswer> {
    const params = new URLSearchParams({
      path,
      lines: ranges.join(','),
    });
    if (context !== undefined) {
      params.set('context', context.toString());
    }
    withFileTz(params, options?.fileTz);
    return fetchSamples(`${API_BASE}/samples?${params}`, options);
  },

  /**
   * Resolve byte offsets to line numbers.
   *
   * A trace match always carries an absolute byte offset, even when the
   * backend could not say which file line it is on (see resolveMatchLine).
   * The response's `offsets` map answers offset -> line number. Like
   * getSamples, it may answer with an index build to wait for.
   *
   * @param path - File path
   * @param offsets - Absolute byte offsets
   * @param context - Optional number of context lines around each offset
   */
  async getSamplesByOffset(
    path: string,
    offsets: number[],
    context?: number,
    options?: SamplesRequestOptions,
  ): Promise<SamplesAnswer> {
    const params = new URLSearchParams({
      path,
      offsets: offsets.join(','),
    });
    if (context !== undefined) {
      params.set('context', context.toString());
    }
    withFileTz(params, options?.fileTz);
    return fetchSamples(`${API_BASE}/samples?${params}`, options);
  },

  /**
   * The line a time finds and the lines around it: `timestamps=<value>`,
   * the first line whose own timestamp is at or after the time. The value
   * goes as given; the answer is filed under it (`readTimeAnswer`). Check
   * `backendHas('samples_timestamps')` first. Like getSamples, it may
   * answer with an index build to wait for.
   * @param path - File path
   * @param value - A time as `--timestamps` reads one
   * @param context - Lines before and after the found line
   */
  async getSamplesByTime(
    path: string,
    value: string,
    context: number,
    options?: SamplesRequestOptions,
  ): Promise<SamplesAnswer> {
    const params = new URLSearchParams({ path, timestamps: value, context: String(context) });
    withFileTz(params, options?.fileTz);
    return fetchSamples(`${API_BASE}/samples?${params}`, options);
  },

  /**
   * When a file's first and last timestamped lines were written, and how
   * the file writes a time. Check `backendHas('time_range')` first.
   * @param path - File path
   */
  async getTimeRange(
    path: string,
    options: FileZoneRequestOptions = {},
  ): Promise<TimeRangeResponse> {
    const { fileTz, ...request } = options;
    const params = withFileTz(new URLSearchParams({ path }), fileTz);
    return fetchJson<TimeRangeResponse>(`${API_BASE}/time-range?${params}`, request);
  },

  /**
   * Search files for one or more patterns.
   * @param paths - Files or directories to search
   * @param patterns - Patterns; a line matching any of them is a match
   * @param query.maxResults - Stop after this many matches
   * @param query.flags - ripgrep matching flags; only those set to true are sent
   */
  async trace(
    paths: string[],
    patterns: string[],
    query: { maxResults?: number; flags?: TraceMatchingFlags } = {},
    options?: RequestOptions,
  ): Promise<TraceResponse> {
    const params = traceQuery(paths, patterns, query);
    return fetchJson<TraceResponse>(`${API_BASE}/trace?${params}`, options);
  },

  /**
   * Get cached index data for a file (instant response)
   * @param path - File path to get index for
   * @returns Index data if exists, or throws 404 ApiError if not found
   */
  async getIndex(path: string, options?: RequestOptions): Promise<IndexResponse> {
    const params = new URLSearchParams({ path });
    return fetchJson<IndexResponse>(`${API_BASE}/index?${params}`, options);
  },

  /**
   * Start a background indexing task for a file
   * @param path - File path to index
   * @param options - Indexing options
   * @param options.force - Force rebuild even if valid index exists
   * @param options.analyze - Run full analysis with anomaly detection
   * @param options.threshold - Minimum file size in MB to index (default 50)
   */
  async startIndex(
    path: string,
    options: { force?: boolean; analyze?: boolean; threshold?: number } = {},
  ): Promise<IndexTaskResponse> {
    const { force = false, analyze = false, threshold } = options;
    const body: Record<string, unknown> = { path, force, analyze };
    if (threshold !== undefined) {
      body.threshold = threshold;
    }
    return fetchJson<IndexTaskResponse>(`${API_BASE}/index`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  /**
   * Get task status
   * @param taskId - Task ID to check
   */
  async getTaskStatus(taskId: string, options?: RequestOptions): Promise<TaskStatus> {
    return fetchJson<TaskStatus>(`${API_BASE}/tasks/${encodeURIComponent(taskId)}`, options);
  },

  /**
   * Get available anomaly detectors metadata
   * @returns Detectors, categories, and severity scale information
   */
  async getDetectors(): Promise<DetectorsResponse> {
    return fetchJson<DetectorsResponse>(`${API_BASE}/detectors`);
  },

  /**
   * The log chains of one directory, found from its files' names alone.
   * Check `backendHas('log_chains')` first, as for every chain route.
   * @param dir - Directory path
   */
  async logChains(dir: string, options?: RequestOptions): Promise<ChainsResponse> {
    const params = new URLSearchParams({ path: dir });
    return fetchJson<ChainsResponse>(`${API_BASE}/logs/chains?${params}`, options);
  },

  /**
   * Describe one chain: its parts in time order, its state and the index
   * task a pending chain waits for, which this request starts or joins.
   * With `fingerprint`, a chain whose files changed since answers as
   * changed, with its current description.
   * @param handle - The chain's handle, as a listing gives it in `path`
   */
  async logChain(handle: string, options: ChainRequestOptions = {}): Promise<LogChainAnswer> {
    const { fileTz, fingerprint, ...request } = options;
    const params = withFingerprint(
      withFileTz(new URLSearchParams({ path: handle }), fileTz),
      fingerprint,
    );
    return orChanged(
      fetchJson<ChainResponse>(`${API_BASE}/logs/chain?${params}`, request).then(
        (chain) => ({ kind: 'chain', chain }) as const,
      ),
    );
  },

  /**
   * Lines of a chain by global line, by a part's own line or by time,
   * each key's lines as pieces, one per part they come from. A request
   * by global line or time on a pending chain may answer with the
   * chain's index task (`respondAsync`); a 409 answers the changed
   * chain, and a 422 the reasons an invalid chain cannot be read.
   */
  async logSamples(
    params: LogSamplesParams,
    options: LogSamplesOptions = {},
  ): Promise<LogSamplesAnswer> {
    const { fingerprint: _fingerprint, ...request } = options;
    const query = logSamplesQuery(params, options);
    try {
      return await orChanged(
        fetchSamplesAnswer<ChainSamplesResponse>(`${API_BASE}/logs/samples?${query}`, request),
      );
    } catch (error) {
      if (error instanceof ApiError && error.status === HTTP_UNPROCESSABLE) {
        return { kind: 'invalid', detail: error.message };
      }
      throw error;
    }
  },

  /**
   * Search chains, directories and files, each chain's parts in its
   * order, with each part's match placed in its chain. The parameters
   * are `trace`'s. A 409 (a part changed while it was read) is an error:
   * one search may reach several chains, so it carries no description.
   */
  async logTrace(
    paths: string[],
    patterns: string[],
    query: { maxResults?: number; flags?: TraceMatchingFlags } = {},
    options?: RequestOptions,
  ): Promise<ChainTraceResponse> {
    const params = traceQuery(paths, patterns, query);
    return fetchJson<ChainTraceResponse>(`${API_BASE}/logs/trace?${params}`, options);
  },

  /**
   * Start or join the index task of a chain, which builds every part's
   * line index (every part again with `force`). The handle goes in the
   * query; the request has no body.
   */
  async logIndex(
    handle: string,
    options: RequestOptions & { force?: boolean; fingerprint?: string } = {},
  ): Promise<LogIndexAnswer> {
    const { force = false, fingerprint, ...request } = options;
    const params = withFingerprint(new URLSearchParams({ path: handle }), fingerprint);
    if (force) params.set('force', 'true');
    return orChanged(
      fetchJson<IndexTaskResponse>(`${API_BASE}/logs/index?${params}`, {
        ...request,
        method: 'POST',
      }).then((task) => ({ kind: 'task', task }) as const),
    );
  },
};

export { ApiError };

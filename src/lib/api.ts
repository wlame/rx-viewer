import type {
  HealthResponse,
  TreeResponse,
  SamplesResponse,
  TraceResponse,
  TaskStatus,
  IndexData,
  IndexTaskResponse,
  DetectorsResponse,
} from './types';
import { parseSandboxError, describeSandboxError } from './utils/sandboxError';

const API_BASE = '/v1';

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

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new ApiError(
      response.status,
      response.statusText,
      errorMessageFrom(text, response.statusText),
      text,
    );
  }

  return response.json();
}

export const api = {
  /**
   * Check API health status
   * @param clientId - Optional client identifier for tracking
   */
  async getHealth(clientId?: string): Promise<HealthResponse> {
    const url = clientId ? `/health?client=${encodeURIComponent(clientId)}` : '/health';
    return fetchJson<HealthResponse>(url);
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
   * Get file content samples for specific line ranges
   * @param path - File path
   * @param ranges - Array of line ranges in format "start-end" (e.g., ["1-100", "200-300"])
   *                 Can also include negative numbers like "-1" for end of file
   * @param context - Optional context lines (used with single line numbers like "-1")
   */
  async getSamples(
    path: string,
    ranges: string[],
    context?: number,
    options?: RequestOptions,
  ): Promise<SamplesResponse> {
    const params = new URLSearchParams({
      path,
      lines: ranges.join(','),
    });
    if (context !== undefined) {
      params.set('context', context.toString());
    }
    return fetchJson<SamplesResponse>(`${API_BASE}/samples?${params}`, options);
  },

  /**
   * Resolve byte offsets to line numbers.
   *
   * A trace match always carries an absolute byte offset, even when the
   * backend could not say which file line it is on (see resolveMatchLine).
   * The response's `offsets` map answers offset -> line number.
   *
   * @param path - File path
   * @param offsets - Absolute byte offsets
   * @param context - Optional number of context lines around each offset
   */
  async getSamplesByOffset(
    path: string,
    offsets: number[],
    context?: number,
    options?: RequestOptions,
  ): Promise<SamplesResponse> {
    const params = new URLSearchParams({
      path,
      offsets: offsets.join(','),
    });
    if (context !== undefined) {
      params.set('context', context.toString());
    }
    return fetchJson<SamplesResponse>(`${API_BASE}/samples?${params}`, options);
  },

  /**
   * Search for patterns in files using ripgrep
   * @param paths - File or directory paths to search
   * @param patterns - Regex patterns to search for
   * @param maxResults - Maximum number of results (optional)
   * @param caseSensitive - Case sensitive search (optional)
   * @param contextBefore - Lines of context before match (optional)
   * @param contextAfter - Lines of context after match (optional)
   */
  async trace(
    paths: string[],
    patterns: string[],
    maxResults?: number,
    caseSensitive?: boolean,
    contextBefore?: number,
    contextAfter?: number,
    options?: RequestOptions,
  ): Promise<TraceResponse> {
    const params = new URLSearchParams();
    paths.forEach((p) => params.append('path', p));
    patterns.forEach((r) => params.append('regexp', r));
    if (maxResults !== undefined) {
      params.set('max_results', maxResults.toString());
    }
    if (caseSensitive !== undefined) {
      params.set('case_sensitive', caseSensitive.toString());
    }
    if (contextBefore !== undefined) {
      params.set('context_before', contextBefore.toString());
    }
    if (contextAfter !== undefined) {
      params.set('context_after', contextAfter.toString());
    }
    return fetchJson<TraceResponse>(`${API_BASE}/trace?${params}`, options);
  },

  /**
   * Get cached index data for a file (instant response)
   * @param path - File path to get index for
   * @returns Index data if exists, or throws 404 ApiError if not found
   */
  async getIndex(path: string, options?: RequestOptions): Promise<IndexData> {
    const params = new URLSearchParams({ path });
    return fetchJson<IndexData>(`${API_BASE}/index?${params}`, options);
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
  async getTaskStatus(taskId: string): Promise<TaskStatus> {
    return fetchJson<TaskStatus>(`${API_BASE}/tasks/${taskId}`);
  },

  /**
   * Get available anomaly detectors metadata
   * @returns Detectors, categories, and severity scale information
   */
  async getDetectors(): Promise<DetectorsResponse> {
    return fetchJson<DetectorsResponse>(`${API_BASE}/detectors`);
  },
};

export { ApiError };

import { api, ApiError } from './api';
import { files, tree } from './stores';
import { taskPolls } from './utils/taskPolling';
import type { IndexData, TaskStatus, TreeEntry } from './types';

/**
 * The tree's Analyze, Index and Re-index actions, from the request to
 * the refreshed tree badge and open file.
 *
 * Every task is followed through `taskPolls`, so an action on a file
 * whose task is already followed joins that poll instead of starting
 * another one.
 */

export type TreeMenuAction = 'analyze' | 'index' | 'reindex';

export interface TreeMenuItem {
  action: TreeMenuAction;
  label: string;
}

const ANALYZE_ITEM: TreeMenuItem = { action: 'analyze', label: 'Analyze' };

/** The index item of a compressed file, keyed by whether it is indexed already. */
const INDEX_ITEM: Record<'true' | 'false', TreeMenuItem> = {
  false: { action: 'index', label: 'Index' },
  true: { action: 'reindex', label: 'Re-index' },
};

/**
 * The context-menu items of a tree entry.
 *
 * Only a text file has lines to index and analyse; the backend answers a
 * directory or a binary file with a 400. A plain file gets its index on
 * first use, so the explicit index item is offered on compressed files.
 */
export function treeMenuItems(
  entry: Pick<TreeEntry, 'type' | 'is_text' | 'is_compressed' | 'is_indexed'>,
): TreeMenuItem[] {
  if (entry.type !== 'file' || entry.is_text === false) return [];
  if (!entry.is_compressed) return [ANALYZE_ITEM];
  return [ANALYZE_ITEM, INDEX_ITEM[entry.is_indexed ? 'true' : 'false']];
}

const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;

/** The prose form of a running task's ID in a 409: "... (task: <id>)". */
const TASK_ID_IN_PROSE = /task:\s*([^\s)]+)/i;

/**
 * The ID of the task a 409 "already indexing" names, or null.
 *
 * Reads the structured `task_id` member of the error body first, and
 * falls back to the ID in the `detail` sentence for a backend that only
 * names the task there.
 */
export function conflictTaskId(error: unknown): string | null {
  if (!(error instanceof ApiError) || error.status !== HTTP_CONFLICT) return null;
  try {
    const body = JSON.parse(error.body) as { task_id?: unknown };
    if (typeof body?.task_id === 'string' && body.task_id) return body.task_id;
  } catch {
    // Not JSON: only the prose can name the task.
  }
  return TASK_ID_IN_PROSE.exec(error.message)?.[1] ?? null;
}

interface IndexRequest {
  force: boolean;
  analyze: boolean;
  /** MB; 0 indexes a file of any size, which an explicit request wants. */
  threshold?: number;
}

/** Index requests wait for no dialog: their poll runs until the task ends. */
const NEVER_ABORTED = new AbortController().signal;

/** The cached index of a file, or null when it has none. */
async function cachedIndex(path: string, signal: AbortSignal): Promise<IndexData | null> {
  try {
    return await api.getIndex(path, { signal });
  } catch (error) {
    if (error instanceof ApiError && error.status === HTTP_NOT_FOUND) return null;
    throw error;
  }
}

/** Start an index task, or join the one a 409 names, and wait for its result. */
async function runIndexTask(
  path: string,
  request: IndexRequest,
  signal: AbortSignal,
  onStatus?: (task: TaskStatus) => void,
): Promise<IndexData> {
  let taskId: string;
  try {
    taskId = (await api.startIndex(path, request)).task_id;
  } catch (error) {
    const runningTaskId = conflictTaskId(error);
    if (!runningTaskId) throw error;
    taskId = runningTaskId;
  }
  return taskPolls.join(path, taskId, { signal, onStatus });
}

/** Show a freshly built index in the tree and in the open file. */
function publishIndex(path: string, indexData: IndexData): IndexData {
  tree.markIndexed(path, indexData.line_count ?? null);
  files.applyIndex(path, indexData);
  return indexData;
}

export interface AnalyzeOptions {
  /** Aborting it stops this caller's wait; the backend task runs on. */
  signal: AbortSignal;
  onStatus?: (task: TaskStatus) => void;
}

/**
 * The analysis of a file: the cached one when the cached index holds an
 * analysis, otherwise the result of an analysis task.
 *
 * An index written while the file was opened or searched has no
 * analysis, and is not shown as one. A task already running for the file
 * is joined; when it was a plain index build and ends without an
 * analysis, the analysis is asked for once that task is out of the way.
 */
export async function analyzeFile(path: string, options: AnalyzeOptions): Promise<IndexData> {
  const { signal, onStatus } = options;

  const followedTaskId = taskPolls.activeTask(path);
  if (followedTaskId) {
    const joined = await taskPolls.join(path, followedTaskId, { signal, onStatus });
    if (joined.analysis_performed) return publishIndex(path, joined);
  } else {
    const cached = await cachedIndex(path, signal);
    if (cached?.analysis_performed) return publishIndex(path, cached);
  }

  const analysis = { force: false, analyze: true };
  const result = await runIndexTask(path, analysis, signal, onStatus);
  if (result.analysis_performed) return publishIndex(path, result);
  return publishIndex(path, await runIndexTask(path, analysis, signal, onStatus));
}

export interface IndexOptions {
  /** Rebuild an index that exists; without it the backend returns the cached one. */
  reindex: boolean;
}

/**
 * Build a file's index whatever its size, and show it in the tree and
 * the open file.
 *
 * A re-index keeps the analysis when the cached index has one, so the
 * open file does not lose its anomalies to a rebuild.
 */
export async function indexFile(path: string, options: IndexOptions): Promise<IndexData> {
  const { reindex } = options;
  const cached = reindex ? await cachedIndex(path, NEVER_ABORTED) : null;
  const request: IndexRequest = {
    force: reindex,
    analyze: cached?.analysis_performed ?? false,
    threshold: 0,
  };
  return publishIndex(path, await runIndexTask(path, request, NEVER_ABORTED));
}

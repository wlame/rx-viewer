import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { files, tree } from './stores';
import { analyzeFile, conflictTaskId, indexFile, treeMenuItems } from './indexTasks';
import { ApiError } from './api';
import { isAbortError } from './utils/latestRequest';
import type { TreeNode } from './types';

const ROOT = '/var/log';
const PATH = '/var/log/app.log.gz';
const POLL_INTERVAL = 1000;

type Answer = [status: number, body: unknown];
type Handler = (body: Record<string, unknown> | undefined) => Answer;

interface Call {
  route: string;
  body: Record<string, unknown> | undefined;
}

/**
 * A backend answering by `METHOD /pathname`, recording every call. A
 * route with a list of answers gives them in turn and then repeats the
 * last one; an unknown route answers 404, as a missing index does.
 */
function stubBackend(routes: Record<string, Handler | Answer[]>) {
  const calls: Call[] = [];
  const served = new Map<string, number>();
  const spy = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const route = `${method} ${new URL(url, 'http://localhost').pathname}`;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ route, body });

    const routeAnswers = routes[route];
    let answer: Answer = [404, { detail: 'Not Found' }];
    if (typeof routeAnswers === 'function') answer = routeAnswers(body);
    else if (routeAnswers) {
      const n = served.get(route) ?? 0;
      served.set(route, n + 1);
      answer = routeAnswers[Math.min(n, routeAnswers.length - 1)];
    }
    const [status, payload] = answer;
    return {
      ok: status < 400,
      status,
      statusText: String(status),
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    };
  });
  vi.stubGlobal('fetch', spy);
  return { calls, routes: () => calls.map((c) => c.route) };
}

function indexData(analysisPerformed: boolean, extra: Record<string, unknown> = {}) {
  return {
    path: PATH,
    analysis_performed: analysisPerformed,
    line_count: 120,
    anomalies: analysisPerformed
      ? [
          {
            start_line: 7,
            end_line: 7,
            start_offset: 0,
            end_offset: 10,
            severity: 0.9,
            category: 'error',
            description: 'ERROR line',
            detector: 'error_keyword',
          },
        ]
      : null,
    ...extra,
  };
}

const started = (taskId: string): Answer => [200, { task_id: taskId, status: 'queued' }];
const running = (taskId: string): Answer => [200, { task_id: taskId, status: 'running' }];
const completed = (taskId: string, result: unknown): Answer => [
  200,
  { task_id: taskId, status: 'completed', result },
];

function stubWindow() {
  vi.stubGlobal('window', {
    location: { href: 'http://localhost:5173/', search: '' },
    history: { replaceState: () => {} },
  });
}

/** Let the polls and the stubbed requests settle, one poll interval at a time. */
async function settle(intervals = 3) {
  for (let i = 0; i < intervals; i++) await vi.advanceTimersByTimeAsync(POLL_INTERVAL);
}

beforeEach(() => {
  vi.useFakeTimers();
  stubWindow();
});

afterEach(() => {
  for (const file of get(files).openFiles) files.closeFile(file.path);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('analyzeFile', () => {
  // Opening a large or compressed file writes an index without analysis;
  // showing it as the analysis reports a clean file.
  it('starts an analysis when the cached index has none', async () => {
    const backend = stubBackend({
      'GET /v1/index': [[200, indexData(false)]],
      'POST /v1/index': [started('t1')],
      'GET /v1/tasks/t1': [running('t1'), completed('t1', indexData(true))],
    });

    const result = analyzeFile(PATH, { signal: new AbortController().signal });
    await settle();

    await expect(result).resolves.toMatchObject({ analysis_performed: true });
    const post = backend.calls.find((c) => c.route === 'POST /v1/index');
    expect(post?.body).toMatchObject({ path: PATH, analyze: true });
  });

  it('shows a cached index that holds an analysis without starting a task', async () => {
    const backend = stubBackend({ 'GET /v1/index': [[200, indexData(true)]] });

    const result = await analyzeFile(PATH, { signal: new AbortController().signal });

    expect(result.analysis_performed).toBe(true);
    expect(backend.routes()).toEqual(['GET /v1/index']);
  });

  it('starts an analysis when there is no index at all', async () => {
    const backend = stubBackend({
      'POST /v1/index': [started('t1')],
      'GET /v1/tasks/t1': [completed('t1', indexData(true))],
    });

    const result = analyzeFile(PATH, { signal: new AbortController().signal });
    await settle();

    await expect(result).resolves.toMatchObject({ analysis_performed: true });
    expect(backend.routes()).toContain('POST /v1/index');
  });

  it('joins the running task a 409 names, and starts no second one', async () => {
    const backend = stubBackend({
      'POST /v1/index': [
        [409, { detail: `Indexing already in progress for ${PATH} (task: 0a1b-2c3d)` }],
      ],
      'GET /v1/tasks/0a1b-2c3d': [completed('0a1b-2c3d', indexData(true))],
    });

    const result = analyzeFile(PATH, { signal: new AbortController().signal });
    await settle();

    await expect(result).resolves.toMatchObject({ analysis_performed: true });
    expect(backend.routes().filter((r) => r === 'POST /v1/index')).toHaveLength(1);
  });

  // The joined task may be a plain index build, which ends without an
  // analysis; the analysis is then asked for once it is free to start.
  it('asks again for an analysis when the joined task ended without one', async () => {
    const backend = stubBackend({
      'POST /v1/index': [
        [409, { detail: 'Indexing already in progress (task: t1)' }],
        started('t2'),
      ],
      'GET /v1/tasks/t1': [completed('t1', indexData(false))],
      'GET /v1/tasks/t2': [completed('t2', indexData(true))],
    });

    const result = analyzeFile(PATH, { signal: new AbortController().signal });
    await settle();

    await expect(result).resolves.toMatchObject({ analysis_performed: true });
    expect(backend.routes().filter((r) => r === 'POST /v1/index')).toHaveLength(2);
  });

  it('stops polling once its signal aborts', async () => {
    const backend = stubBackend({
      'POST /v1/index': [started('t1')],
      'GET /v1/tasks/t1': [running('t1')],
    });
    const dialog = new AbortController();

    const result = analyzeFile(PATH, { signal: dialog.signal });
    result.catch(() => {});
    await settle(2);
    dialog.abort();
    const pollsAtClose = backend.routes().filter((r) => r === 'GET /v1/tasks/t1').length;
    await settle(5);

    await expect(result).rejects.toSatisfy(isAbortError);
    expect(backend.routes().filter((r) => r === 'GET /v1/tasks/t1')).toHaveLength(pollsAtClose);
  });

  it('reuses the poll already running for the file instead of asking again', async () => {
    const backend = stubBackend({
      'POST /v1/index': [started('t1')],
      'GET /v1/tasks/t1': [running('t1'), running('t1'), completed('t1', indexData(true))],
    });

    const first = analyzeFile(PATH, { signal: new AbortController().signal });
    await settle(1);
    const second = analyzeFile(PATH, { signal: new AbortController().signal });
    await settle(3);

    await expect(first).resolves.toMatchObject({ analysis_performed: true });
    await expect(second).resolves.toMatchObject({ analysis_performed: true });
    expect(backend.routes().filter((r) => r === 'POST /v1/index')).toHaveLength(1);
    expect(backend.routes().filter((r) => r === 'GET /v1/tasks/t1')).toHaveLength(3);
  });
});

describe('indexFile', () => {
  // The backend answers a file under its size threshold with a 400; a
  // user who asks for an index wants one whatever the size.
  it('asks for an index whatever the file size', async () => {
    const backend = stubBackend({
      'POST /v1/index': [started('t1')],
      'GET /v1/tasks/t1': [completed('t1', indexData(false))],
    });

    const result = indexFile(PATH, { reindex: false });
    await settle();
    await result;

    const post = backend.calls.find((c) => c.route === 'POST /v1/index');
    expect(post?.body).toMatchObject({ path: PATH, threshold: 0, force: false, analyze: false });
  });

  // Without force the backend hands back the cached index unchanged.
  it('forces a rebuild on re-index', async () => {
    const backend = stubBackend({
      'GET /v1/index': [[200, indexData(false)]],
      'POST /v1/index': [started('t1')],
      'GET /v1/tasks/t1': [completed('t1', indexData(false))],
    });

    const result = indexFile(PATH, { reindex: true });
    await settle();
    await result;

    const post = backend.calls.find((c) => c.route === 'POST /v1/index');
    expect(post?.body).toMatchObject({ path: PATH, threshold: 0, force: true, analyze: false });
  });

  // A rebuild without analysis would drop the anomalies the file has.
  it('keeps the analysis on re-index when the cached index has one', async () => {
    const backend = stubBackend({
      'GET /v1/index': [[200, indexData(true)]],
      'POST /v1/index': [started('t1')],
      'GET /v1/tasks/t1': [completed('t1', indexData(true))],
    });

    const result = indexFile(PATH, { reindex: true });
    await settle();
    await result;

    const post = backend.calls.find((c) => c.route === 'POST /v1/index');
    expect(post?.body).toMatchObject({ force: true, analyze: true });
  });
});

describe('a finished task', () => {
  /** A tree with one root folder, expanded, holding the file. */
  async function loadTreeWithFile() {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const path = new URL(url, 'http://localhost').searchParams.get('path');
        const entries = path
          ? [{ name: 'app.log.gz', path: PATH, type: 'file', is_text: true, is_indexed: false }]
          : [{ name: 'log', path: ROOT, type: 'directory' }];
        return { ok: true, status: 200, statusText: 'OK', json: async () => ({ entries }) };
      }),
    );
    await tree.loadRoots();
    await tree.loadDirectory(ROOT);
  }

  function treeEntry(): TreeNode | undefined {
    return get(tree).roots[0]?.children.find((n) => n.path === PATH);
  }

  it('marks the file indexed in the tree and gives the open file its anomalies', async () => {
    await loadTreeWithFile();
    stubBackend({
      'POST /v1/index': [started('t1')],
      'GET /v1/tasks/t1': [completed('t1', indexData(true, { line_count: 120 }))],
    });
    await files.openFile(PATH, undefined, 1000, undefined, false);

    const result = analyzeFile(PATH, { signal: new AbortController().signal });
    await settle();
    await result;

    expect(treeEntry()).toMatchObject({ is_indexed: true, line_count: 120 });
    const open = get(files).openFiles.find((f) => f.path === PATH);
    expect(open).toMatchObject({ isIndexed: true, totalLines: 120 });
    expect(open?.anomalies).toHaveLength(1);
    expect(open?.anomalySummary).toEqual({ error: 1 });
  });

  it('refreshes the tree badge after a plain index', async () => {
    await loadTreeWithFile();
    stubBackend({
      'POST /v1/index': [started('t1')],
      'GET /v1/tasks/t1': [completed('t1', indexData(false, { line_count: 80 }))],
    });

    const result = indexFile(PATH, { reindex: false });
    await settle();
    await result;

    expect(treeEntry()).toMatchObject({ is_indexed: true, line_count: 80 });
  });
});

describe('treeMenuItems', () => {
  const file = { type: 'file', is_text: true, is_compressed: false, is_indexed: false } as const;

  it('offers nothing on a directory', () => {
    expect(treeMenuItems({ ...file, type: 'directory', is_text: null })).toEqual([]);
  });

  it('offers nothing on a file that is not text', () => {
    expect(treeMenuItems({ ...file, is_text: false })).toEqual([]);
  });

  it('offers Analyze on a plain text file', () => {
    expect(treeMenuItems(file).map((i) => i.label)).toEqual(['Analyze']);
  });

  it.each([
    [false, 'Index'],
    [true, 'Re-index'],
  ])('offers an index item on a compressed file indexed=%s', (isIndexed, label) => {
    const items = treeMenuItems({ ...file, is_compressed: true, is_indexed: isIndexed });
    expect(items.map((i) => i.label)).toEqual(['Analyze', label]);
  });
});

describe('conflictTaskId', () => {
  it('reads a structured task id from the error body', () => {
    const error = new ApiError(
      409,
      'Conflict',
      'Indexing already in progress',
      JSON.stringify({ detail: 'Indexing already in progress', task_id: 'abc-123' }),
    );
    expect(conflictTaskId(error)).toBe('abc-123');
  });

  it('falls back to the task id in the prose', () => {
    const detail = `Indexing already in progress for ${PATH} (task: ef20b52b-1790-4020)`;
    const error = new ApiError(409, 'Conflict', detail, JSON.stringify({ detail }));
    expect(conflictTaskId(error)).toBe('ef20b52b-1790-4020');
  });

  it('finds nothing in a 409 that names no task', () => {
    const error = new ApiError(409, 'Conflict', 'Busy', '{"detail":"Busy"}');
    expect(conflictTaskId(error)).toBeNull();
  });

  it('finds nothing in an error that is not a 409', () => {
    const error = new ApiError(400, 'Bad Request', '(task: abc)', '{"detail":"(task: abc)"}');
    expect(conflictTaskId(error)).toBeNull();
  });
});

import { api, type RequestOptions, type SamplesAnswer } from './api';
import { contractGate } from './contractGate';
import { requestZoneOf } from './stores/fileZones';
import { backendHas } from './stores/health';
import { tree } from './stores/tree';
import type { IndexBuild, IndexTaskResult, SamplesResponse, TaskStatus } from './types';
import { isAbortError } from './utils/latestRequest';
import { taskPolls, type TaskPolls } from './utils/taskPolling';

/**
 * Samples of a file whose line index the backend is still building.
 *
 * A backend that lists the `samples_index_build` feature on `/health`
 * builds a missing index as a background task and waits for it only a
 * few seconds. A longer build
 * gets a 202 naming the task; the lookup follows that task through the
 * app's shared, cancellable task poll, then asks for the same lines
 * again, which the backend now answers from the index.
 */

export type { IndexBuild };

export interface SamplesWaitOptions {
  signal?: AbortSignal;
  /** Called with the build while the lookup waits for one, and with null when the lines arrive. */
  onIndexBuild?: (build: IndexBuild | null) => void;
  /** Called with the index a followed build completed with, before the lines are asked again. */
  onIndexBuilt?: (index: IndexTaskResult) => void;
}

/** What the wait needs from the rest of the app; tests pass their own. */
export interface SamplesWaitDeps {
  polls: Pick<TaskPolls, 'join'>;
  /** Whether the backend has the samples index build. */
  supportsIndexBuild: () => boolean;
  /** Marks the file indexed in the tree, with its line count when known. */
  markIndexed: (path: string, lineCount: number | null) => void;
}

const APP_DEPS: SamplesWaitDeps = {
  polls: taskPolls,
  supportsIndexBuild: () => backendHas('samples_index_build'),
  markIndexed: (path, lineCount) => tree.markIndexed(path, lineCount),
};

/**
 * Builds a lookup follows before giving up. One is the rule; another
 * starts when the file changed while the first ran, and one more covers
 * a change during that.
 */
const MAX_INDEX_BUILDS = 3;

/**
 * The samples `request` answers, after following any index build the
 * backend answers with first.
 *
 * `request` is told whether to send `Prefer: respond-async`: only when
 * the backend has the build, since only then can a 202 be
 * followed. Without it the backend waits for the build and answers the
 * lines. A build that completes marks the file indexed in the tree and
 * goes to `options.onIndexBuilt`, as an Index from the tree's menu does.
 *
 * A build that fails does not fail the lookup: asked again, the backend
 * reads the file without an index, slower and with the same lines.
 * Rejects with an AbortError when `options.signal` aborts, with the
 * request's own error, and when the backend answers 202 although its
 * features do not list the build, or keeps answering 202.
 */
export async function samplesAfterIndexBuild(
  path: string,
  request: (signal: AbortSignal | undefined, respondAsync: boolean) => Promise<SamplesAnswer>,
  options: SamplesWaitOptions = {},
  deps: SamplesWaitDeps = APP_DEPS,
): Promise<SamplesResponse> {
  const { signal, onIndexBuild, onIndexBuilt } = options;
  const respondAsync = deps.supportsIndexBuild();
  // TaskPolls.join wants a signal; a caller that cannot abort gets one that never does.
  const pollSignal = signal ?? new AbortController().signal;

  for (let builds = 0; ; builds++) {
    const answer = await request(signal, respondAsync);
    if (answer.kind === 'samples') {
      if (builds > 0) onIndexBuild?.(null);
      return answer.samples;
    }
    if (!respondAsync) {
      throw new Error(
        `The backend answered 202 for the samples of ${path}, which it does not list as a feature`,
      );
    }
    if (builds >= MAX_INDEX_BUILDS) {
      throw new Error(`The line index of ${path} is still being built; try again later`);
    }

    const taskId = answer.task.task_id;
    onIndexBuild?.({ taskId, progress: null });
    try {
      const index = await deps.polls.join(path, taskId, {
        signal: pollSignal,
        onStatus: (task: TaskStatus) => onIndexBuild?.({ taskId, progress: task.progress }),
      });
      deps.markIndexed(path, index.line_count ?? null);
      onIndexBuilt?.(index);
    } catch (error) {
      if (isAbortError(error) || signal?.aborted) throw error;
      // The build failed or its task is gone; the next request answers anyway.
    }
  }
}

/**
 * The samples of `path` that `request` answers, after any index build.
 * The request waits for the contract gate first, so the backend's
 * features are known when it decides `Prefer: respond-async` and the
 * file's `file_tz`: a file named in a link opens before the first
 * `/health` answer. The zone is read for each request it sends.
 */
async function loadFileSamples(
  path: string,
  request: (
    signal: AbortSignal | undefined,
    respondAsync: boolean,
    fileTz: string | undefined,
  ) => Promise<SamplesAnswer>,
  options: SamplesWaitOptions & RequestOptions,
): Promise<SamplesResponse> {
  await contractGate.pass(options.signal);
  return samplesAfterIndexBuild(
    path,
    (signal, respondAsync) => request(signal, respondAsync, requestZoneOf(path)),
    options,
  );
}

/** Lines of `path` by line number or range, after any index build. */
export function loadSamples(
  path: string,
  ranges: string[],
  context: number | undefined,
  options: SamplesWaitOptions & RequestOptions = {},
): Promise<SamplesResponse> {
  return loadFileSamples(
    path,
    (signal, respondAsync, fileTz) =>
      api.getSamples(path, ranges, context, { signal, respondAsync, fileTz }),
    options,
  );
}

/** Lines of `path` around byte offsets, after any index build. */
export function loadSamplesByOffset(
  path: string,
  offsets: number[],
  context: number | undefined,
  options: SamplesWaitOptions & RequestOptions = {},
): Promise<SamplesResponse> {
  return loadFileSamples(
    path,
    (signal, respondAsync, fileTz) =>
      api.getSamplesByOffset(path, offsets, context, { signal, respondAsync, fileTz }),
    options,
  );
}

/** Lines of `path` around the line a time finds, after any index build. */
export function loadSamplesByTime(
  path: string,
  value: string,
  context: number,
  options: SamplesWaitOptions & RequestOptions = {},
): Promise<SamplesResponse> {
  return loadFileSamples(
    path,
    (signal, respondAsync, fileTz) =>
      api.getSamplesByTime(path, value, context, { signal, respondAsync, fileTz }),
    options,
  );
}

/** The mark on a file whose line index is built in the background: `indexing 42%`. */
export function indexingLabel(build: IndexBuild): string {
  if (build.progress === null) return 'indexing';
  return `indexing ${Math.floor(build.progress * 100)}%`;
}

/** What the file's view says while its index is built. */
export function indexBuildLabel(build: IndexBuild): string {
  const label = 'Building the line index…';
  if (build.progress === null) return label;
  return `${label} ${Math.floor(build.progress * 100)}%`;
}

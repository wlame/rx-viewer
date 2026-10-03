import { describe, expect, it, vi } from 'vitest';
import type { SamplesAnswer } from './api';
import type { IndexTaskResponse, IndexTaskResult, SamplesResponse, TaskStatus } from './types';
import {
  indexBuildLabel,
  samplesAfterIndexBuild,
  type IndexBuild,
  type SamplesWaitDeps,
} from './samplesWait';
import { isAbortError } from './utils/latestRequest';

const PATH = '/var/log/core.log';

const SAMPLES: SamplesResponse = {
  path: PATH,
  offsets: {},
  lines: { '5': 40 },
  before_context: 0,
  after_context: 0,
  samples: { '5': ['LINE 5'] },
  is_compressed: false,
  compression_format: null,
  cli_command: `rx samples ${PATH} --lines=5`,
};

function building(taskId = 't1'): SamplesAnswer {
  const task: IndexTaskResponse = {
    task_id: taskId,
    status: 'running',
    message: 'Building the line index',
    path: PATH,
    started_at: '2026-10-03T00:00:00.000000Z',
  };
  return { kind: 'building', task };
}

const LINES: SamplesAnswer = { kind: 'samples', samples: SAMPLES };

function status(progress: number | null): TaskStatus {
  return {
    task_id: 't1',
    status: 'running',
    path: PATH,
    operation: 'index',
    started_at: null,
    completed_at: null,
    error: null,
    progress,
    result: null,
  };
}

/** A request that answers with the given answers in turn. */
function answers(...sequence: SamplesAnswer[]) {
  const queue = [...sequence];
  return vi.fn(async () => {
    const next = queue.shift();
    if (!next) throw new Error('asked once too often');
    return next;
  });
}

/** Polls that report the given progress values and then end as `outcome` says. */
function polls(progress: (number | null)[], outcome: 'completed' | Error = 'completed') {
  const join = vi.fn(
    async (
      _path: string,
      _taskId: string,
      options: { signal: AbortSignal; onStatus?: (task: TaskStatus) => void },
    ) => {
      for (const value of progress) options.onStatus?.(status(value));
      if (outcome instanceof Error) throw outcome;
      return {} as IndexTaskResult;
    },
  );
  return { join };
}

function deps(overrides: Partial<SamplesWaitDeps> = {}): SamplesWaitDeps {
  return { polls: polls([]), supportsIndexBuild: () => true, ...overrides };
}

describe('samplesAfterIndexBuild', () => {
  it('returns the lines of a request the backend answers at once, without polling', async () => {
    const request = answers(LINES);
    const wait = deps();
    await expect(samplesAfterIndexBuild(PATH, request, {}, wait)).resolves.toBe(SAMPLES);
    expect(wait.polls.join).not.toHaveBeenCalled();
  });

  it('follows the build a 202 names, reports its progress and asks again', async () => {
    const request = answers(building('t1'), LINES);
    const wait = deps({ polls: polls([null, 0.25, 0.9]) });
    const seen: (IndexBuild | null)[] = [];

    const samples = await samplesAfterIndexBuild(
      PATH,
      request,
      { onIndexBuild: (build) => seen.push(build) },
      wait,
    );

    expect(samples).toBe(SAMPLES);
    expect(request).toHaveBeenCalledTimes(2);
    expect(wait.polls.join).toHaveBeenCalledWith(PATH, 't1', expect.anything());
    expect(seen).toEqual([
      { taskId: 't1', progress: null },
      { taskId: 't1', progress: null },
      { taskId: 't1', progress: 0.25 },
      { taskId: 't1', progress: 0.9 },
      null,
    ]);
  });

  it('asks again after a build that failed, which the backend answers without an index', async () => {
    const request = answers(building(), LINES);
    const wait = deps({ polls: polls([], new Error('build index: disk full')) });
    await expect(samplesAfterIndexBuild(PATH, request, {}, wait)).resolves.toBe(SAMPLES);
  });

  it('refuses a 202 from a backend whose contract does not have the index build', async () => {
    const request = answers(building());
    const wait = deps({ supportsIndexBuild: () => false });
    await expect(samplesAfterIndexBuild(PATH, request, {}, wait)).rejects.toThrow(/202/);
    expect(wait.polls.join).not.toHaveBeenCalled();
  });

  it('gives up when the file is still being indexed after several builds', async () => {
    const request = vi.fn(async () => building());
    await expect(samplesAfterIndexBuild(PATH, request, {}, deps())).rejects.toThrow(
      /still being built/,
    );
  });

  it('stops with an AbortError when the caller aborts while the build runs', async () => {
    const controller = new AbortController();
    const join = vi.fn(async (_p: string, _t: string, options: { signal: AbortSignal }) => {
      controller.abort();
      options.signal.throwIfAborted();
      return {} as IndexTaskResult;
    });
    const request = answers(building(), LINES);
    const error = await samplesAfterIndexBuild(
      PATH,
      request,
      { signal: controller.signal },
      deps({ polls: { join } }),
    ).catch((e: unknown) => e);
    expect(isAbortError(error)).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe('indexBuildLabel', () => {
  it.each([
    [{ taskId: 't', progress: null }, 'Building the line index…'],
    [{ taskId: 't', progress: 0 }, 'Building the line index… 0%'],
    [{ taskId: 't', progress: 0.427 }, 'Building the line index… 42%'],
    [{ taskId: 't', progress: 1 }, 'Building the line index… 100%'],
  ])('labels %o as %s', (build, label) => {
    expect(indexBuildLabel(build)).toBe(label);
  });
});

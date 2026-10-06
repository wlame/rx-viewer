import type { IndexBuild, IndexTaskResult, TaskStatus } from './types';
import { isAbortError } from './utils/latestRequest';
import type { TaskPolls } from './utils/taskPolling';

/**
 * Following, in the background, the line index build a samples answer
 * named (`index_build`) while the file's lines already show.
 *
 * One build is followed per file. An answer that names the task already
 * followed changes nothing; one that names another task leaves the
 * older one. The task is polled through the app's shared `TaskPolls`,
 * so a load that waits for the same task, or an Index from the tree,
 * joins the same poll.
 */

/** What a followed build reports, each to the file it builds for. */
export interface FollowCallbacks {
  /** The build as it runs: at once with no progress, then at each status. */
  onStatus: (build: IndexBuild) => void;
  /** The index the build made. */
  onBuilt: (index: IndexTaskResult) => void;
  /** The build failed, or its task cannot be followed any more. */
  onFailed: (error: unknown) => void;
}

interface Follow {
  taskId: string;
  controller: AbortController;
}

export class IndexBuildFollows {
  private follows = new Map<string, Follow>();

  constructor(private readonly polls: Pick<TaskPolls, 'join'>) {}

  /** The task followed for `path`, or null when none is. */
  followedTask(path: string): string | null {
    return this.follows.get(path)?.taskId ?? null;
  }

  /** Follow the build `taskId` of `path` until it ends or `stop` is called. */
  follow(path: string, taskId: string, callbacks: FollowCallbacks): void {
    if (this.followedTask(path) === taskId) return;
    this.stop(path);

    const follow: Follow = { taskId, controller: new AbortController() };
    this.follows.set(path, follow);
    callbacks.onStatus({ taskId, progress: null });

    const isCurrent = () => this.follows.get(path) === follow;
    this.polls
      .join(path, taskId, {
        signal: follow.controller.signal,
        onStatus: (task: TaskStatus) => {
          if (isCurrent()) callbacks.onStatus({ taskId, progress: task.progress });
        },
      })
      .then(
        (index) => {
          if (!isCurrent()) return;
          this.follows.delete(path);
          callbacks.onBuilt(index);
        },
        (error: unknown) => {
          // A stopped follow reports nothing: its file is closed or follows another build.
          if (!isCurrent() || isAbortError(error)) return;
          this.follows.delete(path);
          callbacks.onFailed(error);
        },
      );
  }

  /** Stop following the build of `path`; the backend's build runs on. */
  stop(path: string): void {
    this.follows.get(path)?.controller.abort();
    this.follows.delete(path);
  }
}

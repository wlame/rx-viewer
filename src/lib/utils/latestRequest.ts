/**
 * Keeps the newest request the winner.
 *
 * The bug this exists to prevent: the stores key their updates on a file
 * path alone, so two overlapping loads for the same file both apply, in
 * arrival order rather than in request order. Jump to line 1,000,000 and
 * then to line 5, and if the first response lands second the editor ends
 * on the window nobody asked for. The same shape affects scroll-driven
 * loads and repeated searches.
 *
 * Two things are needed and both live here, so no caller has to remember
 * half of the pattern:
 *
 * - the superseded request is aborted, so the browser stops work nobody
 *   is waiting for;
 * - if it answers anyway — an abort is not instant, and a response can
 *   already be in flight — its result is reported as SUPERSEDED so the
 *   caller skips it.
 */

/** Returned instead of a result when a newer request has taken over. */
export const SUPERSEDED = Symbol('superseded');

/** True for the error `fetch` throws when its signal is aborted. */
export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

/**
 * One slot: at most one request is current, and only its result counts.
 *
 * ```ts
 * const result = await latest.run((signal) => api.getSamples(path, ranges, { signal }));
 * if (result === SUPERSEDED) return;
 * ```
 */
export class LatestRequest {
  private controller: AbortController | null = null;
  private seq = 0;

  /**
   * Run `fn` as the current request, cancelling any in flight.
   *
   * Resolves with `fn`'s value, or SUPERSEDED if another `run` started
   * before this one finished. A failure of the *current* request is
   * rethrown; a failure of a superseded one is swallowed, because by
   * then nobody is waiting for its answer.
   */
  async run<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T | typeof SUPERSEDED> {
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const mySeq = ++this.seq;

    try {
      const value = await fn(controller.signal);
      return mySeq === this.seq ? value : SUPERSEDED;
    } catch (error) {
      if (mySeq !== this.seq) return SUPERSEDED;
      throw error;
    } finally {
      if (mySeq === this.seq) this.controller = null;
    }
  }

  /** Cancel whatever is in flight without starting anything. */
  abort(): void {
    this.controller?.abort();
    this.controller = null;
    this.seq++;
  }
}

/**
 * A LatestRequest per key, for state that is per open file rather than
 * global — loading one file must not cancel another.
 */
export class LatestRequestMap {
  private slots = new Map<string, LatestRequest>();

  /** How many keys are being tracked. Used by tests and by leak checks. */
  get size(): number {
    return this.slots.size;
  }

  /** Run `fn` as the current request for `key`. */
  run<T>(key: string, fn: (signal: AbortSignal) => Promise<T>): Promise<T | typeof SUPERSEDED> {
    let slot = this.slots.get(key);
    if (!slot) {
      slot = new LatestRequest();
      this.slots.set(key, slot);
    }
    return slot.run(fn);
  }

  /** Cancel and drop a key — call it when a file is closed. */
  forget(key: string): void {
    this.slots.get(key)?.abort();
    this.slots.delete(key);
  }
}

import { describe, it, expect, vi } from 'vitest';
import { LatestRequest, LatestRequestMap, SUPERSEDED, isAbortError } from './latestRequest';

/** A promise this test resolves by hand, to control arrival order. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('LatestRequest', () => {
  it('returns the result when nothing supersedes it', async () => {
    const latest = new LatestRequest();
    await expect(latest.run(async () => 'only')).resolves.toBe('only');
  });

  it('reports the earlier call as superseded when a later one starts', async () => {
    const latest = new LatestRequest();
    const first = deferred<string>();
    const second = deferred<string>();

    const a = latest.run(() => first.promise);
    const b = latest.run(() => second.promise);

    // The first response arrives last — the case that corrupts state.
    second.resolve('second');
    first.resolve('first');

    expect(await a).toBe(SUPERSEDED);
    expect(await b).toBe('second');
  });

  it('resolves the later call even when the earlier one arrives first', async () => {
    const latest = new LatestRequest();
    const first = deferred<string>();
    const second = deferred<string>();

    const a = latest.run(() => first.promise);
    const b = latest.run(() => second.promise);

    first.resolve('first');
    second.resolve('second');

    expect(await a).toBe(SUPERSEDED);
    expect(await b).toBe('second');
  });

  it('aborts the signal it gave the previous call', async () => {
    const latest = new LatestRequest();
    let firstSignal: AbortSignal | undefined;

    const a = latest.run((signal) => {
      firstSignal = signal;
      return deferred<string>().promise;
    });
    expect(firstSignal!.aborted).toBe(false);

    const b = latest.run(async () => 'second');
    expect(firstSignal!.aborted).toBe(true);

    expect(await b).toBe('second');
    void a;
  });

  it('gives each call a signal that is not already aborted', async () => {
    const latest = new LatestRequest();
    await latest.run(async (signal) => {
      expect(signal.aborted).toBe(false);
      return 1;
    });
    await latest.run(async (signal) => {
      expect(signal.aborted).toBe(false);
      return 2;
    });
  });

  it('swallows the abort error of a superseded call', async () => {
    const latest = new LatestRequest();
    const first = deferred<string>();

    const a = latest.run(() => first.promise);
    const b = latest.run(async () => 'second');

    first.reject(new DOMException('The operation was aborted.', 'AbortError'));

    await expect(a).resolves.toBe(SUPERSEDED);
    await expect(b).resolves.toBe('second');
  });

  it('still surfaces a real failure of the current call', async () => {
    const latest = new LatestRequest();
    await expect(latest.run(async () => Promise.reject(new Error('500')))).rejects.toThrow('500');
  });

  it('abort() cancels an in-flight call without starting one', async () => {
    const latest = new LatestRequest();
    let signal: AbortSignal | undefined;
    const a = latest.run((s) => {
      signal = s;
      return deferred<string>().promise;
    });

    latest.abort();
    expect(signal!.aborted).toBe(true);
    void a;
  });
});

describe('LatestRequestMap', () => {
  it('keeps separate keys independent', async () => {
    const map = new LatestRequestMap();
    const a = deferred<string>();
    const b = deferred<string>();

    const first = map.run('/a.log', () => a.promise);
    const second = map.run('/b.log', () => b.promise);

    b.resolve('b');
    a.resolve('a');

    expect(await first).toBe('a');
    expect(await second).toBe('b');
  });

  it('supersedes within one key', async () => {
    const map = new LatestRequestMap();
    const first = deferred<string>();

    const a = map.run('/a.log', () => first.promise);
    const b = map.run('/a.log', async () => 'newer');

    first.resolve('older');

    expect(await a).toBe(SUPERSEDED);
    expect(await b).toBe('newer');
  });

  it('forget() drops a key so a closed file leaks nothing', async () => {
    const map = new LatestRequestMap();
    let signal: AbortSignal | undefined;
    const a = map.run('/a.log', (s) => {
      signal = s;
      return deferred<string>().promise;
    });

    map.forget('/a.log');
    expect(signal!.aborted).toBe(true);
    expect(map.size).toBe(0);
    void a;
  });
});

describe('isAbortError', () => {
  it('recognises the DOMException fetch throws', () => {
    expect(isAbortError(new DOMException('aborted', 'AbortError'))).toBe(true);
  });

  it('recognises a plain error named AbortError', () => {
    const e = new Error('aborted');
    e.name = 'AbortError';
    expect(isAbortError(e)).toBe(true);
  });

  it.each([new Error('network down'), 'a string', null, undefined])(
    'does not mistake %s for an abort',
    (value) => {
      expect(isAbortError(value)).toBe(false);
    },
  );
});

describe('notifications', () => {
  it('an aborted request is not something to tell the user about', () => {
    // The store contract: callers check isAbortError before notifying.
    const notify = vi.fn();
    const error = new DOMException('aborted', 'AbortError');
    if (!isAbortError(error)) notify(error);
    expect(notify).not.toHaveBeenCalled();
  });
});

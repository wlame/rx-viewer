import { get, writable } from 'svelte/store';
import type { TimeCursor, TimeQuery } from '../utils/timeCursor';

/**
 * The time cursor shared by the open tabs, or null when none is set.
 * `files` sets it on an explicit jump by time and moves each tab to it
 * when the tab is shown (`utils/timeCursor.ts` holds the rule); the
 * timeline bar draws it and clears it.
 */
function createTimeCursorStore() {
  const store = writable<TimeCursor | null>(null);
  /** The version of the last cursor set; it only grows, also across a clear. */
  let lastVersion = 0;

  /** Set the cursor to `query`, as a new version every time, and return it. */
  function set(query: TimeQuery): TimeCursor {
    lastVersion += 1;
    const cursor: TimeCursor = {
      query,
      version: lastVersion,
      instantMs: typeof query === 'number' ? query : null,
    };
    store.set(cursor);
    return cursor;
  }

  /** Give a typed cursor the instant it found, unless a newer cursor replaced it. */
  function resolve(version: number, instantMs: number) {
    store.update((cursor) =>
      cursor && cursor.version === version && cursor.instantMs === null
        ? { ...cursor, instantMs }
        : cursor,
    );
  }

  /** The version a place reached now answers: the cursor's, or 0 with none set. */
  function currentVersion(): number {
    return get(store)?.version ?? 0;
  }

  return {
    subscribe: store.subscribe,
    set,
    resolve,
    currentVersion,
    clear: () => store.set(null),
  };
}

export const timeCursor = createTimeCursorStore();

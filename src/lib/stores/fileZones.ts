import { get, writable } from 'svelte/store';
import {
  fileZoneOf,
  isFileZone,
  normalizeFileZones,
  withFileZone,
  withoutFileZone,
  type FileZone,
} from '../utils/fileZones';
import type { TabKey } from '../utils/tabKey';
import { backendHas } from './health';

/**
 * The time zone chosen for each file and chain, by tab key, oldest choice
 * first: the file's
 * timestamps are read as wall clock in that zone. The zone control before
 * the timeline sets and resets it; the URL's `ftz` holds it, so a reload
 * or a link keeps it, also for files that are not open. Back and Forward
 * leave it as it is.
 */
function createFileZonesStore() {
  const store = writable<readonly FileZone[]>([]);

  return {
    subscribe: store.subscribe,
    /**
     * Read the file or chain of the tab key `key` in `zone`. Returns
     * false, and changes nothing, for a value that is not a zone and when
     * every tab holding a zone is open and no more fit (`isOpen` tells
     * which are).
     */
    set(key: TabKey, zone: string, isOpen: (key: TabKey) => boolean): boolean {
      if (!isFileZone(zone)) return false;
      const next = withFileZone(get(store), key, zone, isOpen);
      if (next === null) return false;
      store.set(next);
      return true;
    },
    /** Read the file or chain of `key` as its lines write times again. */
    clear: (key: TabKey) => store.update((zones) => withoutFileZone(zones, key)),
    /** The zone chosen for `key`, or null. */
    zoneOf: (key: TabKey) => fileZoneOf(get(store), key),
    /** Make the store hold `entries`: valid ones, a key once, at most the limit. */
    replace: (entries: readonly FileZone[]) => store.set(normalizeFileZones(entries)),
  };
}

export const fileZones = createFileZonesStore();

/**
 * The `file_tz` a request for the tab key `key` sends: its chosen zone
 * when the backend lists `file_tz`, otherwise none. Ask it after the
 * contract gate opened, when the backend's features are known.
 */
export function requestZoneOf(key: TabKey): string | undefined {
  if (!backendHas('file_tz')) return undefined;
  return fileZones.zoneOf(key) ?? undefined;
}

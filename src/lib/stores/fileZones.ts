import { get, writable } from 'svelte/store';
import {
  fileZoneOf,
  isFileZone,
  normalizeFileZones,
  withFileZone,
  withoutFileZone,
  type FileZone,
} from '../utils/fileZones';
import { backendHas } from './health';

/**
 * The time zone chosen for each file, oldest choice first: the file's
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
     * Read `path` in `zone`. Returns false, and changes nothing, for a
     * value that is not a zone and when every file holding a zone is open
     * and no more fit (`isOpen` tells which are).
     */
    set(path: string, zone: string, isOpen: (path: string) => boolean): boolean {
      if (!isFileZone(zone)) return false;
      const next = withFileZone(get(store), path, zone, isOpen);
      if (next === null) return false;
      store.set(next);
      return true;
    },
    /** Read `path` as its lines write times again. */
    clear: (path: string) => store.update((zones) => withoutFileZone(zones, path)),
    /** The zone chosen for `path`, or null. */
    zoneOf: (path: string) => fileZoneOf(get(store), path),
    /** Make the store hold `entries`: valid ones, a file once, at most the limit. */
    replace: (entries: readonly FileZone[]) => store.set(normalizeFileZones(entries)),
  };
}

export const fileZones = createFileZonesStore();

/**
 * The `file_tz` a request for `path` sends: its chosen zone when the
 * backend lists `file_tz`, otherwise none. Ask it after the contract gate
 * opened, when the backend's features are known.
 */
export function requestZoneOf(path: string): string | undefined {
  if (!backendHas('file_tz')) return undefined;
  return fileZones.zoneOf(path) ?? undefined;
}

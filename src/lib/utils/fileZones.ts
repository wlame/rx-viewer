/**
 * The time zones a user chose for files and log chains: each one's
 * timestamps are then read as wall clock in its zone, whatever zone its
 * lines write (the backend's `file_tz`).
 *
 * A zone is `UTC`, an IANA name this browser knows, or a fixed offset
 * `±HH:MM` up to 18 hours, the values rx-go accepts. The choices are
 * kept per tab key (`utils/tabKey.ts`: a file's path, or `chain:` and a
 * chain's handle), oldest first, for at most `MAX_FILE_ZONES` of them,
 * including files that are not open, so a file opened again reads its
 * times in the zone chosen before. A chain and the file at its handle
 * keep a zone each. The URL holds them as repeated `ftz=<zone>@<key>`.
 *
 * Everything here is pure: the store (`stores/fileZones.ts`) and the
 * URL's `ftz` (`urlState.ts`) are built on it.
 */

import type { TabKey } from './tabKey';

/** The zone chosen for one file or chain. */
export interface FileZone {
  /** The tab key of the file or chain: a file's path, or `chain:` and the handle. */
  path: TabKey;
  zone: string;
}

/** The most files that keep a chosen zone. */
export const MAX_FILE_ZONES = 20;

/** What a person reads when a zone cannot be kept because every file holding one is open. */
export const FILE_ZONES_FULL = `A zone is kept for at most ${MAX_FILE_ZONES} files, and each of them is open: reset the zone of one first`;

/** The zones the picker lists before anything is typed. */
export const COMMON_ZONES: readonly string[] = [
  'UTC',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Moscow',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'Asia/Kolkata',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Australia/Sydney',
];

/** How many zones the picker lists for a query. */
export const MATCHING_ZONES_LIMIT = 50;

/** The longest zone value rx-go looks up; longer ones it refuses. */
const MAX_ZONE_LENGTH = 64;

/** The largest fixed offset, in hours, rx-go accepts. */
const MAX_OFFSET_HOURS = 18;

/** A fixed offset as rx-go reads one: a sign and two digits in each field. */
const FIXED_OFFSET = /^[+-](\d{2}):(\d{2})$/;

/** What separates the zone from the key in an `ftz` value; a zone never holds one. */
const PARAM_SEPARATOR = '@';

/** Whether `value` is a fixed offset `±HH:MM` of at most 18 hours. */
export function isFixedOffset(value: string): boolean {
  const match = FIXED_OFFSET.exec(value);
  if (!match) return false;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return (
    minutes <= 59 && (hours < MAX_OFFSET_HOURS || (hours === MAX_OFFSET_HOURS && minutes === 0))
  );
}

/** The IANA names this browser lists, or none when it lists none. */
function browserZoneNames(): readonly string[] {
  const intl = Intl as { supportedValuesOf?: (key: string) => string[] };
  if (typeof intl.supportedValuesOf !== 'function') return [];
  try {
    return intl.supportedValuesOf('timeZone');
  } catch {
    return [];
  }
}

let knownNames: ReadonlySet<string> | null = null;

/** Every zone name the picker offers and a link may name: UTC, the common zones and the browser's. */
export function zoneNames(): readonly string[] {
  return [...knownZoneNames()];
}

function knownZoneNames(): ReadonlySet<string> {
  knownNames ??= new Set(['UTC', ...COMMON_ZONES, ...browserZoneNames()]);
  return knownNames;
}

/**
 * Whether `value` is a zone a file can be read in: a fixed offset, or a
 * name the picker offers, written exactly so. A name in another case is
 * refused: rx-go looks names up case-sensitively on most hosts.
 */
export function isFileZone(value: string): boolean {
  if (value.length === 0 || value.length > MAX_ZONE_LENGTH) return false;
  return isFixedOffset(value) || knownZoneNames().has(value);
}

/** What the picker lists for a query: the matching names, and a typed offset to use. */
export interface ZoneMatches {
  zones: string[];
  offset: string | null;
}

/**
 * The zones the picker lists for `query`: the common zones for an empty
 * one; the typed offset alone for an offset; otherwise the names that
 * hold the query, without case and with a space matching `_`, at most
 * `limit` of them in the order of `names`.
 */
export function matchingZones(
  names: readonly string[],
  query: string,
  limit = MATCHING_ZONES_LIMIT,
): ZoneMatches {
  const typed = query.trim();
  if (typed === '') return { zones: [...COMMON_ZONES], offset: null };
  if (/^[+-]/.test(typed)) return { zones: [], offset: isFixedOffset(typed) ? typed : null };
  const needle = typed.toLowerCase().replace(/\s+/g, '_');
  return {
    zones: names.filter((name) => name.toLowerCase().includes(needle)).slice(0, limit),
    offset: null,
  };
}

/** The zone chosen for the tab key `key`, or null when none is. */
export function fileZoneOf(zones: readonly FileZone[], key: TabKey): string | null {
  return zones.find((z) => z.path === key)?.zone ?? null;
}

/**
 * The zones with the tab key `key` read in `zone`: a key they hold keeps
 * its place, a new one goes last. Past the limit the oldest key whose tab
 * is not open makes room; when every tab they hold is open, the new one
 * is refused (null).
 */
export function withFileZone(
  zones: readonly FileZone[],
  key: TabKey,
  zone: string,
  isOpen: (key: TabKey) => boolean,
): FileZone[] | null {
  if (zones.some((z) => z.path === key)) {
    return zones.map((z) => (z.path === key ? { path: key, zone } : z));
  }
  if (zones.length < MAX_FILE_ZONES) return [...zones, { path: key, zone }];
  const evicted = zones.findIndex((z) => !isOpen(z.path));
  if (evicted < 0) return null;
  return [...zones.slice(0, evicted), ...zones.slice(evicted + 1), { path: key, zone }];
}

/** The zones without the one chosen for the tab key `key`. */
export function withoutFileZone(zones: readonly FileZone[], key: TabKey): FileZone[] {
  return zones.filter((z) => z.path !== key);
}

/**
 * Zones from any list: a valid zone and a key each, the first entry of a
 * key that is named twice, and the first `MAX_FILE_ZONES` of them.
 */
export function normalizeFileZones(entries: readonly FileZone[]): FileZone[] {
  const kept: FileZone[] = [];
  for (const entry of entries) {
    if (kept.length === MAX_FILE_ZONES) break;
    if (entry.path === '' || !isFileZone(entry.zone)) continue;
    if (kept.some((z) => z.path === entry.path)) continue;
    kept.push({ path: entry.path, zone: entry.zone });
  }
  return kept;
}

/**
 * The file zone an `ftz` value names, split on its first `@` (a path or
 * a handle may hold one, a zone never does), or null when it names no
 * valid zone and key.
 */
export function parseFileZoneParam(value: string): FileZone | null {
  const at = value.indexOf(PARAM_SEPARATOR);
  if (at < 0) return null;
  const zone = value.slice(0, at);
  const path = value.slice(at + 1);
  if (path === '' || !isFileZone(zone)) return null;
  return { path, zone };
}

/** The `ftz` value of one file zone. */
export function serializeFileZoneParam(fileZone: FileZone): string {
  return `${fileZone.zone}${PARAM_SEPARATOR}${fileZone.path}`;
}

import type { OpenFile } from '../types';
import { hasTimeFormat } from './timeline';

/**
 * A time to jump to: an instant (UTC ms), sent as RFC 3339 with ms and
 * `Z`, or a text the backend reads as `--timestamps` does, sent as is.
 */
export type TimeQuery = number | string;

/**
 * The time cursor every open tab shares: the target of the last explicit
 * jump by time (the timeline bar, its box or a link's `time`).
 */
export interface TimeCursor {
  /** What the jump asked for; a tab that follows the cursor asks the same. */
  query: TimeQuery;
  /** Larger for every cursor set later; a tab compares it with its own. */
  version: number;
  /**
   * Where the cursor is on the time axis: the query for an instant; for a
   * typed text, the time of the line it found in the file it was typed
   * for, and null until that is known.
   */
  instantMs: number | null;
}

/** What the rule needs to know of an open file. */
export type CursorFollower = Pick<OpenFile, 'path' | 'cursorVersion' | 'timeRange'>;

/**
 * Whether a file moves to the cursor now: it is the file the editor
 * shows, it has timestamps (its time range is known and names a format),
 * and the cursor is newer than its place. A file's place answers every
 * cursor up to `cursorVersion`: the one it jumped to, or the one set
 * when the user last moved it by line.
 */
export function followsCursor(
  file: CursorFollower,
  cursor: TimeCursor | null,
  activePath: string | null,
): boolean {
  if (cursor === null || file.path !== activePath) return false;
  return cursor.version > file.cursorVersion && hasTimeFormat(file);
}

import type { OpenFile } from '../types';
import { hasTimeFormat, sideOfAxis, timelineAxis, type TimeAxis } from './timeline';

/**
 * The timestamps stash: up to seven moments a user saved from the time
 * cursor, kept as UTC instants in ms, unique to the millisecond and in
 * time order. An instant belongs to no file; each file shows it in its
 * own layout and can jump to it when the instant is inside its range.
 *
 * Everything here is pure: the store (`stores/timeStash.ts`) and the
 * URL's `stash` (`urlState.ts`) are built on it.
 */

/** The most moments the stash keeps. */
export const STASH_CAPACITY = 7;

/** What an add did: the instant went in, the stash held it already, or it was full. */
export type StashAddOutcome = 'added' | 'duplicate' | 'full';

/** What the time cursor's `+` does. */
export const STASH_ADD_LABEL = 'Add the time cursor to the stash';

/** What a person reads when an instant cannot be added, by the reason. */
export const STASH_REFUSALS: Record<Exclude<StashAddOutcome, 'added'>, string> = {
  duplicate: 'The stash holds this time already',
  full: `The stash is full: it keeps ${STASH_CAPACITY} moments. Remove one to add another`,
};

/** Whether the stash holds as many moments as it keeps. */
export function isStashFull(stash: readonly number[]): boolean {
  return stash.length >= STASH_CAPACITY;
}

/** Why an instant cannot be added, or null when it can. */
export function stashAddRefusal(
  stash: readonly number[],
  instantMs: number,
): Exclude<StashAddOutcome, 'added'> | null {
  if (stash.includes(instantMs)) return 'duplicate';
  if (isStashFull(stash)) return 'full';
  return null;
}

/** The stash with `instantMs` in its place in time, or as it was with the reason it stayed. */
export function addToStash(
  stash: readonly number[],
  instantMs: number,
): { outcome: StashAddOutcome; stash: readonly number[] } {
  const refusal = stashAddRefusal(stash, instantMs);
  if (refusal !== null) return { outcome: refusal, stash };
  return { outcome: 'added', stash: [...stash, instantMs].sort((a, b) => a - b) };
}

/** The stash without `instantMs`. */
export function removeFromStash(stash: readonly number[], instantMs: number): number[] {
  return stash.filter((ms) => ms !== instantMs);
}

/**
 * A stash made of any list of instants: whole milliseconds only, each
 * once, in time order, and the earliest `STASH_CAPACITY` of them.
 */
export function normalizeStash(instants: readonly number[]): number[] {
  const unique = new Set(instants.filter((ms) => Number.isSafeInteger(ms)));
  return [...unique].sort((a, b) => a - b).slice(0, STASH_CAPACITY);
}

/** What the stash needs to know of the file a jump would move. */
export type StashFile = Pick<OpenFile, 'name' | 'timeRange'>;

/** Whether an entry can jump the active file, and why not when it cannot. */
export type StashEntryState = { isEnabled: true } | { isEnabled: false; reason: string };

/** What the rules below read about one entry and the active file. */
interface EntryContext {
  instantMs: number;
  file: StashFile | undefined;
  name: string;
  canJump: boolean;
  axis: TimeAxis | null;
}

/**
 * The reasons an entry is disabled, in the order they are asked; the
 * first that applies is the tooltip. An entry no row disables is
 * enabled. A range's first and last times are inside it.
 */
const DISABLED_WHEN: readonly {
  applies: (entry: EntryContext) => boolean;
  reason: (entry: EntryContext) => string;
}[] = [
  { applies: (e) => e.file === undefined, reason: () => 'Open a file to go to this time' },
  { applies: (e) => !e.canJump, reason: () => 'The backend cannot jump to a time' },
  {
    applies: (e) => e.file?.timeRange === null,
    reason: (e) => `The time range of ${e.name} is not known yet`,
  },
  { applies: (e) => !hasTimeFormat(e.file), reason: (e) => `${e.name} has no timestamps` },
  {
    applies: (e) => e.axis === null,
    reason: (e) => `The time range of ${e.name} is not known yet`,
  },
  {
    applies: (e) => e.axis !== null && sideOfAxis(e.instantMs, e.axis) === 'before',
    reason: (e) => `Before the first time in ${e.name}`,
  },
  {
    applies: (e) => e.axis !== null && sideOfAxis(e.instantMs, e.axis) === 'after',
    reason: (e) => `After the last time in ${e.name}`,
  },
];

/**
 * Whether the entry at `instantMs` can jump `file`, the active file: the
 * backend answers time queries and the instant is inside the file's
 * range. Otherwise the entry is disabled, with the reason.
 */
export function stashEntryState(
  instantMs: number,
  file: StashFile | undefined,
  canJump: boolean,
): StashEntryState {
  const entry: EntryContext = {
    instantMs,
    file,
    name: file?.name ?? '',
    canJump,
    axis: timelineAxis(file),
  };
  const rule = DISABLED_WHEN.find((row) => row.applies(entry));
  return rule ? { isEnabled: false, reason: rule.reason(entry) } : { isEnabled: true };
}

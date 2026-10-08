/**
 * How the parts of a log chain changed between two of its descriptions:
 * the one a tab held and the one the backend sent with a 409, after a
 * rotation renamed, compressed, added or removed files.
 *
 * A description names each part's file but gives no device or inode, so
 * the same file under a new name is found from what a rename and a
 * compression keep: the size and the modification time (a rename keeps
 * both, `gzip` keeps the time), the first timestamp when both
 * descriptions know it, and for the active file, which the rotation
 * renamed after it last grew, the newest frozen part written no earlier
 * than it. Each rule pairs only parts the rules before it left alone.
 *
 * Pure, so it is tested without a backend.
 */
import type { ChainPart } from '../types';

/** What changed between two part lists, and where each old part's file is now. */
export interface PartChanges {
  /** Files that kept their text under a new name, in the old list's order. */
  renamed: { from: string; to: string }[];
  /** Parts no old part became, in the new list's order. */
  added: string[];
  /** Old parts that no new part is, in the old list's order. */
  removed: string[];
  /** Frozen parts written in place: the same name, another size or time. */
  changed: string[];
  /** Each old part that is still there, by its old name, to its name now. */
  nameMap: ReadonlyMap<string, string>;
}

/** One rule that knows an old part in the new list: which new parts to try first, and the test. */
interface SameFileRule {
  /** Whether the same name under this rule means the file did not change. */
  isUnchanged: boolean;
  /** Try the newest new part first (the end of the list) rather than the oldest. */
  isNewestFirst: boolean;
  isSameFile: (before: ChainPart, after: ChainPart) => boolean;
}

/** The rules, in the order they pair parts. */
const SAME_FILE_RULES: readonly SameFileRule[] = [
  // A rename keeps the size and the modification time.
  {
    isUnchanged: true,
    isNewestFirst: false,
    isSameFile: (a, b) => a.size === b.size && a.modified_at === b.modified_at,
  },
  // A compression into another encoding keeps the modification time.
  {
    isUnchanged: false,
    isNewestFirst: false,
    isSameFile: (a, b) =>
      a.modified_at === b.modified_at && a.compression_format !== b.compression_format,
  },
  // Both descriptions know the first timestamp, which no rename changes.
  {
    isUnchanged: false,
    isNewestFirst: false,
    isSameFile: (a, b) => a.first_ms !== null && a.first_ms === b.first_ms,
  },
  // The active file, renamed to the newest frozen part after it grew.
  {
    isUnchanged: false,
    isNewestFirst: true,
    isSameFile: (a, b) => a.is_active && !b.is_active && b.modified_at >= a.modified_at,
  },
  // A frozen part written in place keeps its name.
  { isUnchanged: false, isNewestFirst: false, isSameFile: (a, b) => a.name === b.name },
];

/** An old part's pair in the new list, and whether the rule that paired them says it is unchanged. */
interface Pair {
  after: ChainPart;
  isUnchanged: boolean;
}

/**
 * Compare the parts a tab held (`before`) with the parts the chain has
 * now (`after`). Each new part is paired with one old part at most.
 */
export function compareParts(
  before: readonly ChainPart[],
  after: readonly ChainPart[],
): PartChanges {
  const pairs = new Map<ChainPart, Pair>();
  const taken = new Set<ChainPart>();
  for (const rule of SAME_FILE_RULES) {
    const candidates = rule.isNewestFirst ? [...after].reverse() : after;
    for (const old of before) {
      if (pairs.has(old)) continue;
      const found = candidates.find((part) => !taken.has(part) && rule.isSameFile(old, part));
      if (found === undefined) continue;
      pairs.set(old, { after: found, isUnchanged: rule.isUnchanged });
      taken.add(found);
    }
  }

  const changes: PartChanges = {
    renamed: [],
    added: after.filter((part) => !taken.has(part)).map((part) => part.name),
    removed: [],
    changed: [],
    nameMap: new Map(),
  };
  const nameMap = new Map<string, string>();
  for (const old of before) {
    const pair = pairs.get(old);
    if (pair === undefined) {
      changes.removed.push(old.name);
      continue;
    }
    nameMap.set(old.name, pair.after.name);
    if (old.name !== pair.after.name) {
      changes.renamed.push({ from: old.name, to: pair.after.name });
    } else if (!pair.isUnchanged && !(old.is_active && pair.after.is_active)) {
      changes.changed.push(old.name);
    }
  }
  return { ...changes, nameMap };
}

/** The words of each kind of change in a notice, in the order it names them. */
const CHANGE_WORDS: readonly [string, (changes: PartChanges) => number][] = [
  ['renamed', (changes) => changes.renamed.length],
  ['new', (changes) => changes.added.length],
  ['removed', (changes) => changes.removed.length],
  ['changed', (changes) => changes.changed.length],
];

/**
 * The notice a chain's tab shows after its files changed on disk:
 * "Files of syslog changed on disk (renamed 2, new 1, removed 1); chain
 * reloaded", with each kind that happened; without the counts when the
 * tab held no description to compare with, or found no difference.
 */
export function changeNotice(name: string, changes: PartChanges | null): string {
  const counts = changes
    ? CHANGE_WORDS.map(([word, count]) => [word, count(changes)] as const).filter(([, n]) => n > 0)
    : [];
  const detail = counts.length > 0 ? ` (${counts.map(([w, n]) => `${w} ${n}`).join(', ')})` : '';
  return `Files of ${name} changed on disk${detail}; chain reloaded`;
}

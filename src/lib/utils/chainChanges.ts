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

/**
 * One rule that knows an old part in the new list by a key: each new part
 * the rules before left alone is filed under its key, and an old part
 * looks under its lookup keys for the first of them in the new list's
 * order. A key lookup keeps each rule linear in the parts.
 */
interface KeyedRule {
  /** Whether the same name under this rule means the file did not change. */
  isUnchanged: boolean;
  /** The key a new part is filed under; null files it under none. */
  fileKey: (part: ChainPart) => string | null;
  /** The keys an old part looks under, given the compression formats of the new parts. */
  lookups: (part: ChainPart, formats: readonly string[]) => string[];
}

/** A part's compression format as a key: the empty text for a plain part. */
function formatKey(part: ChainPart): string {
  return part.compression_format ?? '';
}

/** A rename keeps the size and the modification time. */
const SAME_STAT: KeyedRule = {
  isUnchanged: true,
  fileKey: (part) => `${part.size}|${part.modified_at}`,
  lookups: (part) => [`${part.size}|${part.modified_at}`],
};

/** A compression into another encoding keeps the modification time. */
const COMPRESSED_COPY: KeyedRule = {
  isUnchanged: false,
  fileKey: (part) => `${part.modified_at}|${formatKey(part)}`,
  lookups: (part, formats) =>
    formats.filter((format) => format !== formatKey(part)).map((f) => `${part.modified_at}|${f}`),
};

/** Both descriptions know the first timestamp, which no rename changes. */
const SAME_FIRST_TIME: KeyedRule = {
  isUnchanged: false,
  fileKey: (part) => (part.first_ms === null ? null : String(part.first_ms)),
  lookups: (part) => (part.first_ms === null ? [] : [String(part.first_ms)]),
};

/** A frozen part written in place keeps its name. */
const SAME_NAME: KeyedRule = {
  isUnchanged: false,
  fileKey: (part) => part.name,
  lookups: (part) => [part.name],
};

/** An old part's pair in the new list, and whether the rule that paired them says it is unchanged. */
interface Pair {
  after: ChainPart;
  isUnchanged: boolean;
}

/** The pairs found so far, and the new parts they took. */
interface Pairing {
  pairs: Map<ChainPart, Pair>;
  taken: Set<ChainPart>;
}

/** The new parts filed under one key, in the new list's order, from the first not taken yet. */
interface Queue {
  places: number[];
  head: number;
}

/** Pair the old parts the rules before left alone by `rule`, each with one new part at most. */
function pairByKey(
  rule: KeyedRule,
  before: readonly ChainPart[],
  after: readonly ChainPart[],
  { pairs, taken }: Pairing,
): void {
  const formats = [...new Set(after.map(formatKey))];
  const queues = new Map<string, Queue>();
  after.forEach((part, place) => {
    const key = taken.has(part) ? null : rule.fileKey(part);
    if (key === null) return;
    const queue = queues.get(key) ?? { places: [], head: 0 };
    queue.places.push(place);
    queues.set(key, queue);
  });
  const firstFree = (queue: Queue): number | null => {
    while (queue.head < queue.places.length && taken.has(after[queue.places[queue.head]])) {
      queue.head += 1;
    }
    return queue.head < queue.places.length ? queue.places[queue.head] : null;
  };
  for (const old of before) {
    if (pairs.has(old)) continue;
    let found: number | null = null;
    for (const key of rule.lookups(old, formats)) {
      const queue = queues.get(key);
      const place = queue ? firstFree(queue) : null;
      if (place !== null && (found === null || place < found)) found = place;
    }
    if (found === null) continue;
    pairs.set(old, { after: after[found], isUnchanged: rule.isUnchanged });
    taken.add(after[found]);
  }
}

/**
 * Pair the active file the rules before left alone with the newest
 * frozen part written no earlier than it: the rotation renamed it after
 * it last grew. A description has one active part.
 */
function pairRenamedActive(
  before: readonly ChainPart[],
  after: readonly ChainPart[],
  { pairs, taken }: Pairing,
): void {
  const active = before.find((part) => part.is_active && !pairs.has(part));
  if (active === undefined) return;
  for (let place = after.length - 1; place >= 0; place--) {
    const part = after[place];
    if (taken.has(part) || part.is_active) continue;
    if (part.modified_at < active.modified_at) continue;
    pairs.set(active, { after: part, isUnchanged: false });
    taken.add(part);
    return;
  }
}

/** The passes that pair parts, in order: each pairs only parts the passes before left alone. */
const SAME_FILE_PASSES: readonly ((
  before: readonly ChainPart[],
  after: readonly ChainPart[],
  pairing: Pairing,
) => void)[] = [
  (before, after, pairing) => pairByKey(SAME_STAT, before, after, pairing),
  (before, after, pairing) => pairByKey(COMPRESSED_COPY, before, after, pairing),
  (before, after, pairing) => pairByKey(SAME_FIRST_TIME, before, after, pairing),
  pairRenamedActive,
  (before, after, pairing) => pairByKey(SAME_NAME, before, after, pairing),
];

/**
 * Compare the parts a tab held (`before`) with the parts the chain has
 * now (`after`). Each new part is paired with one old part at most. Each
 * pass reads each list once, plus a lookup per old part and compression
 * format of the new parts.
 */
export function compareParts(
  before: readonly ChainPart[],
  after: readonly ChainPart[],
): PartChanges {
  const pairing: Pairing = { pairs: new Map(), taken: new Set() };
  for (const pass of SAME_FILE_PASSES) pass(before, after, pairing);
  const { pairs, taken } = pairing;

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

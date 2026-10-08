/**
 * What turning chain mode on or off does to the open tabs, worked out
 * from what they hold.
 *
 * Off: a chain's tab becomes the file tab of the part that holds its
 * anchor line, at that line of the part. On: each file tab of a chain's
 * part becomes that chain's tab at the same line; several tabs of one
 * chain become one, at the active tab when it is one of them, else at
 * the first. A file is a chain's part when its directory's chain listing
 * names it among the chain's parts, the active file included; another
 * encoding of a part is no part. The search marks follow the tab.
 *
 * Pure, so it is tested without a backend.
 */
import type { ChainEntry, ChainTab, FileMatch } from '../types';
import { isEmptyPart } from './chainParts';
import { isChainKey, type TabKey } from './tabKey';

/** The directory that holds `path`: `/logs` for `/logs/app.log`, `/` for `/app.log`. */
export function directoryOf(path: string): string {
  return path.slice(0, path.lastIndexOf('/')) || '/';
}

/** The last element of a path. */
export function nameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** The path of the part `part` of the chain whose handle is `handle`. */
export function partPath(handle: string, part: string): string {
  const dir = directoryOf(handle);
  return dir === '/' ? `/${part}` : `${dir}/${part}`;
}

/** The chain among `chains` that lists the file named `name` among its parts, or null. */
export function chainHolding(chains: readonly ChainEntry[], name: string): ChainEntry | null {
  return chains.find((chain) => chain.parts.includes(name)) ?? null;
}

/** File tabs that become one chain's tab, and the one whose line it opens at. */
export interface ChainMerge {
  handle: string;
  /** The tab whose anchor line the chain's tab opens at. */
  lead: TabKey;
  /** The name of the lead tab's file: the part the chain's tab opens in. */
  part: string;
  /** Every file tab of the chain's parts, in tab order, the lead among them. */
  members: TabKey[];
}

/**
 * The chains the open file tabs `keys` (in tab order) are parts of, by
 * the chain listings of their directories (`chainsByDir`; a directory
 * not listed holds no chain). Chain tabs are left out.
 */
export function planChainMerges(
  keys: readonly TabKey[],
  chainsByDir: ReadonlyMap<string, readonly ChainEntry[]>,
  activeKey: TabKey | null,
): ChainMerge[] {
  const merges = new Map<string, ChainMerge>();
  for (const key of keys) {
    if (isChainKey(key)) continue;
    const chain = chainHolding(chainsByDir.get(directoryOf(key)) ?? [], nameOf(key));
    if (chain === null) continue;
    const merge = merges.get(chain.path);
    if (merge === undefined) {
      merges.set(chain.path, { handle: chain.path, lead: key, part: nameOf(key), members: [key] });
      continue;
    }
    merge.members.push(key);
    if (key === activeKey) {
      merge.lead = key;
      merge.part = nameOf(key);
    }
  }
  return [...merges.values()];
}

/**
 * Where a chain's tab goes as a file tab: the part that holds its anchor
 * line, at its line in that part; a tab with no anchor yet, at line 1 of
 * the first part with lines its description lists. Null for a tab that
 * knows no part yet.
 */
export function fileTargetOfChainTab(tab: {
  path: TabKey;
  chain?: Pick<ChainTab, 'handle' | 'anchor' | 'description'>;
}): { path: string; line: number } | null {
  const chain = tab.chain;
  if (!chain) return null;
  if (chain.anchor !== null) {
    return { path: partPath(chain.handle, chain.anchor.part), line: chain.anchor.line };
  }
  const first = chain.description?.parts.find((part) => !isEmptyPart(part));
  return first ? { path: partPath(chain.handle, first.name), line: 1 } : null;
}

/** The marks of a chain's tab in the part `part`, as the marks of that part's file tab. */
export function fileMatchesOfPart(marks: readonly FileMatch[], part: string): FileMatch[] {
  return marks.filter((mark) => mark.part === part).map(({ part: _part, ...mark }) => mark);
}

/** The marks of the file tab of the part `part`, as its chain's tab marks them. */
export function chainMatchesOfFile(marks: readonly FileMatch[], part: string): FileMatch[] {
  return marks.map((mark) => ({ ...mark, part }));
}

/**
 * Turning chain mode on or off, with what it does to the open tabs, so
 * the same line stays in view (`utils/chainSwitch.ts` works out which tab
 * becomes which).
 *
 * Off: each log chain's tab becomes the file tab of the part that holds
 * its anchor line, at that line of the part, and the files panel reveals
 * and selects that part. On: each file tab of a chain's part becomes the
 * chain's tab at the same line; the tabs of one chain become one. A chain
 * that is not valid keeps its parts as file tabs, since its tab would show
 * no line. A tab that turns into another keeps its place in the tab row,
 * its zone, highlighting, filter, word wrap, invisible characters and
 * search marks, and the active tab stays active.
 *
 * The switch in the files panel and Back and Forward (`viewState.ts`)
 * both switch through here. While tabs turn over, the view's URL
 * rewrites its entry: a switch is no step Back undoes.
 */
import { get } from 'svelte/store';
import { api } from '../api';
import { contractGate } from '../contractGate';
import type { ChainEntry, ChainPart, FileMatch, OpenFile } from '../types';
import {
  chainHolding,
  chainMatchesOfFile,
  directoryOf,
  fileMatchesOfPart,
  fileTargetOfChainTab,
  nameOf,
  planChainMerges,
  type ChainMerge,
} from '../utils/chainSwitch';
import { chainKey, isChainKey, type TabKey } from '../utils/tabKey';
import { chainMode } from './chainMode';
import type { ChainPosition } from './chainTabs';
import { fileZones } from './fileZones';
import { files } from './files';
import { backendHas } from './health';
import { notifications } from './notifications';
import { tree } from './tree';

/** How long a notice of the switch stays on screen. */
const NOTICE_MS = 5000;

/** Switches turning tabs over now. */
let turningTabs = 0;

/** Bumped by every switch, so an older one still waiting for answers stops. */
let switchGeneration = 0;

/** Whether a switch is turning tabs over now: the view's URL rewrites its entry meanwhile. */
export function isTurningTabs(): boolean {
  return turningTabs > 0;
}

/**
 * Turn chain mode on or off, and turn the open tabs over to match. The
 * mode is set first: a chain's tab opens only while the mode is on.
 * Resolves once every tab that turned over has its lines.
 */
export async function switchChainMode(on: boolean): Promise<void> {
  if (get(chainMode) === on) return;
  const generation = ++switchGeneration;
  chainMode.set(on);
  if (on) await turnPartsIntoChains(generation);
  else await turnChainsIntoFiles();
}

/**
 * The handle of the chain whose part `path` is, when chain mode can show
 * it: the backend serves log chains, the directory's chain listing names
 * the file as a part, and the chain is valid. Null otherwise.
 */
export async function chainOfFile(path: string): Promise<string | null> {
  await contractGate.pass();
  if (!backendHas('log_chains')) return null;
  const chain = chainHolding((await listChains(directoryOf(path))) ?? [], nameOf(path));
  if (chain === null) return null;
  return (await isReadable(chain)) ? chain.path : null;
}

/** Give the tab `to` the zone chosen for `from`, unless it has one of its own. */
export function carryZone(from: TabKey, to: TabKey): void {
  const zone = fileZones.zoneOf(from);
  if (zone === null || fileZones.zoneOf(to) !== null) return;
  fileZones.set(to, zone, (key) => get(files).openFiles.some((f) => f.path === key));
}

/** The chains of a directory, or null when they cannot be listed (its files then stay files). */
async function listChains(dir: string): Promise<readonly ChainEntry[] | null> {
  try {
    return (await api.logChains(dir)).chains;
  } catch (error) {
    console.debug('The log chains of a directory could not be listed:', dir, error);
    return null;
  }
}

/**
 * Whether the chain can be shown as one text: its description is not
 * invalid. An invalid chain says so in a notice; a chain that cannot be
 * described is not shown either.
 */
async function isReadable(chain: ChainEntry): Promise<boolean> {
  try {
    const answer = await api.logChain(chain.path);
    if (answer.chain.state !== 'invalid') return true;
    const codes = answer.chain.reasons.map((reason) => reason.code).join(', ');
    notifications.info(
      `${chain.name} is not a valid log chain${codes ? ` (${codes})` : ''}; its files stay open as files`,
      NOTICE_MS,
    );
  } catch (error) {
    console.debug('The log chain could not be described:', chain.path, error);
  }
  return false;
}

/** Run `turn`, which opens and closes tabs, as one change of the view that rewrites its entry. */
function turnTabs(turn: () => void): void {
  turningTabs += 1;
  try {
    turn();
  } finally {
    turningTabs -= 1;
  }
}

/** Where the tab `key` is in the tab row, or -1. */
function placeOf(key: TabKey): number {
  return get(files).openFiles.findIndex((f) => f.path === key);
}

/** Move the tab `key`, just opened at the end of the row, to `place`. */
function moveTo(key: TabKey, place: number): void {
  const from = placeOf(key);
  if (from >= 0 && place >= 0 && from !== place) files.reorderFiles(from, place);
}

/** Give the tab `to` the filter, word wrap and invisible characters of the tab `from`. */
function carryViewOptions(from: OpenFile, to: TabKey): void {
  const filter = from.regexFilter;
  if (filter?.enabled && filter.pattern.trim() !== '') {
    files.setRegexFilter(to, { pattern: filter.pattern, mode: filter.mode });
  }
  if (from.wordWrap) files.toggleWordWrap(to);
  if (from.showInvisibleChars) files.toggleInvisibleChars(to);
}

/** The part of a chain's tab the part's file tab takes its size and compression from. */
function partOf(tab: OpenFile, name: string): ChainPart | undefined {
  return tab.chain?.description?.parts.find((part) => part.name === name);
}

/**
 * Turn each chain's tab into the file tab of the part that holds its
 * anchor line, at that line, and reveal the active one's part in the
 * files panel.
 */
async function turnChainsIntoFiles(): Promise<void> {
  const before = get(files);
  const chainTabs = before.openFiles.filter((f) => isChainKey(f.path));
  if (chainTabs.length === 0) return;
  const loads: Promise<unknown>[] = [];
  let active = before.activeFilePath;
  let revealed: string | null = null;

  turnTabs(() => {
    for (const tab of chainTabs) {
      const path = turnChainIntoFile(tab, tab.path === before.activeFilePath, loads);
      if (tab.path === before.activeFilePath) active = path;
      revealed ??= path;
      if (tab.path === before.activeFilePath && path !== null) revealed = path;
    }
    if (active !== null) files.setActiveFile(active);
  });

  if (revealed !== null) loads.push(tree.expandToPath(revealed));
  await Promise.all(loads);
}

/**
 * Turn one chain's tab into its part's file tab and return the file's
 * path; null when the tab knows no part yet, and closes. A part already
 * open as a file keeps its tab, moved to the line when the chain's tab
 * was the active one.
 */
function turnChainIntoFile(
  tab: OpenFile,
  isActive: boolean,
  loads: Promise<unknown>[],
): string | null {
  const target = fileTargetOfChainTab(tab);
  if (target === null) {
    files.closeFile(tab.path);
    notifications.info(`${tab.name} showed no line of a part yet; its tab is closed`, NOTICE_MS);
    return null;
  }
  const { path, line } = target;
  const name = nameOf(path);
  const marks = fileMatchesOfPart(get(files).matches.get(tab.path) ?? [], name);
  if (placeOf(path) >= 0) {
    files.closeFile(tab.path);
    if (isActive) loads.push(files.jumpToLine(path, line));
    return path;
  }
  carryZone(tab.path, path);
  const part = partOf(tab, name);
  const place = placeOf(tab.path);
  // openFile puts the tab in the store before its first await.
  loads.push(
    files.openFile(path, {
      scrollToLine: line,
      syntaxHighlighting: tab.syntaxHighlighting,
      fileSize: part?.size ?? null,
      isIndexed: part?.is_indexed,
      lineCount: part?.line_count ?? undefined,
      compressionFormat: part?.compression_format ?? null,
    }),
  );
  moveTo(path, place);
  carryViewOptions(tab, path);
  if (marks.length > 0) files.setMatches(path, marks);
  files.closeFile(tab.path);
  return path;
}

/**
 * Turn the file tabs of each valid chain's parts into the chain's tab,
 * from the chain listings of their directories.
 */
async function turnPartsIntoChains(generation: number): Promise<void> {
  const fileTabs = get(files).openFiles.filter((f) => !isChainKey(f.path));
  if (fileTabs.length === 0) return;
  await contractGate.pass();
  if (!backendHas('log_chains')) return;

  const dirs = [...new Set(fileTabs.map((f) => directoryOf(f.path)))];
  const listings = await Promise.all(dirs.map(listChains));
  const chainsByDir = new Map(dirs.map((dir, i) => [dir, listings[i] ?? []]));
  const planned = planChainMerges(
    fileTabs.map((f) => f.path),
    chainsByDir,
    get(files).activeFilePath,
  );
  const entries = [...chainsByDir.values()].flat();
  const readable = await Promise.all(
    planned.map((merge) => {
      const entry = entries.find((chain) => chain.path === merge.handle);
      return entry ? isReadable(entry) : Promise.resolve(false);
    }),
  );
  if (generation !== switchGeneration) return;
  const shown = new Set(planned.filter((_, i) => readable[i]).map((merge) => merge.handle));

  // The tabs as they are now: one may have closed or become active meanwhile.
  const before = get(files);
  const merges = planChainMerges(
    before.openFiles.map((f) => f.path),
    chainsByDir,
    before.activeFilePath,
  ).filter((merge) => shown.has(merge.handle));
  if (merges.length === 0) return;
  const loads: Promise<unknown>[] = [];
  let active = before.activeFilePath;

  turnTabs(() => {
    for (const merge of merges) {
      turnFilesIntoChain(merge, loads);
      if (active !== null && merge.members.includes(active)) active = chainKey(merge.handle);
    }
    if (active !== null) files.setActiveFile(active);
  });
  await Promise.all(loads);
}

/** The time of the line the tab is anchored on, or null when it has none or the tab does not hold it. */
function anchorTimeOf(tab: OpenFile): number | null {
  const line = tab.lines[tab.anchorLine - tab.startLine];
  return line?.lineNumber === tab.anchorLine ? (line.timestampMs ?? null) : null;
}

/**
 * Turn the file tabs of one chain's parts into the chain's tab, in the
 * place of the first of them, at the line of the lead one in its part.
 */
function turnFilesIntoChain(merge: ChainMerge, loads: Promise<unknown>[]): void {
  const state = get(files);
  const members = merge.members
    .map((key) => state.openFiles.find((f) => f.path === key))
    .filter((tab): tab is OpenFile => tab !== undefined);
  const lead = members.find((tab) => tab.path === merge.lead);
  if (lead === undefined) return;
  const key = chainKey(merge.handle);
  const position: ChainPosition = {
    kind: 'local',
    part: merge.part,
    line: lead.anchorLine,
    timeMs: anchorTimeOf(lead),
  };
  const marks: FileMatch[] = members.flatMap((tab) =>
    chainMatchesOfFile(state.matches.get(tab.path) ?? [], nameOf(tab.path)),
  );
  const place = Math.min(...members.map((tab) => placeOf(tab.path)));

  if (placeOf(key) < 0) {
    carryZone(lead.path, key);
    // openChain puts the tab in the store before its first await.
    loads.push(
      files.openChain(merge.handle, { position, syntaxHighlighting: lead.syntaxHighlighting }),
    );
    moveTo(key, place);
    carryViewOptions(lead, key);
  } else {
    loads.push(files.goToChainLine(key, position));
  }
  if (marks.length > 0) files.setMatches(key, marks);
  for (const tab of members) files.closeFile(tab.path);
}

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
 * no line. A tab that turns into another keeps its place in the tab row
 * and in the order the tabs were used in, its zone, the highlighting
 * chosen for it, its filter, word wrap, invisible characters and search
 * marks, and the active tab stays active.
 *
 * Neither way shows another file's line in silence after a rotation.
 * Off: each chain's tab describes its chain with its fingerprint first
 * and finds its line again in the renamed file; a file tab that then
 * reads other text at the line says so. On: the chain's tab checks it
 * shows the lead file tab's text at its line, and else looks for the line
 * by its time and text (`stores/chainTabs.ts`).
 *
 * The switch in the files panel and Back and Forward (`viewState.ts`)
 * both switch through here. While tabs turn over, the view's URL
 * rewrites its entry: a switch is no step Back undoes.
 */
import { get } from 'svelte/store';
import { api } from '../api';
import { contractGate } from '../contractGate';
import type { ChainEntry, ChainPart, FileLine, FileMatch, OpenFile } from '../types';
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
import { defaultSyntaxHighlighting } from '../utils/highlighting';
import { fileLineNotice, knownInZone, type KnownLine } from '../utils/knownLine';
import { chainKey, isChainKey, type TabKey } from '../utils/tabKey';
import { replaceInRecent, type TabReplacement } from '../utils/tabOrder';
import { chainMode } from './chainMode';
import type { ChainPosition, LineToFind } from './chainTabs';
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

/** The last switch: one that finds the mode already set ends with it. */
let lastSwitch: Promise<void> = Promise.resolve();

/** Whether a switch is turning tabs over now: the view's URL rewrites its entry meanwhile. */
export function isTurningTabs(): boolean {
  return turningTabs > 0;
}

/**
 * Turn chain mode on or off, and turn the open tabs over to match. The
 * mode is set first: a chain's tab opens only while the mode is on.
 * Resolves once every tab that turned over has its lines. A switch to
 * the mode already set resolves when the switch that set it ends, so
 * what its caller does next (a restore opening its own tab) comes after
 * that switch turned the tabs over, and is not undone by it.
 */
export function switchChainMode(on: boolean): Promise<void> {
  if (get(chainMode) === on) return lastSwitch;
  const generation = ++switchGeneration;
  chainMode.set(on);
  lastSwitch = on ? turnPartsIntoChains(generation) : turnChainsIntoFiles(generation);
  return lastSwitch;
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

/** What turning the tabs over did: which tabs became which, and the tab to show after it. */
interface TabTurn {
  replacements: TabReplacement[];
  /** The tab the active one became; null when the active tab closed. */
  active: TabKey | null;
}

/**
 * Run `turn`, which opens and closes tabs, as one change of the view
 * that rewrites its entry. Each tab that replaced others then takes their
 * place in the order the tabs were used in, which the opening and closing
 * inside `turn` disturbed, and the tab the active one became is shown;
 * when the active tab closed, the most recently used open tab is.
 */
function turnTabs(turn: () => TabTurn): void {
  const recentBefore = get(files).recentTabs;
  turningTabs += 1;
  try {
    const { replacements, active } = turn();
    const order = replaceInRecent(recentBefore, replacements);
    const isOpen = (key: TabKey) => placeOf(key) >= 0;
    const shown = active ?? order.find(isOpen) ?? null;
    if (shown !== null) files.setActiveFile(shown);
    files.setRecentOrder(order);
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

/**
 * The highlighting chosen for a tab, which the tab it turns into keeps;
 * undefined while the tab has its size's default, so the other tab takes
 * the default of its own size.
 */
function chosenHighlighting(tab: OpenFile): boolean | undefined {
  const isDefault = tab.syntaxHighlighting === defaultSyntaxHighlighting(tab.fileSize);
  return isDefault ? undefined : tab.syntaxHighlighting;
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
 * files panel. Each tab first describes its chain with its fingerprint:
 * after a rotation it has not seen, its line is in a renamed file, which
 * it finds again before it turns over.
 */
async function turnChainsIntoFiles(generation: number): Promise<void> {
  const keys = get(files)
    .openFiles.filter((f) => isChainKey(f.path))
    .map((f) => f.path);
  if (keys.length === 0) return;
  const lines = await Promise.all(keys.map((key) => files.settleChain(key)));
  if (generation !== switchGeneration) return;
  const lineOf = new Map(keys.map((key, i) => [key, lines[i]]));

  // The tabs as they are now: a chain that is no chain any more already became its part's file tab.
  const before = get(files);
  const chainTabs = before.openFiles.filter((f) => isChainKey(f.path));
  const loads: Promise<unknown>[] = [];
  let active = before.activeFilePath;
  let revealed: string | null = null;

  turnTabs(() => {
    const replacements: TabReplacement[] = [];
    for (const tab of chainTabs) {
      const isActive = tab.path === before.activeFilePath;
      const known = lineOf.get(tab.path) ?? { text: null, timeMs: null };
      const path = turnChainIntoFile(tab, isActive, loads, known);
      if (path !== null) replacements.push({ from: [tab.path], to: path });
      if (isActive) active = path;
      revealed ??= path;
      if (isActive && path !== null) revealed = path;
    }
    return { replacements, active };
  });

  if (revealed !== null) loads.push(tree.expandToPath(revealed));
  await Promise.all(loads);
}

/**
 * Turn one chain's tab into its part's file tab and return the file's
 * path; null when the tab knows no part yet, and closes. A part already
 * open as a file keeps its tab, moved to the line when the chain's tab
 * was the active one. `known` is what the chain's tab knew of its anchor
 * line, which the file tab is checked against once it reads the line.
 */
function turnChainIntoFile(
  tab: OpenFile,
  isActive: boolean,
  loads: Promise<unknown>[],
  known: KnownLine,
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
  const zone = fileZones.zoneOf(tab.path);
  const check = () => checkFileLine({ path, line, known, zone, chainName: tab.name, marks });
  if (placeOf(path) >= 0) {
    files.closeFile(tab.path);
    if (isActive) loads.push(files.jumpToLine(path, line).then(check));
    return path;
  }
  carryZone(tab.path, path);
  const part = partOf(tab, name);
  const place = placeOf(tab.path);
  // openFile puts the tab in the store before its first await.
  loads.push(
    files
      .openFile(path, {
        scrollToLine: line,
        syntaxHighlighting: chosenHighlighting(tab),
        fileSize: part?.size ?? null,
        isIndexed: part?.is_indexed,
        lineCount: part?.line_count ?? undefined,
        compressionFormat: part?.compression_format ?? null,
      })
      .then(check),
  );
  moveTo(path, place);
  carryViewOptions(tab, path);
  if (marks.length > 0) files.setMatches(path, marks);
  files.closeFile(tab.path);
  return path;
}

/** A file tab a chain's tab turned into, with what the chain's tab knew of its line. */
interface TurnedFile {
  path: string;
  line: number;
  /** The text and time of the line the chain's tab showed there, each null when it did not know it. */
  known: KnownLine;
  /** The zone the chain's tab read that time in. */
  zone: string | null;
  chainName: string;
  /** The search marks carried into the file tab. */
  marks: FileMatch[];
}

/**
 * Say so when a file tab a chain's tab turned into shows another line at
 * its line than the chain's tab showed, or holds no such line: the file
 * changed on disk while the mode switched (`fileLineNotice`). A time read
 * in another zone than the file tab's is not compared. The marks carried
 * with it are dropped then.
 */
function checkFileLine({ path, line, known, zone, chainName, marks }: TurnedFile): void {
  const tab = get(files).openFiles.find((f) => f.path === path);
  const comparable = knownInZone(known, zone, fileZones.zoneOf(path));
  const notice = fileLineNotice(tab, line, comparable, chainName);
  if (notice === null) return;
  const dropsMarks = marks.length > 0 && get(files).matches.get(path) === marks;
  if (dropsMarks) files.setMatches(path, []);
  notifications.info(`${notice}${dropsMarks ? '; search again' : ''}`, NOTICE_MS);
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
    const replacements: TabReplacement[] = [];
    for (const merge of merges) {
      const key = chainKey(merge.handle);
      if (turnFilesIntoChain(merge, loads)) replacements.push({ from: merge.members, to: key });
      if (active !== null && merge.members.includes(active)) active = key;
    }
    return { replacements, active };
  });
  await Promise.all(loads);
}

/** The line the tab is anchored on, or null when the tab does not hold it. */
function anchorLineOf(tab: OpenFile): FileLine | null {
  const line = tab.lines[tab.anchorLine - tab.startLine];
  return line?.lineNumber === tab.anchorLine ? line : null;
}

/**
 * Turn the file tabs of one chain's parts into the chain's tab, in the
 * place of the first of them, at the line of the lead one in its part.
 * A file tab sends no fingerprint, so the chain's tab checks it shows the
 * lead's line there (`files.confirmChainLine`): after a rotation it looks
 * for it by its time and text. The lead's search marks are carried only
 * when the line is where the lead had it; the other tabs' marks, whose
 * lines are not checked, are not carried. Returns whether the tabs
 * turned over: not when the lead's tab closed meanwhile.
 */
function turnFilesIntoChain(merge: ChainMerge, loads: Promise<unknown>[]): boolean {
  const state = get(files);
  const members = merge.members
    .map((key) => state.openFiles.find((f) => f.path === key))
    .filter((tab): tab is OpenFile => tab !== undefined);
  const lead = members.find((tab) => tab.path === merge.lead);
  if (lead === undefined) return false;
  const key = chainKey(merge.handle);
  const isChainOpen = placeOf(key) >= 0;
  if (!isChainOpen) carryZone(lead.path, key);
  const shown = anchorLineOf(lead);
  // The lead's time names the line only in the zone the chain is read in.
  const known = knownInZone(
    { text: shown?.content ?? null, timeMs: shown?.timestampMs ?? null },
    fileZones.zoneOf(lead.path),
    fileZones.zoneOf(key),
  );
  const position: ChainPosition = {
    kind: 'local',
    part: merge.part,
    line: lead.anchorLine,
    timeMs: known.timeMs,
  };
  const leadLine: LineToFind = {
    what: `the line ${merge.part} showed at line ${lead.anchorLine}`,
    text: known.text,
    timeMs: known.timeMs,
  };
  const marks = chainMatchesOfFile(state.matches.get(lead.path) ?? [], merge.part);
  const othersMarked = members.some(
    (tab) => tab !== lead && (state.matches.get(tab.path)?.length ?? 0) > 0,
  );
  const place = Math.min(...members.map((tab) => placeOf(tab.path)));
  const name = nameOf(merge.handle);

  let opened: Promise<unknown>;
  if (!isChainOpen) {
    // openChain puts the tab in the store before its first await.
    opened = files.openChain(merge.handle, {
      position,
      syntaxHighlighting: chosenHighlighting(lead),
    });
    moveTo(key, place);
    carryViewOptions(lead, key);
  } else {
    opened = files.goToChainLine(key, position);
  }
  loads.push(opened.then(() => keepMarksOfShownLine(key, leadLine, marks, name)));
  if (marks.length > 0) files.setMatches(key, marks);
  if (othersMarked) {
    notifications.info(
      `Only the search marks of ${merge.part} are carried into ${name}; search again for the others`,
      NOTICE_MS,
    );
  }
  for (const tab of members) files.closeFile(tab.path);
  return true;
}

/**
 * Drop the marks carried into the chain's tab `key` unless it shows the
 * line they came with where that file tab had it: otherwise they name
 * lines of a file that took the old name.
 */
async function keepMarksOfShownLine(
  key: TabKey,
  line: LineToFind,
  marks: FileMatch[],
  name: string,
): Promise<void> {
  const isInPlace = await files.confirmChainLine(key, line);
  if (isInPlace || marks.length === 0 || get(files).matches.get(key) !== marks) return;
  files.setMatches(key, []);
  notifications.info(
    `The search marks carried into ${name} are dropped: its files changed since the search; search again`,
    NOTICE_MS,
  );
}

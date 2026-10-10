/**
 * Every keyboard shortcut and mouse gesture of the viewer, in one table.
 *
 * The key handlers ask this table whether a key press is theirs, and the
 * help dialog lists the same rows, so the two cannot disagree. A row
 * with a `chord` is a key press; its label in the help is built from the
 * chord. A row with a `gesture` is a mouse action, listed for help only.
 */
import { belongsToInputMethod, type CompositionState } from './keyTargets';
import { SEARCH_TOGGLES, type SearchToggles } from './searchToggles';

/** Where a shortcut works, in the order the help dialog lists them. */
export const SHORTCUT_SCOPES = {
  anywhere: 'Anywhere',
  panels: 'Panels, from anywhere',
  activityBar: 'In the activity bar',
  filesPanel: 'In the files panel, while it is shown',
  valueSwitch: 'On the Size/Date switch',
  fileTree: 'In the file tree',
  searchPanel: 'In the search panel',
  searchField: 'In a search pattern field or the max box',
  tabStrip: 'On the open-file tabs',
  filePane: 'In the open file',
  gotoField: 'In the go-to-line box',
  filterField: 'In the editor filter field',
  timeline: 'On the timeline bar',
  zonePicker: "In the picker of a file's time zone",
  openPanel: 'While a panel is open',
} as const;

export type ShortcutScope = keyof typeof SHORTCUT_SCOPES;

/**
 * A key press as data. `key` compares `KeyboardEvent.key` without case;
 * `code` compares `KeyboardEvent.code`, for a key whose character a
 * modifier changes (Alt+C types "ç" on a Mac). `mod` is Cmd on a Mac and
 * Ctrl elsewhere. `mod` and `alt` must match exactly; `shift` is checked
 * only when it is set, because some characters (":") need it.
 */
export interface KeyChord {
  key?: string;
  code?: string;
  mod?: boolean;
  alt?: boolean;
  shift?: boolean;
}

/** The shortcuts the window-wide handler acts on. */
export type GlobalShortcutId =
  'focusSearch' | 'showFiles' | 'showSearch' | 'toggleSidebar' | 'showShortcuts' | 'closeDialog';

/**
 * The shortcuts of the files panel, which act while it is shown. An id is
 * matched only when the handler is given an action for it, so the
 * toolbar and the column header each handle the keys of their own
 * controls.
 */
export type FilesPanelShortcutId =
  'toggleChainMode' | 'toggleLabels' | 'switchValue' | 'sortByName' | 'sortByValue';

/** The key of each search toggle: `toggle:matchCase` and so on. */
export type SearchToggleShortcutId = `toggle:${keyof SearchToggles}`;

/**
 * The shortcuts of the search panel, which act wherever the focus is
 * inside it. An id is matched only when the handler is given an action
 * for it.
 */
export type SearchPanelShortcutId = SearchToggleShortcutId | 'toggleOnlyOpened';

/**
 * The keys of the file tree. Its key handler hands those with a chord to
 * its key rules (`utils/treeNav.ts`); `treeTypeName` is any letter typed.
 */
export type TreeShortcutId =
  | 'treeMove'
  | 'treeOpenFolder'
  | 'treeCloseFolder'
  | 'treeEnds'
  | 'treePage'
  | 'openTreeItem'
  | 'treeTypeName'
  | 'treeToEditor';

/** The keys of the tab strip, which act on the focused tab. */
export type TabStripShortcutId = 'tabStripMove' | 'tabStripEnds' | 'tabStripClose';

export type ShortcutId =
  | GlobalShortcutId
  | FilesPanelShortcutId
  | 'activityBarMove'
  | 'valueSwitchMove'
  | SearchPanelShortcutId
  | 'runSearch'
  | TabStripShortcutId
  | 'gotoLine'
  | 'gotoJump'
  | 'gotoClose'
  | 'findInEditor'
  | 'nextAnomaly'
  | 'applyFilter'
  | 'closeFilter'
  | TreeShortcutId
  | 'timelineStep'
  | 'timelineBigStep'
  | 'timelineEnds'
  | 'timelineJump'
  | 'timelineCancel'
  | 'timelineScrub'
  | 'zoneMove'
  | 'zoneChoose'
  | 'zoneClose'
  | 'closeHistory'
  | 'closeAnalysis'
  | 'closeChainParts';

export interface Shortcut {
  id: ShortcutId;
  scope: ShortcutScope;
  description: string;
  chord?: KeyChord;
  /** Further key presses that do the same, listed after `chord`. */
  otherChords?: readonly KeyChord[];
  /** The label of a mouse gesture, or of a key the editor itself handles. */
  gesture?: string;
}

/** The modifier labels, as the help shows them on every platform. */
const MOD_LABEL = '⌘/Ctrl';

/** The help's name for a key whose `KeyboardEvent.key` reads badly or not at all. */
const KEY_LABELS: Readonly<Record<string, string>> = {
  Escape: 'Esc',
  ' ': 'Space',
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowDown: '↓',
  ArrowUp: '↑',
};

/** The prefix of a `KeyboardEvent.code` before the letter or digit it names (`KeyG`, `Digit1`). */
const CODE_PREFIX = /^(Key|Digit)/;

/** The name of a chord's key without its modifiers: `G` for `KeyG`, `1` for `Digit1`, `Esc`. */
function keyName(chord: KeyChord): string {
  const key = chord.key ?? chord.code?.replace(CODE_PREFIX, '') ?? '';
  return KEY_LABELS[key] ?? (key.length === 1 ? key.toUpperCase() : key);
}

/** The help dialog's label for a key press. */
export function chordLabel(chord: KeyChord): string {
  const parts: string[] = [];
  if (chord.mod) parts.push(MOD_LABEL);
  if (chord.alt) parts.push('Alt');
  if (chord.shift) parts.push('Shift');
  parts.push(keyName(chord));
  return parts.join('+');
}

/** Whose key names a label uses: a Mac's symbols, or the words other keyboards print. */
export type Platform = 'mac' | 'other';

/** An Apple system, whose keyboards print ⌘, ⌥ and ⇧. An iPad may report itself as a Mac. */
const APPLE_SYSTEM = /Mac|iPhone|iPad|iPod/;

/**
 * The platform whose key names to show, from the browser's navigator
 * unless one is given. Without a navigator it is `other`.
 */
export function detectPlatform(
  nav: { platform?: string; userAgent?: string } | undefined = typeof navigator === 'undefined'
    ? undefined
    : navigator,
): Platform {
  if (!nav) return 'other';
  const isApple = APPLE_SYSTEM.test(nav.platform ?? '') || APPLE_SYSTEM.test(nav.userAgent ?? '');
  return isApple ? 'mac' : 'other';
}

/** The modifiers a chord can hold, in the order a label names them. */
const MODIFIERS = ['mod', 'alt', 'shift'] as const;

/** Each platform's name for each modifier. */
const MODIFIER_NAMES: Readonly<Record<Platform, Record<(typeof MODIFIERS)[number], string>>> = {
  mac: { mod: '⌘', alt: '⌥', shift: '⇧' },
  other: { mod: 'Ctrl', alt: 'Alt', shift: 'Shift' },
};

/**
 * The keys of a chord as `platform` names them, the key itself last:
 * `['⌥', 'G']` on a Mac, `['Alt', 'G']` elsewhere. A modifier set to
 * `false` must stay up, so it is not named.
 */
export function chordKeys(chord: KeyChord, platform: Platform): string[] {
  const names = MODIFIER_NAMES[platform];
  const pressed = MODIFIERS.filter((modifier) => chord[modifier]);
  return [...pressed.map((modifier) => names[modifier]), keyName(chord)];
}

/** Every key press of a row, its main chord first. */
function chordsOf(shortcut: Shortcut): KeyChord[] {
  return shortcut.chord ? [shortcut.chord, ...(shortcut.otherChords ?? [])] : [];
}

/** The label of any row: its chords', or its gesture. */
export function shortcutLabel(shortcut: Shortcut): string {
  const chords = chordsOf(shortcut);
  return chords.length > 0 ? chords.map(chordLabel).join(' or ') : (shortcut.gesture ?? '');
}

/** The parts of a KeyboardEvent a chord is matched against. */
export interface KeyPress extends CompositionState {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/**
 * Whether `event` is the key press `chord` describes. A key press an
 * input method is composing with is no chord: it belongs to the
 * composition.
 */
export function matchesChord(chord: KeyChord, event: KeyPress): boolean {
  if (belongsToInputMethod(event)) return false;
  if (chord.key !== undefined && event.key.toLowerCase() !== chord.key.toLowerCase()) return false;
  if (chord.code !== undefined && event.code !== chord.code) return false;
  if ((event.metaKey || event.ctrlKey) !== Boolean(chord.mod)) return false;
  if (event.altKey !== Boolean(chord.alt)) return false;
  if (chord.shift !== undefined && event.shiftKey !== chord.shift) return false;
  return true;
}

export const SHORTCUTS: readonly Shortcut[] = [
  {
    id: 'focusSearch',
    scope: 'anywhere',
    description: 'Go to the search pattern field',
    chord: { key: 'k', mod: true },
  },
  {
    id: 'toggleSidebar',
    scope: 'anywhere',
    description: 'Show or hide the sidebar',
    chord: { key: 'b', mod: true },
  },
  {
    id: 'showShortcuts',
    scope: 'anywhere',
    description: 'Show or hide this list',
    chord: { key: '/', mod: true },
  },
  {
    id: 'closeDialog',
    scope: 'anywhere',
    description: 'Close this list',
    chord: { key: 'Escape' },
  },
  // Alt+digit is matched by the key's code: on a Mac Option+1 types "¡".
  // Firefox on Linux takes Alt+1 to Alt+8 for its own tabs, hence the
  // second chord.
  {
    id: 'showFiles',
    scope: 'panels',
    description: 'Show the files panel and go to the file tree',
    chord: { code: 'Digit1', alt: true },
    otherChords: [{ key: 'e', mod: true, shift: true }],
  },
  {
    id: 'showSearch',
    scope: 'panels',
    description: 'Show the search panel and go to the first pattern field',
    chord: { code: 'Digit2', alt: true },
    otherChords: [{ key: 'f', mod: true, shift: true }],
  },
  {
    id: 'activityBarMove',
    scope: 'activityBar',
    description: 'Move down or up through the panel buttons',
    chord: { key: 'ArrowDown' },
    otherChords: [{ key: 'ArrowUp' }],
  },
  // Alt+letter is matched by the key's code: on a Mac Option+G types "©".
  {
    id: 'toggleChainMode',
    scope: 'filesPanel',
    description: 'Group rotated logs: on or off',
    chord: { code: 'KeyG', alt: true },
  },
  {
    id: 'toggleLabels',
    scope: 'filesPanel',
    description: 'Show labels: on or off',
    chord: { code: 'KeyL', alt: true },
  },
  {
    id: 'switchValue',
    scope: 'filesPanel',
    description: 'Show the size or the date of each file',
    chord: { code: 'KeyV', alt: true },
  },
  // Option+N is a dead key on a Mac's US layout: its key reads "Dead",
  // and its code still names the letter.
  {
    id: 'sortByName',
    scope: 'filesPanel',
    description: 'Sort by name, or reverse a sort by name',
    chord: { code: 'KeyN', alt: true },
  },
  {
    id: 'sortByValue',
    scope: 'filesPanel',
    description: 'Sort by the size or date shown, or reverse that sort',
    chord: { code: 'KeyS', alt: true },
  },
  {
    id: 'valueSwitchMove',
    scope: 'valueSwitch',
    description: 'Choose the value before or after the chosen one',
    chord: { key: 'ArrowLeft' },
    otherChords: [{ key: 'ArrowRight' }],
  },
  ...SEARCH_TOGGLES.map((toggle): Shortcut => ({
    id: `toggle:${toggle.key}`,
    scope: 'searchPanel',
    description: `${toggle.title}: on or off`,
    chord: { code: toggle.shortcutCode, alt: true },
  })),
  {
    id: 'toggleOnlyOpened',
    scope: 'searchPanel',
    description: 'Only opened files: on or off',
    chord: { code: 'KeyO', alt: true },
  },
  {
    id: 'runSearch',
    scope: 'searchField',
    description: 'Run the search',
    chord: { key: 'Enter', shift: false },
  },
  {
    id: 'tabStripMove',
    scope: 'tabStrip',
    description: 'Show the next or the previous tab, round the ends',
    chord: { key: 'ArrowRight' },
    otherChords: [{ key: 'ArrowLeft' }],
  },
  {
    id: 'tabStripEnds',
    scope: 'tabStrip',
    description: 'Show the first or the last tab',
    chord: { key: 'Home' },
    otherChords: [{ key: 'End' }],
  },
  // A Mac's keyboard prints "delete" on the key that sends Backspace.
  {
    id: 'tabStripClose',
    scope: 'tabStrip',
    description: 'Close the tab and show the tab used before it',
    chord: { key: 'Delete' },
    otherChords: [{ key: 'Backspace' }],
  },
  {
    id: 'treeMove',
    scope: 'fileTree',
    description: 'Go to the next or the previous row',
    chord: { key: 'ArrowDown' },
    otherChords: [{ key: 'ArrowUp' }],
  },
  {
    id: 'treeOpenFolder',
    scope: 'fileTree',
    description: 'Open the folder, or go to its first row',
    chord: { key: 'ArrowRight' },
  },
  {
    id: 'treeCloseFolder',
    scope: 'fileTree',
    description: 'Close the folder, or go to the folder that holds the row',
    chord: { key: 'ArrowLeft' },
  },
  {
    id: 'treeEnds',
    scope: 'fileTree',
    description: 'Go to the first or the last row',
    chord: { key: 'Home' },
    otherChords: [{ key: 'End' }],
  },
  {
    id: 'treePage',
    scope: 'fileTree',
    description: 'Go one panel height down or up',
    chord: { key: 'PageDown' },
    otherChords: [{ key: 'PageUp' }],
  },
  {
    id: 'openTreeItem',
    scope: 'fileTree',
    description: 'Open the file, or open or close the folder',
    chord: { key: 'Enter' },
    otherChords: [{ key: ' ' }],
  },
  {
    id: 'treeTypeName',
    scope: 'fileTree',
    description: 'Go to the next row whose name starts with the letters typed',
    gesture: 'Type a name',
  },
  {
    id: 'treeToEditor',
    scope: 'fileTree',
    description: 'Go back to the open file',
    chord: { key: 'Escape' },
  },
  {
    id: 'gotoLine',
    scope: 'filePane',
    description: 'Go to a line of the file',
    chord: { key: ':' },
    // Monaco's own Cmd/Ctrl+G counts the loaded editor lines, not the file's.
    otherChords: [{ key: 'g', mod: true }],
  },
  {
    id: 'findInEditor',
    scope: 'filePane',
    description: 'Find in the lines loaded in the editor',
    gesture: `${MOD_LABEL}+F`,
  },
  {
    id: 'nextAnomaly',
    scope: 'filePane',
    description: 'On the selected anomaly chip: next anomaly (add Shift for the previous one)',
    gesture: '⌘/Alt+click',
  },
  {
    id: 'gotoJump',
    scope: 'gotoField',
    description: 'Jump to the typed line',
    chord: { key: 'Enter' },
  },
  {
    id: 'gotoClose',
    scope: 'gotoField',
    description: 'Close the go-to-line box',
    chord: { key: 'Escape' },
  },
  {
    id: 'applyFilter',
    scope: 'filterField',
    description: 'Apply the filter to the open file',
    chord: { key: 'Enter' },
  },
  {
    id: 'closeFilter',
    scope: 'filterField',
    description: 'Close the filter bar (an applied filter stays)',
    chord: { key: 'Escape' },
  },
  {
    id: 'timelineStep',
    scope: 'timeline',
    description: 'Move the time by 1/200 of the bar, to a whole second',
    chord: { key: 'ArrowLeft', shift: false },
    otherChords: [{ key: 'ArrowRight', shift: false }],
  },
  {
    id: 'timelineBigStep',
    scope: 'timeline',
    description: 'Move the time by 1/20 of the bar, to a whole second',
    chord: { key: 'ArrowLeft', shift: true },
    otherChords: [{ key: 'ArrowRight', shift: true }],
  },
  {
    id: 'timelineEnds',
    scope: 'timeline',
    description: 'Move the time to the start or the end of the bar',
    chord: { key: 'Home' },
    otherChords: [{ key: 'End' }],
  },
  {
    id: 'timelineJump',
    scope: 'timeline',
    description: 'Go to that time in the open file (also in the Go to time box)',
    chord: { key: 'Enter' },
  },
  {
    id: 'timelineCancel',
    scope: 'timeline',
    description: 'Put the time back where the open file is',
    chord: { key: 'Escape' },
  },
  {
    id: 'timelineScrub',
    scope: 'timeline',
    description: 'Go to the time under the pointer when the button is released',
    gesture: 'Drag or click',
  },
  {
    id: 'zoneMove',
    scope: 'zonePicker',
    description: 'Move down or up through the listed zones and the filter field',
    chord: { key: 'ArrowDown' },
    otherChords: [{ key: 'ArrowUp' }],
  },
  {
    id: 'zoneChoose',
    scope: 'zonePicker',
    description: 'In the filter field: read the file in the first listed zone or the typed offset',
    chord: { key: 'Enter' },
  },
  {
    id: 'zoneClose',
    scope: 'zonePicker',
    description: 'Close the picker and keep the zone',
    chord: { key: 'Escape' },
  },
  {
    id: 'closeHistory',
    scope: 'openPanel',
    description: 'Close the recent commands',
    chord: { key: 'Escape' },
  },
  {
    id: 'closeAnalysis',
    scope: 'openPanel',
    description: 'Close the analysis dialog',
    chord: { key: 'Escape' },
  },
  {
    id: 'closeChainParts',
    scope: 'openPanel',
    description: "Close the list of a log chain's parts",
    chord: { key: 'Escape' },
  },
];

/** The row with `id`. Throws on an unknown id, which is a programming error. */
export function shortcutById(id: ShortcutId): Shortcut {
  const shortcut = SHORTCUTS.find((s) => s.id === id);
  if (!shortcut) throw new Error(`No shortcut with id ${id}`);
  return shortcut;
}

/**
 * The keys of every chord of the row `id`, its main chord first, as
 * `platform` names them. A row that is a mouse gesture has none.
 */
export function shortcutKeys(id: ShortcutId, platform: Platform): string[][] {
  return chordsOf(shortcutById(id)).map((chord) => chordKeys(chord, platform));
}

/** Whether `event` is the key press of the row `id`. */
export function isShortcut(id: ShortcutId, event: KeyPress): boolean {
  return chordsOf(shortcutById(id)).some((chord) => matchesChord(chord, event));
}

/**
 * The rows of each scope, in table order, for the help dialog. A scope
 * with no row yet is left out, so the help shows no empty group.
 */
export function shortcutsByScope(): {
  scope: ShortcutScope;
  title: string;
  shortcuts: Shortcut[];
}[] {
  return (Object.keys(SHORTCUT_SCOPES) as ShortcutScope[])
    .map((scope) => ({
      scope,
      title: SHORTCUT_SCOPES[scope],
      shortcuts: SHORTCUTS.filter((s) => s.scope === scope),
    }))
    .filter((group) => group.shortcuts.length > 0);
}

/**
 * What each window-wide shortcut does. An action returns whether it
 * acted; one that had nothing to do leaves the key to the browser.
 */
export type GlobalShortcutActions = Record<GlobalShortcutId, () => boolean>;

const GLOBAL_IDS: readonly GlobalShortcutId[] = [
  'focusSearch',
  'showFiles',
  'showSearch',
  'toggleSidebar',
  'showShortcuts',
  'closeDialog',
];

/**
 * Run the window-wide shortcut `event` is, if any. `preventDefault` is
 * called only when the action acted, so the browser keeps every key the
 * viewer does not use at that moment.
 */
export function handleGlobalKey(
  event: KeyPress & { preventDefault(): void },
  actions: GlobalShortcutActions,
): boolean {
  const id = GLOBAL_IDS.find((candidate) => isShortcut(candidate, event));
  if (!id || !actions[id]()) return false;
  event.preventDefault();
  return true;
}

/** What each of some shortcuts does; an action returns whether it acted. */
type ShortcutActions<Id extends ShortcutId> = Partial<Record<Id, () => boolean>>;

/**
 * Run the shortcut `event` is, among those `actions` holds; an id without
 * an action is not matched. `preventDefault` is called only when the
 * action acted.
 */
function runShortcutAmong<Id extends ShortcutId>(
  event: KeyPress & { preventDefault(): void },
  actions: ShortcutActions<Id>,
): boolean {
  const ids = Object.keys(actions) as Id[];
  const id = ids.find((candidate) => isShortcut(candidate, event));
  if (!id || !actions[id]?.()) return false;
  event.preventDefault();
  return true;
}

/**
 * What each files panel shortcut does; an id without an action is not
 * matched. An action returns whether it acted.
 */
export type FilesPanelShortcutActions = ShortcutActions<FilesPanelShortcutId>;

/**
 * Run the files panel shortcut `event` is, among those `actions` holds.
 * The caller decides whether the panel's keys apply at all (the panel is
 * shown, no dialog is open). `preventDefault` is called only when the
 * action acted.
 */
export function handleFilesPanelKey(
  event: KeyPress & { preventDefault(): void },
  actions: FilesPanelShortcutActions,
): boolean {
  return runShortcutAmong(event, actions);
}

/**
 * What each search panel shortcut does; an id without an action is not
 * matched. An action returns whether it acted: a disabled toggle does not.
 */
export type SearchPanelShortcutActions = ShortcutActions<SearchPanelShortcutId>;

/**
 * Run the search panel shortcut `event` is, among those `actions` holds.
 * The caller hears the keys of the whole panel and decides whether they
 * apply at all (no dialog is open). `preventDefault` is called only when
 * the action acted.
 */
export function handleSearchPanelKey(
  event: KeyPress & { preventDefault(): void },
  actions: SearchPanelShortcutActions,
): boolean {
  return runShortcutAmong(event, actions);
}

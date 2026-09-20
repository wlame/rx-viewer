/**
 * Every keyboard shortcut and mouse gesture of the viewer, in one table.
 *
 * The key handlers ask this table whether a key press is theirs, and the
 * help dialog lists the same rows, so the two cannot disagree. A row
 * with a `chord` is a key press; its label in the help is built from the
 * chord. A row with a `gesture` is a mouse action, listed for help only.
 */
import { belongsToInputMethod, type CompositionState } from './keyTargets';
import { SEARCH_TOGGLES } from './searchToggles';

/** Where a shortcut works, in the order the help dialog lists them. */
export const SHORTCUT_SCOPES = {
  anywhere: 'Anywhere',
  searchField: 'In a search pattern field',
  fileTree: 'In the file tree',
  filePane: 'In the open file',
  gotoField: 'In the go-to-line box',
  filterField: 'In the editor filter field',
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
export type GlobalShortcutId = 'focusSearch' | 'toggleSidebar' | 'showShortcuts' | 'closeDialog';

export type ShortcutId =
  | GlobalShortcutId
  | 'runSearch'
  | `toggle:${string}`
  | 'gotoLine'
  | 'gotoJump'
  | 'gotoClose'
  | 'findInEditor'
  | 'nextAnomaly'
  | 'applyFilter'
  | 'closeFilter'
  | 'openTreeItem'
  | 'closeHistory'
  | 'closeAnalysis';

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
};

/** The help dialog's label for a key press. */
export function chordLabel(chord: KeyChord): string {
  const parts: string[] = [];
  if (chord.mod) parts.push(MOD_LABEL);
  if (chord.alt) parts.push('Alt');
  if (chord.shift) parts.push('Shift');
  const key = chord.key ?? chord.code?.replace(/^Key/, '') ?? '';
  parts.push(KEY_LABELS[key] ?? (key.length === 1 ? key.toUpperCase() : key));
  return parts.join('+');
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
  {
    id: 'runSearch',
    scope: 'searchField',
    description: 'Run the search',
    chord: { key: 'Enter', shift: false },
  },
  ...SEARCH_TOGGLES.map((toggle): Shortcut => ({
    id: `toggle:${toggle.key}`,
    scope: 'searchField',
    description: `${toggle.title}: on or off`,
    chord: { code: toggle.shortcutCode, alt: true },
  })),
  {
    id: 'openTreeItem',
    scope: 'fileTree',
    description: 'Open the file, or open or close the folder',
    chord: { key: 'Enter' },
    otherChords: [{ key: ' ' }],
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
];

/** The row with `id`. Throws on an unknown id, which is a programming error. */
export function shortcutById(id: ShortcutId): Shortcut {
  const shortcut = SHORTCUTS.find((s) => s.id === id);
  if (!shortcut) throw new Error(`No shortcut with id ${id}`);
  return shortcut;
}

/** Whether `event` is the key press of the row `id`. */
export function isShortcut(id: ShortcutId, event: KeyPress): boolean {
  return chordsOf(shortcutById(id)).some((chord) => matchesChord(chord, event));
}

/** The rows of each scope, in table order, for the help dialog. */
export function shortcutsByScope(): {
  scope: ShortcutScope;
  title: string;
  shortcuts: Shortcut[];
}[] {
  return (Object.keys(SHORTCUT_SCOPES) as ShortcutScope[]).map((scope) => ({
    scope,
    title: SHORTCUT_SCOPES[scope],
    shortcuts: SHORTCUTS.filter((s) => s.scope === scope),
  }));
}

/**
 * What each window-wide shortcut does. An action returns whether it
 * acted; one that had nothing to do leaves the key to the browser.
 */
export type GlobalShortcutActions = Record<GlobalShortcutId, () => boolean>;

const GLOBAL_IDS: readonly GlobalShortcutId[] = [
  'focusSearch',
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

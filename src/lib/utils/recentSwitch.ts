/**
 * The recent-tab switcher as a state machine: Alt+Q opens it on the tab
 * used before the one shown, each further Q while Alt is held goes one
 * entry further (Shift+Q one back, both round the ends), and releasing
 * Alt shows the chosen tab. Esc, the window losing focus and the page
 * being hidden close it without a switch. Its list shows only after
 * `RECENT_LIST_DELAY_MS`, so a quick Alt+Q switches with no flash.
 */
import type { TabKey } from './tabKey';

/** How long the switcher stays open before its list shows. */
export const RECENT_LIST_DELAY_MS = 250;

/** An open switcher: the recent order it opened with, less the tabs closed since. */
export interface OpenSwitch {
  isOpen: true;
  /** The keys of the open tabs, most recently used first, as they were when it opened. */
  keys: TabKey[];
  /** The index in `keys` of the chosen entry. */
  selected: number;
  /** Whether its delay passed, so its list shows. */
  isListShown: boolean;
}

export type RecentSwitch = { isOpen: false } | OpenSwitch;

export const CLOSED_SWITCH: RecentSwitch = { isOpen: false };

/** What happens to the switcher. */
export type RecentSwitchEvent =
  /** Alt+Q, or Alt+Shift+Q with `back`; `recent` is the order of the tabs now. */
  | { kind: 'press'; recent: readonly TabKey[]; back: boolean }
  /** Its delay passed. */
  | { kind: 'reveal' }
  /** Alt was released. */
  | { kind: 'release' }
  /** An entry of its list was clicked. */
  | { kind: 'choose'; key: TabKey }
  /** Esc, the window lost the focus, or the page was hidden. */
  | { kind: 'cancel' }
  /** The open tabs changed; `open` holds their keys. */
  | { kind: 'tabs'; open: readonly TabKey[] };

/** The switcher after an event, and the tab to show, or null for none. */
export interface RecentSwitchStep {
  state: RecentSwitch;
  activate: TabKey | null;
}

/** The fewest tabs the switcher opens on, or stays open with. */
const MIN_TABS = 2;

const stay = (state: RecentSwitch): RecentSwitchStep => ({ state, activate: null });
const closeOn = (activate: TabKey | null): RecentSwitchStep => ({
  state: CLOSED_SWITCH,
  activate,
});

/** The index `step` entries from `index` among `count`, round the ends. */
function around(index: number, step: number, count: number): number {
  return (((index + step) % count) + count) % count;
}

type EventOf<K extends RecentSwitchEvent['kind']> = Extract<RecentSwitchEvent, { kind: K }>;

/** What each event does to an open switcher. */
const OPEN_STEPS: {
  [K in RecentSwitchEvent['kind']]: (state: OpenSwitch, event: EventOf<K>) => RecentSwitchStep;
} = {
  press: (state, { back }) =>
    stay({ ...state, selected: around(state.selected, back ? -1 : 1, state.keys.length) }),
  reveal: (state) => stay({ ...state, isListShown: true }),
  release: (state) => closeOn(state.keys[state.selected]),
  choose: (state, { key }) => (state.keys.includes(key) ? closeOn(key) : stay(state)),
  cancel: () => closeOn(null),
  tabs: (state, { open }) => {
    const keys = state.keys.filter((key) => open.includes(key));
    if (keys.length === state.keys.length) return stay(state);
    if (keys.length < MIN_TABS) return closeOn(null);
    const kept = keys.indexOf(state.keys[state.selected]);
    const selected = kept >= 0 ? kept : Math.min(state.selected, keys.length - 1);
    return stay({ ...state, keys, selected });
  },
};

/**
 * Open a closed switcher on a press: on the tab used before the one
 * shown, or with `back` on the least recently used one. It stays closed
 * with fewer than two tabs open.
 */
function open({ recent, back }: EventOf<'press'>): RecentSwitchStep {
  if (recent.length < MIN_TABS) return stay(CLOSED_SWITCH);
  const keys = [...recent];
  return stay({ isOpen: true, keys, selected: back ? keys.length - 1 : 1, isListShown: false });
}

/** The switcher after `event`, and the tab it shows. A closed switcher takes only a press. */
export function stepRecentSwitch(state: RecentSwitch, event: RecentSwitchEvent): RecentSwitchStep {
  if (!state.isOpen) return event.kind === 'press' ? open(event) : stay(state);
  const step = OPEN_STEPS[event.kind] as (s: OpenSwitch, e: RecentSwitchEvent) => RecentSwitchStep;
  return step(state, event);
}

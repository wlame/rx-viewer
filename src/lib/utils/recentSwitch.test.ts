import { describe, expect, it } from 'vitest';
import {
  CLOSED_SWITCH,
  RECENT_LIST_DELAY_MS,
  stepRecentSwitch,
  type RecentSwitch,
  type RecentSwitchEvent,
} from './recentSwitch';

/** The tabs most recently used first: C is shown, B was shown before it, then A. */
const RECENT = ['C', 'B', 'A'];
const press: RecentSwitchEvent = { kind: 'press', recent: RECENT, back: false };
const pressBack: RecentSwitchEvent = { kind: 'press', recent: RECENT, back: true };

/** The switcher after `events`, with the tab the last one activated. */
function run(...events: RecentSwitchEvent[]): { state: RecentSwitch; activate: string | null } {
  return events.reduce<{ state: RecentSwitch; activate: string | null }>(
    ({ state }, event) => stepRecentSwitch(state, event),
    { state: CLOSED_SWITCH, activate: null },
  );
}

/** The entry an open switcher has chosen. */
function chosen(state: RecentSwitch): string | null {
  return state.isOpen ? state.keys[state.selected] : null;
}

describe('the recent-tab switcher', () => {
  it('waits 250 ms before it shows its list', () => {
    expect(RECENT_LIST_DELAY_MS).toBe(250);
  });

  it('opens on the tab used before the one shown, with its list not shown yet', () => {
    const { state, activate } = run(press);

    expect(state).toEqual({ isOpen: true, keys: RECENT, selected: 1, isListShown: false });
    expect(activate).toBeNull();
  });

  it('goes one entry further with each Q, round the end, and one back with Shift+Q', () => {
    expect(chosen(run(press, press).state)).toBe('A');
    expect(chosen(run(press, press, pressBack).state)).toBe('B');
    expect(chosen(run(press, press, press).state)).toBe('C');
    expect(chosen(run(press, pressBack, pressBack).state)).toBe('A');
  });

  it('opens on the least recently used tab with Alt+Shift+Q', () => {
    expect(chosen(run(pressBack).state)).toBe('A');
  });

  it('switches to the chosen tab and closes when Alt is released', () => {
    expect(run(press, press, pressBack, { kind: 'release' })).toEqual({
      state: CLOSED_SWITCH,
      activate: 'B',
    });
  });

  it('switches to the tab used before with a quick Alt+Q, its list never shown', () => {
    const quick = run(press, { kind: 'release' });

    expect(quick.activate).toBe('B');
    expect(quick.state.isOpen).toBe(false);
  });

  it('shows its list once the delay passed', () => {
    const { state } = run(press, { kind: 'reveal' });

    expect(state.isOpen && state.isListShown).toBe(true);
    expect(chosen(state)).toBe('B');
  });

  // Esc, the window losing focus and the page hidden each cancel.
  it('closes on a cancel and switches to no tab', () => {
    expect(run(press, press, { kind: 'cancel' })).toEqual({
      state: CLOSED_SWITCH,
      activate: null,
    });
  });

  it('switches to an entry clicked in its list', () => {
    expect(run(press, { kind: 'reveal' }, { kind: 'choose', key: 'A' })).toEqual({
      state: CLOSED_SWITCH,
      activate: 'A',
    });
  });

  it('does not open with fewer than two tabs open', () => {
    expect(run({ kind: 'press', recent: ['C'], back: false })).toEqual({
      state: CLOSED_SWITCH,
      activate: null,
    });
  });

  it('ignores everything but a press while it is closed', () => {
    for (const event of [
      { kind: 'reveal' },
      { kind: 'release' },
      { kind: 'cancel' },
      { kind: 'choose', key: 'A' },
      { kind: 'tabs', open: RECENT },
    ] as RecentSwitchEvent[]) {
      expect(stepRecentSwitch(CLOSED_SWITCH, event)).toEqual({
        state: CLOSED_SWITCH,
        activate: null,
      });
    }
  });

  it('drops a tab that closes and keeps the chosen tab chosen', () => {
    const { state } = run(press, press, { kind: 'tabs', open: ['A', 'C'] });

    expect(state.isOpen && state.keys).toEqual(['C', 'A']);
    expect(chosen(state)).toBe('A');
  });

  it('chooses the entry that takes the place of a chosen tab that closes', () => {
    const { state } = run(press, { kind: 'tabs', open: ['A', 'C'] });

    expect(chosen(state)).toBe('A');
    expect(chosen(run(press, press, { kind: 'tabs', open: ['B', 'C', 'D'] }).state)).toBe('B');
  });

  it('closes when fewer than two of its tabs are left open, and switches to none', () => {
    expect(run(press, { kind: 'tabs', open: ['C', 'D'] })).toEqual({
      state: CLOSED_SWITCH,
      activate: null,
    });
  });

  it('keeps the list it opened with when a tab opens meanwhile', () => {
    const { state } = run(press, { kind: 'tabs', open: ['A', 'B', 'C', 'D'] });

    expect(state.isOpen && state.keys).toEqual(RECENT);
  });
});

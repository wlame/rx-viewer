/**
 * The two orders of the open tabs: the strip's, which the user arranges,
 * and the recent order, most recently used first, which the recent-tab
 * switcher walks and which picks the tab shown when the active one closes.
 */
import type { TabKey } from './tabKey';

/** The open tabs, the active one and the recent order, as the files store holds them. */
export interface TabOrder {
  /** The keys of the open tabs, in strip order. */
  openKeys: readonly TabKey[];
  /** The key of the active tab. */
  activeKey: TabKey | null;
  /** The keys of the open tabs, most recently used first. */
  recentTabs: readonly TabKey[];
}

/**
 * The recent order and the active tab after any change of the open tabs:
 * a closed tab leaves the order, a tab not in it yet joins it at the end
 * in strip order, and the active tab comes first. When the active tab
 * is no open tab any more (it closed), the most recent remaining one
 * becomes active. With no tab open the order is empty and the active key
 * stays as it was.
 *
 * Applied to an empty order this gives a fresh load's order: the active
 * tab, then the others in strip order.
 */
export function followTabs(order: TabOrder): { recentTabs: TabKey[]; activeKey: TabKey | null } {
  const open = new Set(order.openKeys);
  const kept = [...new Set(order.recentTabs)].filter((key) => open.has(key));
  const known = new Set(kept);
  const recent = [...kept, ...order.openKeys.filter((key) => !known.has(key))];
  const activeKey =
    order.activeKey !== null && open.has(order.activeKey)
      ? order.activeKey
      : (recent[0] ?? order.activeKey);
  if (activeKey === null || !open.has(activeKey)) return { recentTabs: recent, activeKey };
  return { recentTabs: [activeKey, ...recent.filter((key) => key !== activeKey)], activeKey };
}

/** Tabs that turned into one tab: the chain's tab its parts' tabs became, or the reverse. */
export interface TabReplacement {
  /** The keys of the tabs that were replaced. */
  from: readonly TabKey[];
  /** The key of the tab that replaced them. */
  to: TabKey;
}

/**
 * The recent order with each replacement applied: the new tab takes the
 * most recent place among the tabs it replaced and, when it was in the
 * order already, its own; the replaced tabs leave the order. A
 * replacement none of whose keys is in the order changes nothing.
 */
export function replaceInRecent(
  recent: readonly TabKey[],
  replacements: readonly TabReplacement[],
): TabKey[] {
  return replacements.reduce<TabKey[]>(
    (order, { from, to }) => {
      const places = [to, ...from].map((key) => order.indexOf(key)).filter((place) => place >= 0);
      if (places.length === 0) return order;
      const place = Math.min(...places);
      return order
        .map((key, index) => (index === place ? to : key))
        .filter((key, index) => index === place || (key !== to && !from.includes(key)));
    },
    [...recent],
  );
}

/**
 * The key of the tab `step` places from `key` in strip order, round the
 * ends; null with fewer than two tabs open, or when `key` is not open.
 */
export function tabBeside(keys: readonly TabKey[], key: TabKey, step: number): TabKey | null {
  const index = keys.indexOf(key);
  if (index < 0 || keys.length < 2) return null;
  return keys[(((index + step) % keys.length) + keys.length) % keys.length];
}

import { describe, expect, it } from 'vitest';
import { followTabs, replaceInRecent, tabBeside, type TabOrder } from './tabOrder';

/** The order after each of `steps`, each applied to what the one before left. */
function afterSteps(steps: ((order: TabOrder) => TabOrder)[]): TabOrder {
  return steps.reduce(
    (order, step) => {
      const changed = step(order);
      const followed = followTabs(changed);
      return { ...changed, recentTabs: followed.recentTabs, activeKey: followed.activeKey };
    },
    { openKeys: [], activeKey: null, recentTabs: [] } as TabOrder,
  );
}

/** Open `key` at the end of the strip and make it active, as opening a file does. */
const open = (key: string) => (order: TabOrder) => ({
  ...order,
  openKeys: [...order.openKeys, key],
  activeKey: key,
});
const activate = (key: string) => (order: TabOrder) => ({ ...order, activeKey: key });
const close = (key: string) => (order: TabOrder) => ({
  ...order,
  openKeys: order.openKeys.filter((k) => k !== key),
});

describe('followTabs', () => {
  it('puts each tab that becomes active first, and drops a closed one', () => {
    const opened = afterSteps([open('A'), open('B'), open('C')]);
    expect(opened.recentTabs).toEqual(['C', 'B', 'A']);

    const backToA = afterSteps([open('A'), open('B'), open('C'), activate('A')]);
    expect(backToA.recentTabs).toEqual(['A', 'C', 'B']);

    const closedC = afterSteps([open('A'), open('B'), open('C'), activate('A'), close('C')]);
    expect(closedC.recentTabs).toEqual(['A', 'B']);
    expect(closedC.activeKey).toBe('A');
  });

  it('makes the most recent remaining tab active when the active one closes, not its neighbour', () => {
    const order = afterSteps([open('A'), open('B'), open('C'), activate('A'), activate('C')]);
    expect(order.recentTabs).toEqual(['C', 'A', 'B']);

    const closed = afterSteps([
      open('A'),
      open('B'),
      open('C'),
      activate('A'),
      activate('C'),
      close('C'),
    ]);

    expect(closed.activeKey).toBe('A');
    expect(closed.recentTabs).toEqual(['A', 'B']);
  });

  it('orders the tabs of a fresh load as the active one, then the others in strip order', () => {
    expect(followTabs({ openKeys: ['A', 'B', 'C'], activeKey: 'B', recentTabs: [] })).toEqual({
      recentTabs: ['B', 'A', 'C'],
      activeKey: 'B',
    });
  });

  it('puts a tab that opened without becoming active last', () => {
    expect(
      followTabs({ openKeys: ['A', 'N', 'B'], activeKey: 'B', recentTabs: ['B', 'A'] }),
    ).toEqual({ recentTabs: ['B', 'A', 'N'], activeKey: 'B' });
  });

  it('keeps the active key and an empty order when no tab is open', () => {
    expect(followTabs({ openKeys: [], activeKey: 'A', recentTabs: ['A'] })).toEqual({
      recentTabs: [],
      activeKey: 'A',
    });
  });

  it('holds each key once, whatever the order it is given', () => {
    expect(
      followTabs({ openKeys: ['A', 'B'], activeKey: 'A', recentTabs: ['B', 'A', 'B', 'X'] }),
    ).toEqual({ recentTabs: ['A', 'B'], activeKey: 'A' });
  });
});

describe('replaceInRecent', () => {
  it('puts the key that replaces a tab in the place of the tab it replaces', () => {
    expect(
      replaceInRecent(
        ['/d/other.log', '/d/app.log', '/d/notes.txt'],
        [{ from: ['/d/app.log'], to: 'chain:/d/app.log' }],
      ),
    ).toEqual(['/d/other.log', 'chain:/d/app.log', '/d/notes.txt']);
  });

  it('puts a tab that replaces several in the place of the most recent of them', () => {
    expect(
      replaceInRecent(
        ['/d/notes.txt', '/d/app.log.1', '/d/other.log', '/d/app.log.3.gz'],
        [{ from: ['/d/app.log.3.gz', '/d/app.log.1'], to: 'chain:/d/app.log' }],
      ),
    ).toEqual(['/d/notes.txt', 'chain:/d/app.log', '/d/other.log']);
  });

  it('keeps the more recent place of a tab that was open already', () => {
    expect(
      replaceInRecent(
        ['/d/app.log.1', '/d/notes.txt', 'chain:/d/app.log'],
        [{ from: ['chain:/d/app.log'], to: '/d/app.log.1' }],
      ),
    ).toEqual(['/d/app.log.1', '/d/notes.txt']);
    expect(
      replaceInRecent(
        ['chain:/d/app.log', '/d/notes.txt', '/d/app.log.1'],
        [{ from: ['chain:/d/app.log'], to: '/d/app.log.1' }],
      ),
    ).toEqual(['/d/app.log.1', '/d/notes.txt']);
  });

  it('applies each replacement, and leaves an order that holds none of its keys as it is', () => {
    expect(
      replaceInRecent(
        ['chain:/a/x.log', 'chain:/b/y.log', '/c/z.log'],
        [
          { from: ['chain:/a/x.log'], to: '/a/x.log' },
          { from: ['chain:/b/y.log'], to: '/b/y.log.1' },
          { from: ['/q/gone.log'], to: '/q/new.log' },
        ],
      ),
    ).toEqual(['/a/x.log', '/b/y.log.1', '/c/z.log']);
  });
});

describe('tabBeside', () => {
  const STRIP = ['A', 'B', 'C'];

  it.each([
    ['A', 1, 'B'],
    ['C', 1, 'A'],
    ['B', -1, 'A'],
    ['A', -1, 'C'],
  ] as const)('gives the tab beside %s, %i places on, round the ends', (key, step, expected) => {
    expect(tabBeside(STRIP, key, step)).toBe(expected);
  });

  it('gives none with one tab open, or for a key that is not open', () => {
    expect(tabBeside(['A'], 'A', 1)).toBeNull();
    expect(tabBeside(STRIP, 'X', 1)).toBeNull();
  });
});

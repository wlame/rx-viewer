// @vitest-environment jsdom
import '$lib/testing/matchMediaStub';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { health, tree } from '$lib/stores';
import { chainMode } from '$lib/stores/chainMode';
import {
  CHAIN_NAMES,
  LOG_DIR,
  LogDirBackend,
  logDirChains,
  logDirEntries,
  serveLogDir,
  treeEntry,
} from '$lib/testing/fakeLogDir';
import type { TreeNode as TreeNodeType } from '$lib/types';
import TreeNode from './TreeNode.svelte';

let row: TreeNode | null = null;

const FOLDER = {
  name: 'logs',
  path: '/logs',
  type: 'directory',
  level: 0,
  expanded: false,
  loading: false,
  children: [],
} as unknown as TreeNodeType;

/** Mount a folder row and return it, with the tree's toggle stubbed out. */
function mount() {
  const toggle = vi.spyOn(tree, 'toggleExpanded').mockResolvedValue(undefined);
  const target = document.createElement('div');
  document.body.appendChild(target);
  row = new TreeNode({ target, props: { node: FOLDER } });
  const item = target.querySelector<HTMLElement>('[role="treeitem"]');
  if (!item) throw new Error('the tree row is not rendered');
  return { item, toggle };
}

function keyDown(item: HTMLElement, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  item.dispatchEvent(event);
  return event;
}

afterEach(() => {
  row?.$destroy();
  row = null;
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('TreeNode keys', () => {
  it.each(['Enter', ' '])('opens the folder on %j', (key) => {
    const { item, toggle } = mount();

    const event = keyDown(item, { key });

    expect(toggle).toHaveBeenCalledWith('/logs');
    expect(event.defaultPrevented).toBe(true);
  });

  it.each([{ key: 'a' }, { key: 'Enter', isComposing: true }])(
    'leaves %o to the browser',
    (init) => {
      const { item, toggle } = mount();

      const event = keyDown(item, init);

      expect(toggle).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
    },
  );
});

describe('TreeNode of a folder in chain mode', () => {
  /** The log folder, loaded and expanded, with its chains listed. */
  function logFolder(): TreeNodeType {
    return {
      ...treeEntry(LOG_DIR, 'directory'),
      expanded: true,
      loading: false,
      level: 0,
      children: logDirEntries().map((entry) => ({
        ...entry,
        expanded: false,
        loading: false,
        children: [],
        level: 1,
      })),
      chains: logDirChains(),
    };
  }

  async function mountFolder(mode: boolean) {
    serveLogDir(new LogDirBackend());
    await health.check();
    chainMode.set(mode);
    const target = document.createElement('div');
    document.body.appendChild(target);
    row = new TreeNode({ target, props: { node: logFolder() } });
    await tick();
    const items = () => [...target.querySelectorAll<HTMLElement>('[role="treeitem"]')];
    const chains = () =>
      [...target.querySelectorAll<HTMLElement>('[data-chain]')].map((c) => c.dataset.chain);
    return { target, items, chains };
  }

  afterEach(() => {
    chainMode.set(false);
    vi.unstubAllGlobals();
  });

  it('shows each chain in place of its parts, and every other entry', async () => {
    const { items, chains } = await mountFolder(true);

    // The folder's own row, then its 26 rows.
    expect(items()).toHaveLength(27);
    expect(chains()).toEqual(CHAIN_NAMES);
    const shownText = items().map((item) => item.textContent ?? '');
    expect(shownText.some((text) => text.includes('pkg.log.11.gz'))).toBe(false);
    expect(shownText.some((text) => text.includes('sessions.1'))).toBe(true);
  });

  it('shows every entry the folder lists with the mode off', async () => {
    const { items, chains } = await mountFolder(false);

    expect(items()).toHaveLength(71);
    expect(chains()).toEqual([]);
  });

  it('shows the parts again when the mode turns off, and the chains when it turns on', async () => {
    const { items, chains } = await mountFolder(true);

    chainMode.set(false);
    await tick();
    expect(items()).toHaveLength(71);

    chainMode.set(true);
    await tick();
    expect(chains()).toEqual(CHAIN_NAMES);
  });

  // A chain's parts are reached by turning the mode off, or from the
  // parts list of the chain's tab; the panel shows only the chain's row.
  it('lists no part under a chain row', async () => {
    const { items } = await mountFolder(true);

    const partNames = new Set(logDirChains().flatMap((c) => c.parts));
    const fileNames = items()
      .filter((item) => item.dataset.chain === undefined)
      .map((item) => item.textContent?.trim().split(/\s/)[0] ?? '');
    expect(fileNames.filter((name) => partNames.has(name))).toEqual([]);
  });
});

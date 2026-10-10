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
import type { TreeEntry, TreeNode as TreeNodeType } from '$lib/types';
import { formatFileTime } from '$lib/utils/format';
import type { TreeSort } from '$lib/utils/treeSort';
import type { ValueColumn } from '$lib/utils/urlState';
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

describe('TreeNode of a file', () => {
  const FILE = {
    ...treeEntry('/logs/app.log.2.gz', 'file', {
      is_text: true,
      is_compressed: true,
      compression_format: 'gzip',
      is_indexed: true,
      size: 3 * 1024,
      modified_at: '2026-10-08T12:31:07.123456Z',
    }),
    level: 1,
    expanded: false,
    loading: false,
    children: [],
  } as TreeNodeType;

  function mountFile(props: { showLabels?: boolean; show?: ValueColumn } = {}) {
    const target = document.createElement('div');
    document.body.appendChild(target);
    row = new TreeNode({ target, props: { node: FILE, ...props } });
    return {
      badges: () => [...target.querySelectorAll('.badge')].map((b) => b.textContent?.trim()),
      value: () => target.querySelector('[data-value-cell]')?.textContent?.trim(),
    };
  }

  it('shows its labels and its size', () => {
    const { badges, value } = mountFile();

    expect(badges()).toEqual(['gzip', 'idx']);
    expect(value()).toBe('3.0 KB');
  });

  it('shows no label with the labels off, and keeps its size', () => {
    const { badges, value } = mountFile({ showLabels: false });

    expect(badges()).toEqual([]);
    expect(value()).toBe('3.0 KB');
  });

  it('shows its time when the date is shown', () => {
    const { value } = mountFile({ show: 'date' });

    expect(value()).toBe(formatFileTime('2026-10-08T12:31:07.123456Z').text);
  });
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

describe('TreeNode of a folder in a chosen order', () => {
  /** An expanded node of `entry` holding `children`, at `level`. */
  function expanded(entry: TreeEntry, level: number, children: TreeNodeType[]): TreeNodeType {
    return { ...entry, expanded: true, loading: false, level, children };
  }

  function sizedFile(path: string, size: number): TreeNodeType {
    return expanded(treeEntry(path, 'file', { is_text: true, size }), 2, []);
  }

  // A folder holding a sub-folder and two files, the sub-folder holding
  // two more; by size each folder's files come in the reverse of their name order.
  const ROOT = expanded(treeEntry('/logs', 'directory'), 0, [
    sizedFile('/logs/app.log.10', 500),
    expanded(treeEntry('/logs/sub', 'directory'), 1, [
      sizedFile('/logs/sub/a.log', 1),
      sizedFile('/logs/sub/z.log', 900),
    ]),
    sizedFile('/logs/app.log.2', 10),
  ]);
  const BY_NAME = ['logs', 'sub', 'a.log', 'z.log', 'app.log.2', 'app.log.10'];
  const BY_SIZE = ['logs', 'sub', 'z.log', 'a.log', 'app.log.10', 'app.log.2'];

  function mountOrdered(sort: TreeSort) {
    const target = document.createElement('div');
    document.body.appendChild(target);
    row = new TreeNode({ target, props: { node: ROOT, sort } });
    return () =>
      [...target.querySelectorAll<HTMLElement>('[role="treeitem"]')].map(
        (item) => item.textContent?.trim().split(/\s/)[0],
      );
  }

  it('shows the rows of every open folder in the order it is given', () => {
    const shown = mountOrdered({ key: 'size', dir: 'desc' });

    expect(shown()).toEqual(BY_SIZE);
  });

  it('shows the rows in the new order when the order changes', async () => {
    const shown = mountOrdered({ key: 'size', dir: 'desc' });

    row?.$set({ sort: { key: 'name', dir: 'asc' } });
    await tick();

    expect(shown()).toEqual(BY_NAME);
  });
});

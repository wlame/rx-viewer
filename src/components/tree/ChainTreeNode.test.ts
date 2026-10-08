// @vitest-environment jsdom
import '$lib/testing/matchMediaStub';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { get } from 'svelte/store';
import { files, tree } from '$lib/stores';
import { indexChain } from '$lib/indexTasks';
import { FakeChain } from '$lib/testing/fakeChain';
import { treeEntry } from '$lib/testing/fakeLogDir';
import type { ChainEntry, TreeNode } from '$lib/types';
import type { ChainRow } from '$lib/utils/chainTree';
import { chainKey } from '$lib/utils/tabKey';
import ChainTreeNode from './ChainTreeNode.svelte';

vi.mock('$lib/indexTasks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/indexTasks')>()),
  indexChain: vi.fn(async () => ({ kind: 'completed' })),
}));

const DIR = '/l';
const HANDLE = `${DIR}/pkg.log`;

let mounted: ChainTreeNode | null = null;

function chainEntry(fields: Partial<ChainEntry> = {}): ChainEntry {
  return {
    path: HANDLE,
    name: 'pkg.log',
    parts: ['pkg.log.3.gz', 'pkg.log.1', 'pkg.log'],
    has_active: true,
    missing: ['pkg.log.2'],
    missing_count: 1,
    size: 2048,
    compression_formats: ['gzip'],
    is_indexed: false,
    unreadable: [],
    too_many_parts: false,
    ...fields,
  };
}

function partNode(name: string): TreeNode {
  const isGzip = name.endsWith('.gz');
  return {
    ...treeEntry(`${DIR}/${name}`, 'file', {
      is_text: true,
      is_compressed: isGzip,
      compression_format: isGzip ? 'gzip' : null,
      size: 100,
    }),
    expanded: false,
    loading: false,
    children: [],
    level: 2,
  };
}

function mount(chain: ChainEntry = chainEntry(), parts: TreeNode[] = []) {
  const row: ChainRow = { type: 'chain', key: chainKey(chain.path), chain, level: 1, parts };
  const target = document.createElement('div');
  document.body.appendChild(target);
  mounted = new ChainTreeNode({ target, props: { row } });
  const item = target.querySelector<HTMLElement>('[role="treeitem"]');
  if (!item) throw new Error('the chain row is not rendered');
  const badges = () =>
    [...target.querySelectorAll<HTMLElement>('[data-chain-badge]')].map((b) => ({
      text: b.textContent?.trim(),
      title: b.title,
    }));
  const menuItems = () =>
    [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].map((b) =>
      b.textContent?.trim(),
    );
  return { target, item, badges, menuItems };
}

async function openMenu(item: HTMLElement) {
  item.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  await tick();
}

async function choose(label: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
    (b) => b.textContent?.trim() === label,
  );
  if (!button) throw new Error(`no menu item ${label}`);
  button.click();
  await tick();
}

afterEach(() => {
  mounted?.$destroy();
  mounted = null;
  tree.selectPath(null);
  vi.restoreAllMocks();
  vi.mocked(indexChain).mockClear();
  document.body.replaceChildren();
});

describe('ChainTreeNode', () => {
  it('shows the name, the part count, the missing parts and the size', () => {
    const { item, badges } = mount();

    expect(item.textContent).toContain('pkg.log');
    expect(item.textContent).toContain('2.0 KB');
    expect(badges()).toEqual([
      { text: 'chain · 3', title: 'A log chain: 3 files of one rotated log, read as one' },
      { text: '1 missing', title: 'Missing parts: pkg.log.2' },
    ]);
  });

  it('shows idx, unreadable parts and too many parts', () => {
    const indexed = mount(chainEntry({ is_indexed: true, missing: [], missing_count: 0 }));
    expect(indexed.badges().map((b) => b.text)).toEqual(['chain · 3', 'idx']);
    mounted?.$destroy();

    const unreadable = mount(chainEntry({ unreadable: ['pkg.log.1'], missing_count: 0 }));
    expect(unreadable.badges().map((b) => b.text)).toEqual(['chain · 3', '1 unreadable']);
    mounted?.$destroy();

    const tooMany = mount(chainEntry({ parts: [], too_many_parts: true, missing_count: 0 }));
    expect(tooMany.badges().map((b) => b.text)).toEqual(['chain', 'too many parts']);
  });

  it('marks the chain invalid once a description said so, with its reasons', async () => {
    const { badges } = mount();
    const described = new FakeChain({
      dir: DIR,
      name: 'pkg.log',
      parts: [{ name: 'pkg.log', lines: 1, isActive: true }],
      state: 'invalid',
      reasons: [
        {
          code: 'no_timestamps',
          message: 'pkg.log has no timestamps',
          overlap_ms: null,
          parts: [],
        },
      ],
    }).description();

    tree.noteChainDescription(described);
    await tick();

    expect(badges().at(-1)).toEqual({ text: 'invalid', title: 'pkg.log has no timestamps' });
  });

  it("opens the chain's tab and selects its row on a click", async () => {
    const openChain = vi.spyOn(files, 'openChain').mockResolvedValue(true);
    const { item } = mount();

    item.click();
    await tick();

    expect(openChain).toHaveBeenCalledWith(HANDLE);
    expect(get(tree).selectedPath).toBe(chainKey(HANDLE));
    expect(item.getAttribute('aria-selected')).toBe('true');
  });

  it.each(['Enter', ' '])('opens the chain on %j', (key) => {
    const openChain = vi.spyOn(files, 'openChain').mockResolvedValue(true);
    const { item } = mount();

    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    item.dispatchEvent(event);

    expect(openChain).toHaveBeenCalledWith(HANDLE);
    expect(event.defaultPrevented).toBe(true);
  });

  it.each([
    [false, 'Index', false],
    [true, 'Re-index', true],
  ])(
    'offers an index item on a chain indexed=%s and builds its parts',
    async (isIndexed, label, reindex) => {
      const { item, menuItems } = mount(chainEntry({ is_indexed: isIndexed }));

      await openMenu(item);
      expect(menuItems()).toEqual([label]);
      await choose(label);

      expect(indexChain).toHaveBeenCalledWith(HANDLE, { reindex });
      expect(menuItems()).toEqual([]);
    },
  );

  it('keeps the browser menu on a chain of too many parts', async () => {
    const { item, menuItems } = mount(chainEntry({ parts: [], too_many_parts: true }));

    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    item.dispatchEvent(event);
    await tick();

    expect(event.defaultPrevented).toBe(false);
    expect(menuItems()).toEqual([]);
  });

  it('lists the parts under the chain, read-only, when they are given', () => {
    const openFile = vi.spyOn(files, 'openFile').mockResolvedValue();
    const openChain = vi.spyOn(files, 'openChain').mockResolvedValue(true);
    const parts = ['pkg.log.3.gz', 'pkg.log.1', 'pkg.log'].map(partNode);
    const { target } = mount(chainEntry(), parts);

    const rows = [...target.querySelectorAll<HTMLElement>('[data-chain-part]')];
    expect(rows.map((row) => row.dataset.chainPart)).toEqual([
      'pkg.log.3.gz',
      'pkg.log.1',
      'pkg.log',
    ]);
    expect(rows.every((row) => row.getAttribute('aria-disabled') === 'true')).toBe(true);

    rows[1].click();
    expect(openFile).not.toHaveBeenCalled();
    expect(openChain).not.toHaveBeenCalled();
  });
});

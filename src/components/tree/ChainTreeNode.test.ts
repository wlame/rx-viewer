// @vitest-environment jsdom
import '$lib/testing/matchMediaStub';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { get } from 'svelte/store';
import { files, tree } from '$lib/stores';
import { indexChain } from '$lib/indexTasks';
import { FakeChain } from '$lib/testing/fakeChain';
import type { ChainEntry } from '$lib/types';
import type { ChainRow } from '$lib/utils/chainTree';
import { formatFileTime } from '$lib/utils/format';
import { chainKey } from '$lib/utils/tabKey';
import type { ValueColumn } from '$lib/utils/urlState';
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

/** What the files panel gives a chain row besides the chain. */
interface RowView {
  modifiedAt?: string | null;
  showLabels?: boolean;
  show?: ValueColumn;
}

function mount(chain: ChainEntry = chainEntry(), view: RowView = {}) {
  const row: ChainRow = {
    type: 'chain',
    key: chainKey(chain.path),
    chain,
    level: 1,
    modifiedAt: view.modifiedAt ?? null,
  };
  const target = document.createElement('div');
  document.body.appendChild(target);
  const props = {
    row,
    ...(view.showLabels === undefined ? {} : { showLabels: view.showLabels }),
    ...(view.show === undefined ? {} : { show: view.show }),
  };
  mounted = new ChainTreeNode({ target, props });
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
  const value = () => item.querySelector<HTMLElement>('[data-value-cell]')?.textContent?.trim();
  return { target, item, badges, menuItems, value };
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

  it('shows no mark with the labels off, and keeps its size', () => {
    const { badges, value } = mount(chainEntry(), { showLabels: false });

    expect(badges()).toEqual([]);
    expect(value()).toBe('2.0 KB');
  });

  it('shows the newest time of its parts when the date is shown', () => {
    const modifiedAt = '2026-10-08T12:31:07.123456Z';

    const { value } = mount(chainEntry(), { modifiedAt, show: 'date' });

    expect(value()).toBe(formatFileTime(modifiedAt).text);
  });

  it('shows no time when no part has one, and no size for a chain of too many parts', () => {
    expect(mount(chainEntry(), { show: 'date' }).value()).toBe('');
    mounted?.$destroy();

    const tooMany = chainEntry({ parts: [], too_many_parts: true, missing_count: 0 });
    expect(mount(tooMany).value()).toBe('');
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

  // Enter on a chain's row is the tree's key (FileTreeKeyboard.test.ts).
  it.each(['Enter', ' '])('leaves %j to the tree that holds the row', (key) => {
    const openChain = vi.spyOn(files, 'openChain').mockResolvedValue(true);
    const { item } = mount();

    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    item.dispatchEvent(event);

    expect(openChain).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
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
});

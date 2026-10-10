// @vitest-environment jsdom
import '$lib/testing/matchMediaStub';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { get } from 'svelte/store';
import { TOOLTIP_DELAY_MS, TOOLTIP_ID } from '$lib/actions/tooltip';
import { health, tree } from '$lib/stores';
import { chainMode } from '$lib/stores/chainMode';
import { DEFAULT_FILES_VIEW, filesView } from '$lib/stores/filesView';
import { treeFocusRequested } from '$lib/stores/layout';
import type { TreeEntry } from '$lib/types';
import {
  CHAIN_NAMES,
  LOG_DIR,
  LOG_FILE_TIME,
  LOG_ROOT,
  LogDirBackend,
  logDirChains,
  serveLogDir,
  treeEntry,
} from '$lib/testing/fakeLogDir';
import { isChainRow, shownChildren } from '$lib/utils/chainTree';
import { formatFileTime, formatSize } from '$lib/utils/format';
import type { TreeSort } from '$lib/utils/treeSort';
import FileTree from './FileTree.svelte';

let mounted: FileTree | null = null;

async function mount(features: string[], backend = new LogDirBackend({ features })) {
  serveLogDir(backend);
  await health.check();
  const target = document.createElement('div');
  document.body.appendChild(target);
  mounted = new FileTree({ target });
  await tick();
  return { target };
}

/** A backend whose search roots are `roots`, in that order, each an empty folder. */
function serveRoots(roots: string[]) {
  const answer = (body: unknown) => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
  const listing = (path: string, entries: TreeEntry[], isRoot: boolean) => ({
    path,
    parent: null,
    is_search_root: isRoot,
    entries,
    total_entries: entries.length,
    total_size: null,
    total_size_human: null,
  });
  vi.stubGlobal('fetch', async (url: string) => {
    const parsed = new URL(url, 'http://localhost');
    if (parsed.pathname === '/health') return answer({ contract_version: '1.7', features: [] });
    const path = parsed.searchParams.get('path');
    if (path !== null) return answer(listing(path, [], false));
    const entries = roots.map((root) => treeEntry(root, 'directory', { children_count: 0 }));
    return answer(listing('', entries, true));
  });
}

/** The tree row of `path`. */
function rowOf(target: HTMLElement, path: string): HTMLElement | undefined {
  const name = path.split('/').pop();
  return [...target.querySelectorAll<HTMLElement>('[role="treeitem"]')].find((row) =>
    row.textContent?.includes(name ?? ''),
  );
}

/** Let the reactive focus request run, then the tick it waits for. */
async function settle() {
  await tick();
  await tick();
}

afterEach(() => {
  mounted?.$destroy();
  mounted = null;
  chainMode.set(false);
  filesView.set(DEFAULT_FILES_VIEW);
  tree.selectPath(null);
  treeFocusRequested.set(false);
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

/** The log directory in the panel, expanded, in chain mode or not. */
async function mountLogDir(mode: boolean) {
  const mounted = await mount(['log_chains']);
  chainMode.set(mode);
  await tree.loadRoots();
  await tree.toggleExpanded(LOG_DIR);
  await tick();
  const { target } = mounted;
  return {
    target,
    labelsButton: () => target.querySelector<HTMLButtonElement>('button[aria-label="Show labels"]'),
    dateButton: () =>
      [...target.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(
        (radio) => radio.textContent?.trim() === 'Date',
      ),
    fileBadges: () => target.querySelectorAll('[role="tree"] .badge:not([data-chain-badge])'),
    chainBadges: () => target.querySelectorAll('[data-chain-badge]'),
  };
}

/** The value cell of the tree row of `path`, or of the chain row named `chain`. */
function valueOf(target: HTMLElement, row: { path?: string; chain?: string }): HTMLElement | null {
  const item = row.chain
    ? target.querySelector<HTMLElement>(`[data-chain="${row.chain}"]`)
    : rowOf(target, row.path ?? '');
  return item?.querySelector<HTMLElement>('[data-value-cell]') ?? null;
}

describe('the labels of the files panel', () => {
  it('hides every badge of the file rows with Show labels, and brings them back', async () => {
    const { labelsButton, fileBadges } = await mountLogDir(false);
    const shown = fileBadges().length;
    expect(shown).toBeGreaterThan(0);

    labelsButton()?.click();
    await tick();
    expect(fileBadges()).toHaveLength(0);

    labelsButton()?.click();
    await tick();
    expect(fileBadges()).toHaveLength(shown);
  });

  it('hides every badge of the chain rows with Show labels, and brings them back', async () => {
    const { labelsButton, chainBadges } = await mountLogDir(true);
    const shown = chainBadges().length;
    expect(shown).toBeGreaterThanOrEqual(CHAIN_NAMES.length);

    labelsButton()?.click();
    await tick();
    expect(chainBadges()).toHaveLength(0);

    labelsButton()?.click();
    await tick();
    expect(chainBadges()).toHaveLength(shown);
  });

  it('keeps the value and the dimmed name of a file that is not text', async () => {
    const { target, labelsButton } = await mountLogDir(false);
    const path = `${LOG_DIR}/failures`;

    labelsButton()?.click();
    await tick();

    const name = rowOf(target, path)?.querySelector('span.truncate');
    expect(name?.className).toContain('opacity-50');
    expect(valueOf(target, { path })?.textContent?.trim()).toBe(
      formatSize(tree.nodeAt(path)?.size ?? -1),
    );
  });
});

describe('the value column of the files panel', () => {
  it("shows a file's size, a folder's item count and a chain's size", async () => {
    const { target } = await mountLogDir(true);
    const chain = logDirChains().find((c) => c.name === 'pkg.log');

    expect(valueOf(target, { path: `${LOG_DIR}/fonts.log` })?.textContent?.trim()).toBe(
      formatSize(tree.nodeAt(`${LOG_DIR}/fonts.log`)?.size ?? -1),
    );
    expect(valueOf(target, { path: `${LOG_DIR}/pkgcache` })?.textContent?.trim()).toBe('0 items');
    expect(valueOf(target, { path: LOG_ROOT })?.textContent?.trim()).toBe('1 item');
    expect(valueOf(target, { chain: 'pkg.log' })?.textContent?.trim()).toBe(
      formatSize(chain?.size ?? -1),
    );
  });

  it("shows a file's and a chain's time once Date is chosen, and nothing for a folder without one", async () => {
    const { target, dateButton } = await mountLogDir(true);

    dateButton()?.click();
    await tick();

    const shown = formatFileTime(LOG_FILE_TIME).text;
    expect(valueOf(target, { path: `${LOG_DIR}/fonts.log` })?.textContent?.trim()).toBe(shown);
    expect(valueOf(target, { chain: 'pkg.log' })?.textContent?.trim()).toBe(shown);
    expect(valueOf(target, { path: `${LOG_DIR}/pkgcache` })?.textContent?.trim()).toBe('');
  });

  it('spells the time out in full in the tooltip of its cell', async () => {
    const { target, dateButton } = await mountLogDir(false);
    dateButton()?.click();
    await tick();
    const cell = valueOf(target, { path: `${LOG_DIR}/fonts.log` });

    vi.useFakeTimers();
    try {
      cell?.dispatchEvent(new MouseEvent('mouseenter'));
      vi.advanceTimersByTime(TOOLTIP_DELAY_MS);
    } finally {
      vi.useRealTimers();
    }

    expect(document.getElementById(TOOLTIP_ID)?.textContent).toBe(
      formatFileTime(LOG_FILE_TIME).full,
    );
  });
});

describe('the order of the files panel', () => {
  /** The names of the rows under `LOG_DIR`, in the order the page shows them. */
  function shownUnderLogDir(target: HTMLElement): string[] {
    const rows = [...target.querySelectorAll<HTMLElement>('[role="treeitem"]')];
    const logDir = rows.findIndex((row) => row.textContent?.trim().startsWith('logs'));
    return rows
      .slice(logDir + 1)
      .map(
        (row) => row.dataset.chain ?? row.querySelector('span.truncate')?.textContent?.trim() ?? '',
      );
  }

  /** The names `shownChildren` gives the rows of `LOG_DIR`, a chain's by its name. */
  function expectedUnderLogDir(chainModeOn: boolean, sort: TreeSort): string[] {
    const dir = tree.nodeAt(LOG_DIR);
    if (!dir) throw new Error(`${LOG_DIR} is not in the tree`);
    return shownChildren(dir, { chainModeOn, sort }).map((row) =>
      isChainRow(row) ? row.chain.name : row.name,
    );
  }

  it.each([
    [false, { key: 'size', dir: 'desc' }],
    [false, { key: 'name', dir: 'desc' }],
    [true, { key: 'size', dir: 'asc' }],
    [true, { key: 'name', dir: 'desc' }],
  ] as const)('shows the rows (chain mode %s) in the order %o', async (mode, sort) => {
    const { target } = await mountLogDir(mode);

    filesView.update((view) => ({ ...view, sort }));
    await tick();

    const shown = shownUnderLogDir(target);
    expect(shown).toEqual(expectedUnderLogDir(mode, sort));
    expect(shown).not.toEqual(expectedUnderLogDir(mode, DEFAULT_FILES_VIEW.sort));
  });

  it('shows the rows by size, largest first, when the Size header is clicked', async () => {
    const { target } = await mountLogDir(true);

    target.querySelector<HTMLButtonElement>('button[aria-label="Sort by size"]')?.click();
    await tick();

    expect(shownUnderLogDir(target)).toEqual(
      expectedUnderLogDir(true, { key: 'size', dir: 'desc' }),
    );
  });

  it('has its column header under the toolbar and outside the tree', async () => {
    const { target } = await mountLogDir(false);
    const toolbar = target.querySelector('h2');
    const header = target.querySelector('button[aria-label^="Sort by name"]');
    const fileTree = target.querySelector('[role="tree"]');
    if (!toolbar || !header || !fileTree) throw new Error('the files panel is not rendered');

    expect(header.closest('[role="tree"]')).toBeNull();
    expect(toolbar.compareDocumentPosition(header) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      header.compareDocumentPosition(fileTree) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('keeps the search roots in their configured order', async () => {
    serveRoots(['/zeta', '/alpha', '/mid']);
    await health.check();
    const target = document.createElement('div');
    document.body.appendChild(target);
    mounted = new FileTree({ target });
    await tree.loadRoots();
    await tick();
    const roots = () =>
      [...target.querySelectorAll<HTMLElement>('[role="tree"] > div > [role="treeitem"]')].map(
        (row) => row.querySelector('span.truncate')?.textContent?.trim(),
      );

    expect(roots()).toEqual(['zeta', 'alpha', 'mid']);

    filesView.update((view) => ({ ...view, sort: { key: 'name', dir: 'desc' } }));
    await tick();

    expect(roots()).toEqual(['zeta', 'alpha', 'mid']);
  });
});

describe('the focus request of the files panel', () => {
  it('focuses the selected row and resets the request', async () => {
    const { target } = await mount([]);
    await tree.loadRoots();
    tree.selectPath(LOG_DIR);
    await tick();

    treeFocusRequested.set(true);
    await settle();

    expect(document.activeElement).toBe(rowOf(target, LOG_DIR));
    expect(rowOf(target, LOG_DIR)?.getAttribute('aria-selected')).toBe('true');
    expect(get(treeFocusRequested)).toBe(false);
  });

  it('focuses the first row when no row is selected', async () => {
    const { target } = await mount([]);
    await tree.loadRoots();
    await tick();

    treeFocusRequested.set(true);
    await settle();

    expect(document.activeElement).toBe(target.querySelector('[role="treeitem"]'));
    expect(document.activeElement).toBe(rowOf(target, LOG_ROOT));
  });

  it('waits for the roots when the request comes while they load', async () => {
    const backend = new LogDirBackend({ features: [] });
    backend.hold('/v1/tree');
    const { target } = await mount([], backend);
    const loading = tree.loadRoots();
    await tick();

    treeFocusRequested.set(true);
    await settle();
    expect(get(treeFocusRequested)).toBe(true);

    backend.release();
    await loading;
    await settle();

    expect(document.activeElement).toBe(rowOf(target, LOG_ROOT));
    expect(get(treeFocusRequested)).toBe(false);
  });
});

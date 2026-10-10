// @vitest-environment jsdom
import '$lib/testing/matchMediaStub';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { get } from 'svelte/store';
import { files, health, tree } from '$lib/stores';
import { chainMode } from '$lib/stores/chainMode';
import { DEFAULT_FILES_VIEW, filesView } from '$lib/stores/filesView';
import { editorFocusRequested, registerModal, shortcutsHelpOpen } from '$lib/stores/layout';
import { treeFocus, treeRows } from '$lib/stores/treeFocus';
import { LOG_DIR, LOG_ROOT, LogDirBackend, serveLogDir } from '$lib/testing/fakeLogDir';
import { chainKey } from '$lib/utils/tabKey';
import { visibleRows } from '$lib/utils/treeRows';
import type { TreeSort } from '$lib/utils/treeSort';
import KeyboardShortcuts from '../common/KeyboardShortcuts.svelte';
import FileTree from './FileTree.svelte';

const FONTS = `${LOG_DIR}/fonts.log`;
/** A part of the chain `pkg.log`, and the chain's row. */
const PART = `${LOG_DIR}/pkg.log.1`;
const PKG_CHAIN = chainKey(`${LOG_DIR}/pkg.log`);

let mounted: FileTree | null = null;

/** The files panel over `backend`, its roots loaded; chain mode as `chains` says. */
async function mountTree(options: { chains?: boolean; backend?: LogDirBackend } = {}) {
  const backend = options.backend ?? new LogDirBackend();
  serveLogDir(backend);
  await health.check();
  chainMode.set(options.chains ?? false);
  const target = document.createElement('div');
  document.body.appendChild(target);
  mounted = new FileTree({ target });
  await tree.loadRoots();
  await tick();
  return { target, backend };
}

/** Open the log directory, as a click on its row does. */
async function openLogDir() {
  await tree.toggleExpanded(LOG_DIR);
  await tick();
}

function rowsOf(target: HTMLElement): HTMLElement[] {
  return [...target.querySelectorAll<HTMLElement>('[role="treeitem"]')];
}

function rowOf(target: HTMLElement, id: string): HTMLElement {
  const row = rowsOf(target).find((candidate) => candidate.dataset.rowId === id);
  if (!row) throw new Error(`the tree shows no row ${id}`);
  return row;
}

/** The ids of the rows a Tab reaches: those with `tabindex="0"`. */
function tabStops(target: HTMLElement): string[] {
  return rowsOf(target)
    .filter((row) => row.getAttribute('tabindex') === '0')
    .map((row) => row.dataset.rowId ?? '');
}

function focusRow(target: HTMLElement, id: string): HTMLElement {
  const row = rowOf(target, id);
  row.focus();
  return row;
}

/** The `code` a browser sends with a key that is not a letter. */
const KEY_CODES: Readonly<Record<string, string>> = { ' ': 'Space' };

/** A key press on `target` as a browser sends it, with `code` from the key. */
function press(target: EventTarget, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const code = KEY_CODES[key] ?? (key.length === 1 ? `Key${key.toUpperCase()}` : key);
  const event = new KeyboardEvent('keydown', {
    key,
    code,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

/** How many times the backend was asked for the listing of `path`. */
function listingsOf(backend: LogDirBackend, path: string): number {
  return backend
    .requestsTo('/v1/tree')
    .filter((request) => new URLSearchParams(request.split('?')[1]).get('path') === path).length;
}

beforeEach(() => {
  // jsdom lays nothing out and has no scrollIntoView.
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  mounted?.$destroy();
  mounted = null;
  for (const file of get(files).openFiles) files.closeFile(file.path);
  chainMode.set(false);
  filesView.set(DEFAULT_FILES_VIEW);
  tree.selectPath(null);
  treeFocus.set(null);
  editorFocusRequested.set(false);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('the file tree by keyboard', () => {
  it('has one Tab stop, on the first row before any row had the focus', async () => {
    const { target } = await mountTree();
    await openLogDir();

    expect(tabStops(target)).toEqual([LOG_ROOT]);
    expect(rowsOf(target).length).toBeGreaterThan(20);
  });

  it('keeps the Tab stop on the row focused last, so Tab into the tree lands there', async () => {
    const { target } = await mountTree();
    await openLogDir();
    const outside = document.body.appendChild(document.createElement('button'));

    focusRow(target, FONTS);
    outside.focus();
    await tick();

    expect(get(treeFocus)).toBe(FONTS);
    expect(tabStops(target)).toEqual([FONTS]);
  });

  it('moves the focus and the Tab stop to the next row on ↓, and scrolls it into view', async () => {
    const { target } = await mountTree();
    const root = focusRow(target, LOG_ROOT);

    const event = press(root, 'ArrowDown');
    await tick();

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(rowOf(target, LOG_DIR));
    expect(tabStops(target)).toEqual([LOG_DIR]);
    expect(rowOf(target, LOG_DIR).scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
  });

  it('leaves ↓ on the last row to the browser', async () => {
    const { target } = await mountTree();
    const last = focusRow(target, LOG_DIR);

    const event = press(last, 'ArrowDown');

    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(last);
  });

  it('opens a folder on →, goes into it on → again, and back out and shut on ← ←', async () => {
    const { target } = await mountTree();
    const folder = focusRow(target, LOG_DIR);

    press(folder, 'ArrowRight');
    await vi.waitFor(() => expect(tree.nodeAt(LOG_DIR)?.expanded).toBe(true));
    await tick();
    expect(document.activeElement).toBe(folder);

    press(folder, 'ArrowRight');
    const firstChild = `${LOG_DIR}/cache`;
    expect(document.activeElement).toBe(rowOf(target, firstChild));

    press(rowOf(target, firstChild), 'ArrowLeft');
    expect(document.activeElement).toBe(folder);
    press(folder, 'ArrowLeft');
    await tick();
    expect(tree.nodeAt(LOG_DIR)?.expanded).toBe(false);
    expect(document.activeElement).toBe(folder);
  });

  it('opens and closes a folder on Space and Enter', async () => {
    const { target } = await mountTree();
    await openLogDir();
    const folder = focusRow(target, LOG_DIR);

    expect(press(folder, ' ').defaultPrevented).toBe(true);
    await tick();
    expect(tree.nodeAt(LOG_DIR)?.expanded).toBe(false);

    expect(press(folder, 'Enter').defaultPrevented).toBe(true);
    await tick();
    expect(tree.nodeAt(LOG_DIR)?.expanded).toBe(true);
  });

  it('goes to the first and the last row on Home and End', async () => {
    const { target } = await mountTree();
    await openLogDir();
    const rows = get(treeRows);

    press(focusRow(target, FONTS), 'End');
    expect(document.activeElement).toBe(rowOf(target, rows[rows.length - 1].id));

    press(document.activeElement as HTMLElement, 'Home');
    expect(document.activeElement).toBe(rowOf(target, LOG_ROOT));
  });

  it('moves a page of one row on PageDown when no row height is known', async () => {
    const { target } = await mountTree();

    const event = press(focusRow(target, LOG_ROOT), 'PageDown');

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(rowOf(target, LOG_DIR));
  });

  it('opens a file on Enter as a click does, and keeps the focus on its row', async () => {
    const { target } = await mountTree();
    await openLogDir();
    const openFile = vi.spyOn(files, 'openFile').mockResolvedValue(undefined);
    rowOf(target, FONTS).click();
    const byClick = openFile.mock.calls[0];
    openFile.mockClear();
    tree.selectPath(null);

    const row = focusRow(target, FONTS);
    const event = press(row, 'Enter');

    expect(event.defaultPrevented).toBe(true);
    expect(openFile.mock.calls).toEqual([byClick]);
    expect(byClick[0]).toBe(FONTS);
    expect(get(tree).selectedPath).toBe(FONTS);
    expect(document.activeElement).toBe(row);
  });

  it("opens a chain's tab on Enter", async () => {
    const { target } = await mountTree({ chains: true });
    await openLogDir();
    const openChain = vi.spyOn(files, 'openChain').mockResolvedValue(true);

    const event = press(focusRow(target, PKG_CHAIN), 'Enter');

    expect(event.defaultPrevented).toBe(true);
    expect(openChain).toHaveBeenCalledWith(`${LOG_DIR}/pkg.log`);
    expect(get(tree).selectedPath).toBe(PKG_CHAIN);
  });

  it('goes to the row whose name starts with the letters typed', async () => {
    const { target } = await mountTree();
    await openLogDir();
    const root = focusRow(target, LOG_ROOT);

    const f = press(root, 'f');
    const o = press(document.activeElement as HTMLElement, 'o');

    expect([f.defaultPrevented, o.defaultPrevented]).toEqual([true, true]);
    expect(document.activeElement).toBe(rowOf(target, FONTS));
  });

  it('asks for the editor on Esc while a file is open', async () => {
    const { target } = await mountTree();
    await openLogDir();
    await files.openFile(FONTS);

    const event = press(focusRow(target, FONTS), 'Escape');

    expect(event.defaultPrevented).toBe(true);
    expect(get(editorFocusRequested)).toBe(true);
  });

  it('leaves Esc alone with no open file', async () => {
    const { target } = await mountTree();

    const event = press(focusRow(target, LOG_DIR), 'Escape');

    expect(event.defaultPrevented).toBe(false);
    expect(get(editorFocusRequested)).toBe(false);
  });

  it('leaves Esc to an open dialog', async () => {
    const { target } = await mountTree();
    await openLogDir();
    await files.openFile(FONTS);
    const release = registerModal();
    try {
      const event = press(focusRow(target, FONTS), 'Escape');

      expect(event.defaultPrevented).toBe(false);
      expect(get(editorFocusRequested)).toBe(false);
    } finally {
      release();
    }
  });
});

describe('the keys the tree leaves alone', () => {
  // A dialog that does not take the focus can leave it on a row: the
  // row's keys are the dialog's then, and the browser's.
  it.each(['ArrowDown', ' ', 'Enter'])('leaves %j to an open dialog', async (key) => {
    const { target } = await mountTree();
    await openLogDir();
    const openFile = vi.spyOn(files, 'openFile');
    const row = focusRow(target, FONTS);
    const release = registerModal();
    try {
      const event = press(row, key);
      await tick();

      expect(event.defaultPrevented).toBe(false);
      expect(document.activeElement).toBe(row);
      expect(get(treeFocus)).toBe(FONTS);
      expect(openFile).not.toHaveBeenCalled();
    } finally {
      release();
    }
  });

  it.each([
    ['ArrowDown', { ctrlKey: true }],
    ['ArrowDown', { metaKey: true }],
    ['ArrowDown', { altKey: true }],
    ['End', { metaKey: true }],
    ['Enter', { ctrlKey: true }],
    ['f', { metaKey: true }],
    ['Escape', { altKey: true }],
    ['ArrowDown', { isComposing: true }],
  ])('leaves %j with %o to the shortcut table and the browser', async (key, init) => {
    const { target } = await mountTree();
    await openLogDir();
    await files.openFile(FONTS);
    const openFile = vi.spyOn(files, 'openFile');
    const row = focusRow(target, FONTS);

    const event = press(row, key, init);

    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(row);
    expect(openFile).not.toHaveBeenCalled();
    expect(get(editorFocusRequested)).toBe(false);
  });

  it('lets Alt+G reach the files panel keys from a row', async () => {
    const { target } = await mountTree();
    await openLogDir();
    const row = focusRow(target, FONTS);

    press(row, '©', { code: 'KeyG', altKey: true });

    expect(get(chainMode)).toBe(true);
    expect(get(treeFocus)).toBe(FONTS);
  });

  it("leaves the keys of a row's menu to the menu", async () => {
    const { target } = await mountTree();
    await openLogDir();
    const row = focusRow(target, FONTS);
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    await tick();
    const item = target.querySelector<HTMLButtonElement>('[role="menuitem"]');
    if (!item) throw new Error('the row has no menu');
    item.focus();

    const event = press(item, 'ArrowDown');

    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(item);
    expect(get(treeFocus)).toBe(FONTS);
  });
});

describe('the focused row going away', () => {
  it('moves the focus to the chain row when chain mode turns on while one of its parts is focused', async () => {
    const { target } = await mountTree();
    await openLogDir();
    focusRow(target, PART);

    chainMode.set(true);
    await vi.waitFor(() => expect(get(treeFocus)).toBe(PKG_CHAIN));
    await tick();

    expect(document.activeElement).toBe(rowOf(target, PKG_CHAIN));
    expect(tabStops(target)).toEqual([PKG_CHAIN]);
  });

  it("moves the focus to the active file's row when chain mode turns off on a chain row", async () => {
    const { target } = await mountTree({ chains: true });
    await openLogDir();
    focusRow(target, PKG_CHAIN);

    chainMode.set(false);
    await tick();
    await tick();

    expect(document.activeElement).toBe(rowOf(target, `${LOG_DIR}/pkg.log`));
    expect(tabStops(target)).toEqual([`${LOG_DIR}/pkg.log`]);
  });

  // Chromium sends focusout from a focused element it removes; jsdom sends
  // none. The row's focus must come back all the same.
  it('gives the focus back after the browser drops it from the row it removes', async () => {
    const { target } = await mountTree({ chains: true });
    await openLogDir();
    const chainRow = focusRow(target, PKG_CHAIN);

    chainRow.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
    chainMode.set(false);
    await tick();
    await tick();

    expect(document.activeElement).toBe(rowOf(target, `${LOG_DIR}/pkg.log`));
  });

  // Turning chain mode off removes the chain row before the tree looks at
  // its rows, as in the case above; a focus the row lost before stays lost.
  it('leaves the focus where a click on no control put it', async () => {
    const { target } = await mountTree({ chains: true });
    await openLogDir();
    focusRow(target, PKG_CHAIN).blur();
    await tick();

    chainMode.set(false);
    await tick();
    await tick();

    expect(document.activeElement).toBe(document.body);
    expect(tabStops(target)).toEqual([`${LOG_DIR}/pkg.log`]);
  });

  it('moves the focus to the folder a click closes while one of its rows is focused', async () => {
    const { target } = await mountTree();
    await openLogDir();
    focusRow(target, FONTS);

    rowOf(target, LOG_DIR).click();
    await tick();
    await tick();

    expect(get(treeFocus)).toBe(LOG_DIR);
    expect(document.activeElement).toBe(rowOf(target, LOG_DIR));
    expect(tabStops(target)).toEqual([LOG_DIR]);
  });

  it('moves the focus to the folder of a focused file that a new listing drops', async () => {
    const { target, backend } = await mountTree();
    await openLogDir();
    focusRow(target, FONTS);

    backend.hide(FONTS);
    await tree.loadDirectory(LOG_DIR);
    await tick();
    await tick();

    expect(rowsOf(target).some((row) => row.dataset.rowId === FONTS)).toBe(false);
    expect(document.activeElement).toBe(rowOf(target, LOG_DIR));
    expect(tabStops(target)).toEqual([LOG_DIR]);
  });

  it('moves the Tab stop without taking the focus when the tree did not have it', async () => {
    const { target } = await mountTree();
    await openLogDir();
    const outside = document.body.appendChild(document.createElement('button'));
    focusRow(target, FONTS);
    outside.focus();

    await tree.toggleExpanded(LOG_DIR);
    await tick();
    await tick();

    expect(document.activeElement).toBe(outside);
    expect(tabStops(target)).toEqual([LOG_DIR]);
  });
});

describe('a new order of the rows', () => {
  /** The place of the row `id` among the rows drawn. */
  function placeOf(target: HTMLElement, id: string): number {
    return rowsOf(target).findIndex((row) => row.dataset.rowId === id);
  }

  /** The rows `scrollIntoView` was called on. */
  function scrolledRows(): unknown[] {
    return vi.mocked(Element.prototype.scrollIntoView).mock.contexts;
  }

  const SIZE_DESC: TreeSort = { key: 'size', dir: 'desc' };

  // A keyed list moves a row by taking it out and putting it back, which
  // takes the focus from it; the tree gives it back.
  it.each([
    [
      'Alt+N',
      DEFAULT_FILES_VIEW.sort,
      (row: HTMLElement) => press(row, 'Dead', { code: 'KeyN', altKey: true }),
    ],
    [
      'Alt+S',
      DEFAULT_FILES_VIEW.sort,
      (row: HTMLElement) => press(row, 'ß', { code: 'KeyS', altKey: true }),
    ],
    [
      'Alt+V on a size sort',
      SIZE_DESC,
      (row: HTMLElement) => press(row, '√', { code: 'KeyV', altKey: true }),
    ],
    [
      'a click on the Size header',
      DEFAULT_FILES_VIEW.sort,
      (row: HTMLElement) =>
        row.ownerDocument
          .querySelector<HTMLButtonElement>('button[aria-label="Sort by size"]')
          ?.click(),
    ],
  ] as const)(
    'keeps the focus on the focused row through %s, and scrolls the row into view',
    async (_name, sort, act) => {
      const { target } = await mountTree();
      filesView.set({ ...DEFAULT_FILES_VIEW, sort });
      await openLogDir();
      const row = focusRow(target, FONTS);
      const placeBefore = placeOf(target, FONTS);

      act(row);
      await tick();
      await tick();

      expect(placeOf(target, FONTS)).not.toBe(placeBefore);
      expect(document.activeElement).toBe(rowOf(target, FONTS));
      expect(tabStops(target)).toEqual([FONTS]);
      expect(scrolledRows()).toContain(rowOf(target, FONTS));
    },
  );

  it('keeps the focus on the focused row through Alt+L, which moves no row', async () => {
    const { target } = await mountTree();
    await openLogDir();
    const row = focusRow(target, FONTS);

    press(row, '¬', { code: 'KeyL', altKey: true });
    await tick();
    await tick();

    expect(get(filesView).labels).toBe(false);
    expect(document.activeElement).toBe(row);
  });

  it('leaves the focus on another control when the order changes', async () => {
    const { target } = await mountTree();
    await openLogDir();
    focusRow(target, FONTS);
    const outside = document.body.appendChild(document.createElement('button'));
    outside.focus();
    await tick();

    filesView.set({ ...DEFAULT_FILES_VIEW, sort: SIZE_DESC });
    await tick();
    await tick();

    expect(document.activeElement).toBe(outside);
  });
});

describe('→ on a folder that is loading or fails to load', () => {
  it('keeps the focus on a folder whose rows are loading, asks once, and goes in once they arrive', async () => {
    const { target, backend } = await mountTree();
    const folder = focusRow(target, LOG_DIR);
    backend.hold('/v1/tree');

    const first = press(folder, 'ArrowRight');
    await vi.waitFor(() => expect(listingsOf(backend, LOG_DIR)).toBe(1));
    const second = press(folder, 'ArrowRight');
    await tick();

    expect(first.defaultPrevented).toBe(true);
    expect(second.defaultPrevented).toBe(false);
    expect(listingsOf(backend, LOG_DIR)).toBe(1);
    expect(document.activeElement).toBe(folder);

    backend.release();
    await vi.waitFor(() => expect(tree.nodeAt(LOG_DIR)?.expanded).toBe(true));
    await tick();
    press(folder, 'ArrowRight');

    const rows = get(treeRows);
    const firstChild = rows[rows.findIndex((row) => row.id === LOG_DIR) + 1];
    expect(firstChild.parentId).toBe(LOG_DIR);
    expect(document.activeElement).toBe(rowOf(target, firstChild.id));
  });

  it('keeps the current row through a load that fails, asks once, and shows the error', async () => {
    const backend = new LogDirBackend({ failingDirs: [LOG_DIR] });
    const { target } = await mountTree({ backend });
    const folder = focusRow(target, LOG_DIR);

    const event = press(folder, 'ArrowRight');
    await vi.waitFor(() => expect(get(tree).error).not.toBeNull());
    await tick();

    expect(event.defaultPrevented).toBe(true);
    expect(listingsOf(backend, LOG_DIR)).toBe(1);
    expect(get(treeFocus)).toBe(LOG_DIR);
    expect(target.querySelector('[role="tree"]')?.textContent).toContain('Failed to load');

    await tree.loadRoots();
    await tick();
    expect(tabStops(target)).toEqual([LOG_DIR]);
  });
});

describe('the rows the tree draws', () => {
  it.each([
    { key: 'date', dir: 'desc' },
    { key: 'size', dir: 'asc' },
  ] satisfies TreeSort[])(
    'are the visible rows in order, chain mode on, sorted %o',
    async (sort) => {
      const { target } = await mountTree({ chains: true });
      filesView.set({ ...DEFAULT_FILES_VIEW, show: sort.key === 'date' ? 'date' : 'size', sort });
      await openLogDir();
      await tree.toggleExpanded(`${LOG_DIR}/cache`);
      await tick();

      const shown = rowsOf(target).map((row) => row.dataset.rowId);
      const byName = visibleRows(get(tree).roots, {
        chainModeOn: true,
        sort: DEFAULT_FILES_VIEW.sort,
      }).map((r) => r.id);

      // The order must differ from the name order, or a tree that ignores
      // the sort would pass.
      expect(shown).not.toEqual(byName);
      expect(shown).toEqual(
        visibleRows(get(tree).roots, { chainModeOn: true, sort }).map((r) => r.id),
      );
      expect(shown).toEqual(get(treeRows).map((row) => row.id));
      expect(shown).toContain(PKG_CHAIN);
      expect(shown).not.toContain(PART);
    },
  );

  it('give each row the level, set size and place of its visible row', async () => {
    const { target } = await mountTree({ chains: true });
    await openLogDir();

    const shown = rowsOf(target).map((row) => ({
      id: row.dataset.rowId,
      level: Number(row.getAttribute('aria-level')) - 1,
      setSize: Number(row.getAttribute('aria-setsize')),
      posInSet: Number(row.getAttribute('aria-posinset')),
    }));

    expect(shown).toEqual(
      get(treeRows).map(({ id, level, setSize, posInSet }) => ({ id, level, setSize, posInSet })),
    );
  });

  it('hide their icons from screen readers', async () => {
    const { target } = await mountTree({ chains: true });
    await openLogDir();

    const icons = [...target.querySelectorAll('[role="treeitem"] svg')];

    expect(icons.length).toBeGreaterThan(20);
    for (const icon of icons) expect(icon.closest('[aria-hidden="true"]')).not.toBeNull();
  });
});

describe('the file tree under the shortcut list', () => {
  let help: KeyboardShortcuts | null = null;

  afterEach(() => {
    help?.$destroy();
    help = null;
    shortcutsHelpOpen.set(false);
  });

  function closeButton(): HTMLButtonElement {
    const found = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(
      (button) => button.textContent?.trim() === 'Close',
    );
    if (!found) throw new Error('the shortcut list is not open');
    return found;
  }

  it('gives the focus to the Close button on Cmd+/ from a row, and back to the row on Esc', async () => {
    const { target } = await mountTree();
    await openLogDir();
    await files.openFile(FONTS);
    help = new KeyboardShortcuts({
      target: document.body.appendChild(document.createElement('div')),
    });
    const row = focusRow(target, FONTS);

    press(row, '/', { code: 'Slash', metaKey: true });
    await tick();
    const close = closeButton();

    expect(document.activeElement).toBe(close);

    const down = press(close, 'ArrowDown');
    await tick();

    expect(down.defaultPrevented).toBe(false);
    expect(get(treeFocus)).toBe(FONTS);

    press(close, 'Escape');
    await tick();

    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(row);
    expect(get(editorFocusRequested)).toBe(false);
  });
});

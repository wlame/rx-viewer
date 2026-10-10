// @vitest-environment jsdom
import '$lib/testing/matchMediaStub';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { get } from 'svelte/store';
import { health, trace, tree } from '$lib/stores';
import {
  clickPanelButton,
  searchFocusRequested,
  shortcutsHelpOpen,
  sidebarTab,
  sidebarVisible,
  treeFocusRequested,
} from '$lib/stores/layout';
import { chainMode } from '$lib/stores/chainMode';
import { DEFAULT_FILES_VIEW, filesView } from '$lib/stores/filesView';
import { searchRequest } from '$lib/stores/trace';
import { LOG_ROOT, LogDirBackend, serveLogDir } from '$lib/testing/fakeLogDir';
import KeyboardShortcuts from '../common/KeyboardShortcuts.svelte';
import Sidebar from './Sidebar.svelte';

let mounted: (Sidebar | KeyboardShortcuts)[] = [];

/** The side panel and the window's key handler, over a backend with one search root. */
async function mount(backend = new LogDirBackend({ features: [] })) {
  serveLogDir(backend);
  await health.check();
  await tree.loadRoots();
  const target = document.createElement('div');
  document.body.appendChild(target);
  mounted = [
    new Sidebar({ target, props: { width: 300 } }),
    new KeyboardShortcuts({ target: document.body }),
  ];
  await tick();
  return {
    target,
    pattern: () => target.querySelector<HTMLInputElement>('input[aria-label="Regex pattern 1"]'),
    tree: () => target.querySelector<HTMLElement>('[role="tree"]'),
    firstRow: () => target.querySelector<HTMLElement>('[role="treeitem"]'),
  };
}

/** The tree row whose text starts with `name`. */
function rowNamed(target: HTMLElement, name: string): HTMLElement | undefined {
  return [...target.querySelectorAll<HTMLElement>('[role="treeitem"]')].find((row) =>
    row.textContent?.trim().startsWith(name),
  );
}

async function typeValue(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await tick();
}

/** Press a key on a control outside the side panel, then let the focus requests run. */
async function pressAnywhere(init: KeyboardEventInit) {
  const elsewhere = document.body.appendChild(document.createElement('button'));
  elsewhere.focus();
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  elsewhere.dispatchEvent(event);
  await tick();
  await tick();
  await tick();
  return event;
}

afterEach(() => {
  for (const component of mounted) component.$destroy();
  mounted = [];
  sidebarTab.set('tree');
  sidebarVisible.set(true);
  shortcutsHelpOpen.set(false);
  treeFocusRequested.set(false);
  searchFocusRequested.set(false);
  searchRequest.set(null);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('the side panel', () => {
  it('keeps both panels in the page and hides the one not shown', async () => {
    const { pattern, tree: fileTree } = await mount();

    expect(fileTree()?.closest('[hidden]')).toBeNull();
    expect(pattern()?.closest('[hidden]')).not.toBeNull();

    clickPanelButton('search');
    await tick();

    expect(fileTree()).not.toBeNull();
    expect(fileTree()?.closest('[hidden]')).not.toBeNull();
    expect(pattern()?.closest('[hidden]')).toBeNull();
  });

  it('keeps the unsent search pattern when Files is shown and then Search again', async () => {
    const { pattern } = await mount();
    clickPanelButton('search');
    await tick();
    const field = pattern();
    if (!field) throw new Error('the pattern field is not rendered');
    await typeValue(field, 'ERROR [0-9]+');

    clickPanelButton('tree');
    await tick();
    clickPanelButton('search');
    await tick();

    expect(pattern()).toBe(field);
    expect(field.value).toBe('ERROR [0-9]+');
  });

  // The search panel is mounted while Files is shown, so a link that
  // names a search and `tab=files` runs it on load, as with `tab=search`.
  it("runs a link's search on load while Files is shown", async () => {
    const search = vi.spyOn(trace, 'search').mockResolvedValue(null);
    searchRequest.set({ patterns: ['ERROR'], maxResults: 100, onlyOpenedFiles: false, flags: {} });

    await mount();

    expect(get(sidebarTab)).toBe('tree');
    expect(search).toHaveBeenCalledWith([LOG_ROOT], ['ERROR'], { maxResults: 100, flags: {} });
  });

  it('is not drawn while hidden, and keeps its panels', async () => {
    const { target, pattern } = await mount();
    const aside = target.querySelector('aside');

    sidebarVisible.set(false);
    await tick();

    expect(aside?.style.display).toBe('none');
    expect(pattern()).not.toBeNull();
  });
});

describe('the panel keys over the side panel', () => {
  it('Alt+2 shows a hidden side panel on Search and focuses the first pattern field', async () => {
    const { pattern } = await mount();
    sidebarVisible.set(false);
    await tick();

    const event = await pressAnywhere({ key: '™', code: 'Digit2', altKey: true });

    expect(event.defaultPrevented).toBe(true);
    expect(get(sidebarVisible)).toBe(true);
    expect(pattern()?.closest('[hidden]')).toBeNull();
    expect(document.activeElement).toBe(pattern());
    expect(get(searchFocusRequested)).toBe(false);
  });

  it('Alt+1 shows Files and focuses the first row of the tree', async () => {
    const { firstRow } = await mount();
    sidebarTab.set('search');
    await tick();

    const event = await pressAnywhere({ key: '¡', code: 'Digit1', altKey: true });

    expect(event.defaultPrevented).toBe(true);
    expect(get(sidebarTab)).toBe('tree');
    expect(firstRow()?.textContent).toContain(LOG_ROOT.slice(1));
    expect(document.activeElement).toBe(firstRow());
    expect(get(treeFocusRequested)).toBe(false);
  });
});

/**
 * Open the analysis of a file from its row's context menu, as a user
 * does, with the backend holding the answer so the dialog stays open;
 * the focus goes to its Close button.
 */
async function openAnalysisFromTree(features: string[] = []) {
  const backend = new LogDirBackend({ features });
  backend.hold('/v1/index');
  const { target } = await mount(backend);
  rowNamed(target, 'logs')?.click();
  await vi.waitFor(() => expect(rowNamed(target, 'agentctl.log')).toBeDefined());
  rowNamed(target, 'agentctl.log')?.dispatchEvent(
    new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
  );
  await tick();
  const analyze = [...target.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (item) => item.textContent?.trim() === 'Analyze',
  );
  analyze?.click();
  await tick();
  const dialog = target.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]');
  const closeButton = dialog?.querySelector<HTMLButtonElement>('button[aria-label="Close"]');
  if (!dialog || !closeButton) throw new Error('the analysis dialog did not open');
  closeButton.focus();
  return { target, dialog, closeButton };
}

/** Press a key on `element`, then let the reactive updates run. */
async function keyDown(element: HTMLElement, init: KeyboardEventInit) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  element.dispatchEvent(event);
  await tick();
  await tick();
  return event;
}

describe('the analysis dialog in the files panel', () => {
  it.each([
    ['Alt+2', { key: '™', code: 'Digit2', altKey: true }],
    ['Cmd+Shift+F', { key: 'F', code: 'KeyF', metaKey: true, shiftKey: true }],
    ['Ctrl+K', { key: 'k', code: 'KeyK', ctrlKey: true }],
    ['Alt+1', { key: '¡', code: 'Digit1', altKey: true }],
    ['Cmd+Shift+E', { key: 'E', code: 'KeyE', metaKey: true, shiftKey: true }],
    ['Cmd+B', { key: 'b', code: 'KeyB', metaKey: true }],
  ])(
    '%s leaves the dialog shown, the focus in it and the key to the browser',
    async (_name, init) => {
      const { target, dialog, closeButton } = await openAnalysisFromTree();

      const event = await keyDown(closeButton, init);

      expect(event.defaultPrevented).toBe(false);
      expect(target.contains(dialog)).toBe(true);
      expect(dialog.closest('[hidden]')).toBeNull();
      expect(target.querySelector('aside')?.style.display).not.toBe('none');
      expect(document.activeElement).toBe(closeButton);
    },
  );

  it('lets Alt+2 show Search once the dialog is closed', async () => {
    const { target, closeButton } = await openAnalysisFromTree();
    closeButton.click();
    await tick();
    expect(target.querySelector('[role="dialog"]')).toBeNull();

    const event = await pressAnywhere({ key: '™', code: 'Digit2', altKey: true });

    expect(event.defaultPrevented).toBe(true);
    expect(get(sidebarTab)).toBe('search');
  });
});

/**
 * The files panel's keys belong to it only while it is shown and no
 * dialog owns the keyboard; otherwise they change nothing and the key is
 * left to the browser.
 */
describe('the files panel keys while something else owns the keyboard', () => {
  const FILES_KEYS: [string, KeyboardEventInit][] = [
    ['Alt+G', { key: '©', code: 'KeyG', altKey: true }],
    ['Alt+L', { key: '¬', code: 'KeyL', altKey: true }],
    ['Alt+V', { key: '√', code: 'KeyV', altKey: true }],
  ];

  afterEach(() => {
    chainMode.set(false);
    filesView.set(DEFAULT_FILES_VIEW);
  });

  function expectNothingChanged(event: KeyboardEvent) {
    expect(event.defaultPrevented).toBe(false);
    expect(get(chainMode)).toBe(false);
    expect(get(filesView)).toEqual(DEFAULT_FILES_VIEW);
  }

  it.each(FILES_KEYS)('%s acts while Files is shown', async (_name, init) => {
    await mount(new LogDirBackend({ features: ['log_chains'] }));

    const event = await pressAnywhere(init);

    expect(event.defaultPrevented).toBe(true);
  });

  it.each(FILES_KEYS)(
    '%s does nothing from the pattern field while Search is shown',
    async (_name, init) => {
      const { pattern } = await mount(new LogDirBackend({ features: ['log_chains'] }));
      clickPanelButton('search');
      await tick();
      const field = pattern();
      if (!field) throw new Error('the pattern field is not rendered');
      field.focus();

      expectNothingChanged(await keyDown(field, init));
    },
  );

  it.each(FILES_KEYS)('%s does nothing while the side panel is hidden', async (_name, init) => {
    await mount(new LogDirBackend({ features: ['log_chains'] }));
    sidebarVisible.set(false);
    await tick();

    expectNothingChanged(await pressAnywhere(init));
  });

  it.each(FILES_KEYS)('%s does nothing while the shortcut list is open', async (_name, init) => {
    await mount(new LogDirBackend({ features: ['log_chains'] }));
    shortcutsHelpOpen.set(true);
    await tick();

    expectNothingChanged(await pressAnywhere(init));
  });

  it.each(FILES_KEYS)('%s does nothing while the analysis dialog is open', async (_name, init) => {
    const { closeButton } = await openAnalysisFromTree(['log_chains']);

    expectNothingChanged(await keyDown(closeButton, init));
    expect(document.activeElement).toBe(closeButton);
  });

  it('leaves Alt+G of an input method alone', async () => {
    await mount(new LogDirBackend({ features: ['log_chains'] }));

    expectNothingChanged(
      await pressAnywhere({ key: '©', code: 'KeyG', altKey: true, isComposing: true }),
    );
  });

  it('leaves Alt+G to the browser on a backend without log chains', async () => {
    await mount(new LogDirBackend({ features: [] }));

    expectNothingChanged(await pressAnywhere({ key: '©', code: 'KeyG', altKey: true }));
  });
});

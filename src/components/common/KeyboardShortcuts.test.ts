// @vitest-environment jsdom
import '$lib/testing/matchMediaStub';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { get } from 'svelte/store';
import { files } from '$lib/stores';
import {
  registerModal,
  searchFocusRequested,
  shortcutsHelpOpen,
  sidebarTab,
  sidebarVisible,
  treeFocusRequested,
} from '$lib/stores/layout';
import AnalyzeDialog from '../tree/AnalyzeDialog.svelte';
import KeyboardShortcuts from './KeyboardShortcuts.svelte';

// The analysis dialog waits on the backend; here it never answers, so the
// dialog stays open until a test closes it.
vi.mock('$lib/indexTasks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/indexTasks')>()),
  analyzeFile: () => new Promise(() => {}),
}));

let shortcuts: KeyboardShortcuts | null = null;
let analysis: AnalyzeDialog | null = null;

function mount(): HTMLElement {
  const target = document.createElement('div');
  document.body.appendChild(target);
  shortcuts = new KeyboardShortcuts({ target });
  return target;
}

/** Mount the component and open the help with Cmd+/. */
async function openHelp() {
  const target = mount();
  window.dispatchEvent(new KeyboardEvent('keydown', { key: '/', metaKey: true, cancelable: true }));
  await tick();
  const backdrop = target.querySelector<HTMLElement>('[aria-label="Close dialog"]');
  if (!backdrop) throw new Error('the help is not open');
  return { target, backdrop };
}

async function keyDown(element: HTMLElement, init: KeyboardEventInit) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  element.dispatchEvent(event);
  await tick();
  return event;
}

/** Press a key on a control outside every panel, as anywhere in the window. */
function pressAnywhere(init: KeyboardEventInit) {
  return keyDown(document.body.appendChild(document.createElement('button')), init);
}

/** The keys of the panel rows, as a browser sends them; Alt+digit as a Mac does. */
const SHOW_FILES_KEYS: [string, KeyboardEventInit][] = [
  ['Alt+1', { key: '¡', code: 'Digit1', altKey: true }],
  ['Cmd+Shift+E', { key: 'E', code: 'KeyE', metaKey: true, shiftKey: true }],
  ['Ctrl+Shift+E', { key: 'E', code: 'KeyE', ctrlKey: true, shiftKey: true }],
];
const SHOW_SEARCH_KEYS: [string, KeyboardEventInit][] = [
  ['Alt+2', { key: '™', code: 'Digit2', altKey: true }],
  ['Cmd+Shift+F', { key: 'F', code: 'KeyF', metaKey: true, shiftKey: true }],
  ['Ctrl+Shift+F', { key: 'F', code: 'KeyF', ctrlKey: true, shiftKey: true }],
];
/** Every window-wide key that shows a panel, moves the focus or hides the side panel. */
const PANEL_AND_SIDEBAR_KEYS: [string, KeyboardEventInit][] = [
  ...SHOW_FILES_KEYS,
  ...SHOW_SEARCH_KEYS,
  ['Cmd+K', { key: 'k', code: 'KeyK', metaKey: true }],
  ['Ctrl+K', { key: 'k', code: 'KeyK', ctrlKey: true }],
  ['Cmd+B', { key: 'b', code: 'KeyB', metaKey: true }],
  ['Ctrl+B', { key: 'b', code: 'KeyB', ctrlKey: true }],
];

/** Open the analysis dialog, with the focus on its Close button as a keyboard user has it. */
function openAnalysis() {
  const target = document.body.appendChild(document.createElement('div'));
  analysis = new AnalyzeDialog({ target, props: { path: '/logs/app.log', name: 'app.log' } });
  const closeButton = target.querySelector<HTMLButtonElement>('button[aria-label="Close"]');
  if (!closeButton) throw new Error('the analysis dialog is not rendered');
  closeButton.focus();
  return { target, closeButton };
}

afterEach(() => {
  analysis?.$destroy();
  analysis = null;
  shortcuts?.$destroy();
  shortcuts = null;
  shortcutsHelpOpen.set(false);
  sidebarTab.set('tree');
  sidebarVisible.set(true);
  treeFocusRequested.set(false);
  searchFocusRequested.set(false);
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('KeyboardShortcuts help', () => {
  it('closes on Escape on its backdrop', async () => {
    const { target, backdrop } = await openHelp();

    await keyDown(backdrop, { key: 'Escape' });

    expect(target.querySelector('[role="dialog"]')).toBeNull();
  });

  // The Close button stands under a list taller than most windows.
  it('opens at the top of the list, with the focus on Close', async () => {
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    const { target } = await openHelp();
    const close = [...target.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'Close',
    );

    expect(document.activeElement).toBe(close);
    expect(focus.mock.contexts).toEqual([close]);
    expect(focus.mock.calls).toEqual([[{ preventScroll: true }]]);
  });

  it('stays open on an Escape that cancels a composition', async () => {
    const { target, backdrop } = await openHelp();

    await keyDown(backdrop, { key: 'Escape', isComposing: true });

    expect(target.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it.each([
    ['the file tree', 'Enter or Space'],
    ['a panel is open', 'Esc'],
    ['the timeline bar', 'Shift+← or Shift+→'],
  ])('lists the keys used in %s', async (scopeWords, label) => {
    const { target } = await openHelp();

    const heading = [...target.querySelectorAll('h3')].find((h) =>
      h.textContent?.includes(scopeWords),
    );

    expect(heading).toBeDefined();
    expect(heading?.nextElementSibling?.textContent).toContain(label);
  });
});

describe('KeyboardShortcuts help groups', () => {
  it('lists the open file tab keys under "Open file tabs, from anywhere"', async () => {
    const { target } = await openHelp();

    const heading = [...target.querySelectorAll('h3')].find(
      (h) => h.textContent?.trim() === 'Open file tabs, from anywhere',
    );
    const rows = heading?.nextElementSibling?.textContent ?? '';

    expect(rows).toContain('Alt+]');
    expect(rows).toContain('Alt+[');
    expect(rows).toContain('Alt+X');
  });

  it('lists the panel keys under "Panels, from anywhere", with both chords', async () => {
    const { target } = await openHelp();

    const heading = [...target.querySelectorAll('h3')].find(
      (h) => h.textContent?.trim() === 'Panels, from anywhere',
    );
    const rows = heading?.nextElementSibling?.textContent ?? '';

    expect(rows).toContain('Show the files panel and go to the file tree');
    expect(rows).toContain('Alt+1 or ⌘/Ctrl+Shift+E');
    expect(rows).toContain('Show the search panel and go to the first pattern field');
    expect(rows).toContain('Alt+2 or ⌘/Ctrl+Shift+F');
  });

  it('lists the files panel keys under "In the files panel, while it is shown"', async () => {
    const { target } = await openHelp();

    const heading = [...target.querySelectorAll('h3')].find(
      (h) => h.textContent?.trim() === 'In the files panel, while it is shown',
    );
    const rows = heading?.nextElementSibling?.textContent ?? '';

    expect(rows).toContain('Group rotated logs: on or off');
    expect(rows).toContain('Alt+G');
    expect(rows).toContain('Show labels: on or off');
    expect(rows).toContain('Alt+L');
    expect(rows).toContain('Show the size or the date of each file');
    expect(rows).toContain('Alt+V');
    expect(rows).toContain('Sort by name, or reverse a sort by name');
    expect(rows).toContain('Alt+N');
    expect(rows).toContain('Sort by the size or date shown, or reverse that sort');
    expect(rows).toContain('Alt+S');
  });

  it('lists the search toggles under "In the search panel"', async () => {
    const { target } = await openHelp();

    const heading = [...target.querySelectorAll('h3')].find(
      (h) => h.textContent?.trim() === 'In the search panel',
    );
    const rows = heading?.nextElementSibling?.textContent ?? '';

    expect(rows).toContain('Match case: on or off');
    expect(rows).toContain('Alt+C');
    expect(rows).toContain('Match whole word: on or off');
    expect(rows).toContain('Alt+W');
    expect(rows).toContain('Use regular expression: on or off');
    expect(rows).toContain('Alt+R');
    expect(rows).toContain('Only opened files: on or off');
    expect(rows).toContain('Alt+O');
  });

  it('lists no group that has no shortcut', async () => {
    const { target } = await openHelp();

    for (const heading of target.querySelectorAll('h3')) {
      expect(heading.nextElementSibling?.querySelectorAll('dt').length).toBeGreaterThan(0);
    }
  });

  it('opens when its store is set, as a button outside the component does', async () => {
    const target = mount();

    shortcutsHelpOpen.set(true);
    await tick();

    expect(target.querySelector('[role="dialog"]')).not.toBeNull();
  });
});

describe('the panel keys', () => {
  it.each(SHOW_FILES_KEYS)(
    '%s from anywhere shows a hidden files panel and asks for the tree focus',
    async (_name, init) => {
      sidebarTab.set('search');
      sidebarVisible.set(false);
      mount();

      const event = await pressAnywhere(init);

      expect(get(sidebarVisible)).toBe(true);
      expect(get(sidebarTab)).toBe('tree');
      expect(get(treeFocusRequested)).toBe(true);
      expect(event.defaultPrevented).toBe(true);
    },
  );

  it.each(SHOW_SEARCH_KEYS)(
    '%s from anywhere shows a hidden search panel and asks for the pattern focus',
    async (_name, init) => {
      sidebarVisible.set(false);
      mount();

      const event = await pressAnywhere(init);

      expect(get(sidebarVisible)).toBe(true);
      expect(get(sidebarTab)).toBe('search');
      expect(get(searchFocusRequested)).toBe(true);
      expect(event.defaultPrevented).toBe(true);
    },
  );

  it('Cmd+K from anywhere shows Search and asks for the pattern focus', async () => {
    mount();

    const event = await pressAnywhere({ key: 'k', metaKey: true });

    expect(get(sidebarTab)).toBe('search');
    expect(get(searchFocusRequested)).toBe(true);
    expect(event.defaultPrevented).toBe(true);
  });
});

describe('the panel keys while something else owns the keyboard', () => {
  it.each(PANEL_AND_SIDEBAR_KEYS)(
    '%s does nothing while the shortcuts dialog is open and is not cancelled',
    async (_name, init) => {
      const { target } = await openHelp();
      sidebarVisible.set(false);

      const event = await pressAnywhere(init);

      expect(get(sidebarVisible)).toBe(false);
      expect(get(treeFocusRequested)).toBe(false);
      expect(get(searchFocusRequested)).toBe(false);
      expect(event.defaultPrevented).toBe(false);
      expect(target.querySelector('[role="dialog"]')).not.toBeNull();
    },
  );

  it.each(PANEL_AND_SIDEBAR_KEYS)(
    '%s does nothing while the analysis dialog is open, is not cancelled and leaves the focus in it',
    async (_name, init) => {
      mount();
      const { target, closeButton } = openAnalysis();

      const event = await keyDown(closeButton, init);

      expect(event.defaultPrevented).toBe(false);
      expect(get(sidebarTab)).toBe('tree');
      expect(get(sidebarVisible)).toBe(true);
      expect(get(treeFocusRequested)).toBe(false);
      expect(get(searchFocusRequested)).toBe(false);
      expect(target.querySelector('[role="dialog"]')).not.toBeNull();
      expect(document.activeElement).toBe(closeButton);
    },
  );

  it('lets the panel keys act again once the analysis dialog closes', async () => {
    mount();
    openAnalysis();
    analysis?.$destroy();
    analysis = null;

    const event = await pressAnywhere(SHOW_SEARCH_KEYS[0][1]);

    expect(event.defaultPrevented).toBe(true);
    expect(get(sidebarTab)).toBe('search');
  });

  it('opens the shortcut list over the analysis dialog', async () => {
    const target = mount();
    const { closeButton } = openAnalysis();

    const event = await keyDown(closeButton, { key: '/', metaKey: true });

    expect(event.defaultPrevented).toBe(true);
    expect(target.querySelector('[aria-labelledby="shortcuts-title"]')).not.toBeNull();
  });

  it('closes only the shortcut list on one Esc over the analysis dialog', async () => {
    const target = mount();
    const { closeButton } = openAnalysis();
    const analysisClosed = vi.fn();
    analysis?.$on('close', analysisClosed);
    await keyDown(closeButton, { key: '/', metaKey: true });
    const backdrop = target.querySelector<HTMLElement>('[aria-label="Close dialog"]');
    if (!backdrop) throw new Error('the shortcut list is not open');

    // In a browser an Esc on the list's Close reaches the window after
    // the list closed, as its own listeners go with it first. jsdom keeps
    // them for the whole dispatch, so the Esc goes to the list's
    // backdrop, which is outside them, to take the same route.
    const event = await keyDown(backdrop, { key: 'Escape' });

    expect(event.defaultPrevented).toBe(true);
    expect(target.querySelector('[aria-labelledby="shortcuts-title"]')).toBeNull();
    expect(analysisClosed).not.toHaveBeenCalled();
  });

  it('takes no key press of an input method that composes as a panel key', async () => {
    sidebarTab.set('search');
    mount();

    const event = await pressAnywhere({ ...SHOW_FILES_KEYS[0][1], isComposing: true });

    expect(get(sidebarTab)).toBe('search');
    expect(get(treeFocusRequested)).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  });
});

describe('the open file tab keys', () => {
  const A = '/d/app.log';
  const B = '/d/worker.log.3.gz';
  const C = '/d/syslog-20260930.gz';
  // A Mac types the Option symbol as the key: Option+] is "‘", Option+[
  // is "“" and Option+X is "≈". The code names the key.
  const NEXT: KeyboardEventInit = { key: '‘', code: 'BracketRight', altKey: true };
  const PREVIOUS: KeyboardEventInit = { key: '“', code: 'BracketLeft', altKey: true };
  const CLOSE: KeyboardEventInit = { key: '≈', code: 'KeyX', altKey: true };

  let closeModal: (() => void) | null = null;

  /** Open the tabs without waiting for their lines: the backend here never answers. */
  function openTabs(...paths: string[]) {
    vi.stubGlobal('fetch', () => new Promise(() => {}));
    for (const path of paths) void files.openFile(path, { isIndexed: false });
  }

  const activeTab = () => get(files).activeFilePath;
  const openKeys = () => get(files).openFiles.map((f) => f.path);

  afterEach(() => {
    closeModal?.();
    closeModal = null;
    for (const file of get(files).openFiles) files.closeFile(file.path);
    vi.unstubAllGlobals();
  });

  it('Alt+] and Alt+[ show the next and the previous tab in strip order, round the ends', async () => {
    openTabs(A, B, C);
    mount();

    const next = await pressAnywhere(NEXT);
    expect(next.defaultPrevented).toBe(true);
    expect(activeTab()).toBe(A);

    const previous = await pressAnywhere(PREVIOUS);
    expect(previous.defaultPrevented).toBe(true);
    expect(activeTab()).toBe(C);

    await pressAnywhere(PREVIOUS);
    expect(activeTab()).toBe(B);
  });

  it('takes Alt+] and Alt+[ as Windows and Linux send them', async () => {
    openTabs(A, B, C);
    mount();

    await pressAnywhere({ key: '[', code: 'BracketLeft', altKey: true });
    expect(activeTab()).toBe(B);
    await pressAnywhere({ key: ']', code: 'BracketRight', altKey: true });
    expect(activeTab()).toBe(C);
  });

  it('Alt+] and Alt+[ do nothing with one tab open and leave the key to the browser', async () => {
    openTabs(A);
    mount();

    for (const init of [NEXT, PREVIOUS]) {
      const event = await pressAnywhere(init);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(activeTab()).toBe(A);
  });

  it('Alt+X closes the active tab and shows the tab used before it, not its neighbour', async () => {
    openTabs(A, B, C);
    files.setActiveFile(A);
    files.setActiveFile(C);
    mount();

    const event = await pressAnywhere(CLOSE);

    expect(event.defaultPrevented).toBe(true);
    expect(openKeys()).toEqual([A, B]);
    // B is the left neighbour of C; A was used last.
    expect(activeTab()).toBe(A);
  });

  it('Alt+X closes the one tab open, and with none open leaves the key to the browser', async () => {
    openTabs(A);
    mount();

    expect((await pressAnywhere(CLOSE)).defaultPrevented).toBe(true);
    expect(openKeys()).toEqual([]);

    expect((await pressAnywhere(CLOSE)).defaultPrevented).toBe(false);
  });

  it('do nothing while a modal dialog is open, and leave the key to the browser', async () => {
    openTabs(A, B, C);
    mount();
    closeModal = registerModal();

    for (const init of [NEXT, PREVIOUS, CLOSE]) {
      const event = await pressAnywhere(init);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(openKeys()).toEqual([A, B, C]);
    expect(activeTab()).toBe(C);
  });

  it('act from a text field and keep the typed character out of it', async () => {
    openTabs(A, B, C);
    mount();
    const field = document.body.appendChild(document.createElement('input'));
    field.focus();

    const event = await keyDown(field, NEXT);

    expect(event.defaultPrevented).toBe(true);
    expect(activeTab()).toBe(A);
  });
});

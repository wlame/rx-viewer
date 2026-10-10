// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { tick } from 'svelte';
import { get } from 'svelte/store';
import {
  searchFocusRequested,
  shortcutsHelpOpen,
  sidebarTab,
  sidebarVisible,
  treeFocusRequested,
} from '$lib/stores/layout';
import KeyboardShortcuts from './KeyboardShortcuts.svelte';

let shortcuts: KeyboardShortcuts | null = null;

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

afterEach(() => {
  shortcuts?.$destroy();
  shortcuts = null;
  shortcutsHelpOpen.set(false);
  sidebarTab.set('tree');
  sidebarVisible.set(true);
  treeFocusRequested.set(false);
  searchFocusRequested.set(false);
  document.body.replaceChildren();
});

describe('KeyboardShortcuts help', () => {
  it('closes on Escape on its backdrop', async () => {
    const { target, backdrop } = await openHelp();

    await keyDown(backdrop, { key: 'Escape' });

    expect(target.querySelector('[role="dialog"]')).toBeNull();
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

  it('lists no group that has no shortcut', async () => {
    const { target } = await openHelp();

    const titles = [...target.querySelectorAll('h3')].map((h) => h.textContent?.trim());

    expect(titles).not.toContain('In the files panel, while it is shown');
    expect(titles).not.toContain('In the search panel');
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

  it('Cmd+K still closes the help and goes to the search pattern field', async () => {
    const { target } = await openHelp();

    const event = await pressAnywhere({ key: 'k', metaKey: true });

    expect(target.querySelector('[role="dialog"]')).toBeNull();
    expect(get(sidebarTab)).toBe('search');
    expect(get(searchFocusRequested)).toBe(true);
    expect(event.defaultPrevented).toBe(true);
  });
});

describe('the panel keys while something else owns the keyboard', () => {
  it.each([...SHOW_FILES_KEYS, ...SHOW_SEARCH_KEYS])(
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

  it('takes no key press of an input method that composes as a panel key', async () => {
    sidebarTab.set('search');
    mount();

    const event = await pressAnywhere({ ...SHOW_FILES_KEYS[0][1], isComposing: true });

    expect(get(sidebarTab)).toBe('search');
    expect(get(treeFocusRequested)).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  });
});

// @vitest-environment jsdom
import '$lib/testing/matchMediaStub';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { get } from 'svelte/store';
import { TOOLTIP_GAP_PX, TOOLTIP_ID } from '$lib/actions/tooltip';
import {
  registerModal,
  searchFocusRequested,
  shortcutsHelpOpen,
  sidebarTab,
  sidebarVisible,
  treeFocusRequested,
} from '$lib/stores/layout';
import ActivityBar from './ActivityBar.svelte';

let bar: ActivityBar | null = null;

function mount() {
  const target = document.createElement('div');
  document.body.appendChild(target);
  bar = new ActivityBar({ target });
  const button = (label: string) => {
    const found = target.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    if (!found) throw new Error(`no button "${label}"`);
    return found;
  };
  return {
    target,
    toolbar: () => target.querySelector<HTMLElement>('[role="toolbar"]'),
    buttons: () => [...target.querySelectorAll<HTMLButtonElement>('button')],
    files: () => button('Files'),
    search: () => button('Search'),
    help: () => button('Keyboard shortcuts'),
  };
}

async function click(element: HTMLElement) {
  element.click();
  await tick();
}

async function keyDown(element: HTMLElement, init: KeyboardEventInit) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  element.dispatchEvent(event);
  await tick();
  return event;
}

/** Focus as Tab does, so the button matches `:focus-visible` and shows its tooltip at once. */
function focusByKeyboard(element: HTMLElement) {
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
  element.focus();
}

afterEach(() => {
  bar?.$destroy();
  bar = null;
  sidebarTab.set('tree');
  sidebarVisible.set(true);
  shortcutsHelpOpen.set(false);
  treeFocusRequested.set(false);
  searchFocusRequested.set(false);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('the activity bar', () => {
  it('is a vertical toolbar named Panels', () => {
    const { toolbar } = mount();

    expect(toolbar()?.getAttribute('aria-orientation')).toBe('vertical');
    expect(toolbar()?.getAttribute('aria-label')).toBe('Panels');
  });

  it('has a labelled button per panel, then the keyboard shortcuts button', () => {
    const { buttons } = mount();

    expect(buttons().map((b) => b.getAttribute('aria-label'))).toEqual([
      'Files',
      'Search',
      'Keyboard shortcuts',
    ]);
  });

  it("presses the shown panel's button only", async () => {
    const { files, search, help } = mount();

    expect(files().getAttribute('aria-pressed')).toBe('true');
    expect(search().getAttribute('aria-pressed')).toBe('false');
    expect(help().hasAttribute('aria-pressed')).toBe(false);

    sidebarTab.set('search');
    await tick();

    expect(files().getAttribute('aria-pressed')).toBe('false');
    expect(search().getAttribute('aria-pressed')).toBe('true');
  });

  it('presses no button while the side panel is hidden', async () => {
    const { files, search } = mount();

    sidebarVisible.set(false);
    await tick();

    expect(files().getAttribute('aria-pressed')).toBe('false');
    expect(search().getAttribute('aria-pressed')).toBe('false');
  });

  it('shows Search, hides the side panel on a second click, and shows Files after', async () => {
    const { files, search } = mount();

    await click(search());
    expect(get(sidebarTab)).toBe('search');
    expect(get(sidebarVisible)).toBe(true);
    expect(search().getAttribute('aria-pressed')).toBe('true');

    await click(search());
    expect(get(sidebarVisible)).toBe(false);
    expect(search().getAttribute('aria-pressed')).toBe('false');

    await click(files());
    expect(get(sidebarVisible)).toBe(true);
    expect(get(sidebarTab)).toBe('tree');
    expect(files().getAttribute('aria-pressed')).toBe('true');
  });

  it('asks no panel for the focus on a click', async () => {
    const { search } = mount();

    await click(search());

    expect(get(searchFocusRequested)).toBe(false);
  });

  it('opens the keyboard shortcuts from its last button', async () => {
    const { help } = mount();

    await click(help());

    expect(get(shortcutsHelpOpen)).toBe(true);
  });
});

describe('the keys of the activity bar', () => {
  /** The buttons in the Tab order: those with tabindex 0. */
  function tabStops(buttons: HTMLButtonElement[]) {
    return buttons.filter((b) => b.tabIndex === 0).map((b) => b.getAttribute('aria-label'));
  }

  it("has one Tab stop, on the shown panel's button", async () => {
    const { buttons } = mount();
    expect(tabStops(buttons())).toEqual(['Files']);

    sidebarTab.set('search');
    await tick();

    expect(tabStops(buttons())).toEqual(['Search']);
  });

  it('moves the focus down and up through its buttons with the arrow keys', async () => {
    const { files, search, help } = mount();
    files().focus();

    const down = await keyDown(files(), { key: 'ArrowDown', code: 'ArrowDown' });
    expect(document.activeElement).toBe(search());
    expect(down.defaultPrevented).toBe(true);

    await keyDown(search(), { key: 'ArrowDown', code: 'ArrowDown' });
    expect(document.activeElement).toBe(help());

    await keyDown(help(), { key: 'ArrowUp', code: 'ArrowUp' });
    expect(document.activeElement).toBe(search());
  });

  it('wraps around at either end', async () => {
    const { files, help } = mount();
    help().focus();

    await keyDown(help(), { key: 'ArrowDown', code: 'ArrowDown' });
    expect(document.activeElement).toBe(files());

    await keyDown(files(), { key: 'ArrowUp', code: 'ArrowUp' });
    expect(document.activeElement).toBe(help());
  });

  // A single Tab stop is what lets Tab leave the toolbar: every other
  // button is out of the Tab order.
  it('keeps one Tab stop, on the focused button, so Tab leaves the toolbar', async () => {
    const { buttons, files, help } = mount();
    files().focus();

    await keyDown(files(), { key: 'ArrowUp', code: 'ArrowUp' });

    expect(document.activeElement).toBe(help());
    expect(tabStops(buttons())).toEqual(['Keyboard shortcuts']);
  });

  it('leaves an arrow key with a modifier, or of an input method, to the browser', async () => {
    const { files } = mount();
    files().focus();

    const withMod = await keyDown(files(), { key: 'ArrowDown', metaKey: true });
    const composing = await keyDown(files(), { key: 'ArrowDown', isComposing: true });

    expect(document.activeElement).toBe(files());
    expect(withMod.defaultPrevented).toBe(false);
    expect(composing.defaultPrevented).toBe(false);
  });

  // Enter and Space on a button are the browser's: it clicks the button
  // when the key is left to it.
  it('leaves ↓, ↑ and Enter to an open dialog, and a click changes nothing', async () => {
    const { files, search, help } = mount();
    files().focus();
    const release = registerModal();
    try {
      const down = await keyDown(files(), { key: 'ArrowDown', code: 'ArrowDown' });
      const up = await keyDown(files(), { key: 'ArrowUp', code: 'ArrowUp' });
      const enter = await keyDown(files(), { key: 'Enter', code: 'Enter' });
      await click(files());
      await click(search());
      await click(help());

      expect([down.defaultPrevented, up.defaultPrevented, enter.defaultPrevented]).toEqual([
        false,
        false,
        false,
      ]);
      expect(document.activeElement).toBe(files());
      expect(get(sidebarVisible)).toBe(true);
      expect(get(sidebarTab)).toBe('tree');
      expect(get(shortcutsHelpOpen)).toBe(false);
    } finally {
      release();
    }
  });
});

describe('the tooltips of the activity bar', () => {
  it("names a panel's button and its key, right of the bar", () => {
    vi.stubGlobal('navigator', { platform: 'Linux x86_64', userAgent: '' });
    const { files } = mount();
    vi.spyOn(files(), 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 48, 40, 40));

    focusByKeyboard(files());

    const shown = document.getElementById(TOOLTIP_ID);
    expect(shown?.hidden).toBe(false);
    expect(shown?.textContent).toBe('FilesAlt+1');
    expect(shown?.style.left).toBe(`${40 + TOOLTIP_GAP_PX}px`);
  });

  it('names the keyboard shortcuts button and its key, as a Mac prints it', () => {
    vi.stubGlobal('navigator', { platform: 'MacIntel', userAgent: '' });
    const { help } = mount();

    focusByKeyboard(help());

    expect(document.getElementById(TOOLTIP_ID)?.textContent).toBe('Keyboard shortcuts⌘/');
  });
});

// @vitest-environment jsdom
import '$lib/testing/matchMediaStub';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { get } from 'svelte/store';
import { TOOLTIP_DELAY_MS, TOOLTIP_ID } from '$lib/actions/tooltip';
import { files } from '$lib/stores';
import { registerModal, tabStripFocusRequested } from '$lib/stores/layout';
import TabStrip from './TabStrip.svelte';

const PANEL_ID = 'tab-panel';
const A = '/d/app.log';
const B = '/d/worker.log.3.gz';
const C = '/d/syslog-20260930.gz';

let strip: TabStrip | null = null;
let closeModal: (() => void) | null = null;

/**
 * Open the tabs without waiting for their lines: a tab is in the store
 * before its first request, and the backend here never answers.
 */
function openTabs(...paths: string[]) {
  for (const path of paths) void files.openFile(path, { isIndexed: false });
}

function mount() {
  const target = document.body.appendChild(document.createElement('div'));
  strip = new TabStrip({ target, props: { panelId: PANEL_ID } });
  const tabs = () => [...target.querySelectorAll<HTMLElement>('[role="tab"]')];
  const tabOf = (path: string) => {
    const found = tabs().find((tab) => tab.textContent?.includes(path.split('/').pop() ?? ''));
    if (!found) throw new Error(`no tab for ${path}`);
    return found;
  };
  return { target, tabs, tabOf };
}

async function keyDown(element: HTMLElement, init: KeyboardEventInit) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  element.dispatchEvent(event);
  await tick();
  await tick();
  return event;
}

beforeEach(() => {
  vi.stubGlobal('fetch', () => new Promise(() => {}));
});

afterEach(() => {
  strip?.$destroy();
  strip = null;
  closeModal?.();
  closeModal = null;
  tabStripFocusRequested.set(false);
  for (const file of get(files).openFiles) files.closeFile(file.path);
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe('the tab strip', () => {
  it('is a tab list of the open tabs whose one Tab stop is the active tab', async () => {
    openTabs(A, B, C);
    const { target, tabs } = mount();
    await tick();

    const list = target.querySelector('[role="tablist"]');
    expect(list?.getAttribute('aria-label')).toBe('Open files');
    expect(tabs()).toHaveLength(3);
    expect(tabs().map((tab) => tab.getAttribute('tabindex'))).toEqual(['-1', '-1', '0']);
    expect(tabs().map((tab) => tab.getAttribute('aria-selected'))).toEqual([
      'false',
      'false',
      'true',
    ]);
    expect(tabs().every((tab) => tab.getAttribute('aria-controls') === PANEL_ID)).toBe(true);
  });

  it('holds no button inside a button: each close button stands beside its tab, out of the Tab order', async () => {
    openTabs(A, B, C);
    const { target, tabs } = mount();
    await tick();

    expect(target.querySelector('button button')).toBeNull();
    for (const tab of tabs()) {
      const close = tab.nextElementSibling;
      expect(close?.tagName).toBe('BUTTON');
      expect(close?.getAttribute('tabindex')).toBe('-1');
    }
  });

  it.each([
    ['ArrowRight', { key: 'ArrowRight' }, A],
    ['ArrowLeft', { key: 'ArrowLeft' }, B],
    ['Home', { key: 'Home' }, A],
    ['End', { key: 'End' }, C],
  ])(
    'shows and focuses the tab %s goes to from the last tab, round the ends',
    async (_, init, expected) => {
      openTabs(A, B, C);
      const { tabOf } = mount();
      await tick();
      tabOf(C).focus();

      const event = await keyDown(tabOf(C), init);

      expect(event.defaultPrevented).toBe(true);
      expect(get(files).activeFilePath).toBe(expected);
      expect(document.activeElement).toBe(tabOf(expected));
      expect(tabOf(expected).getAttribute('tabindex')).toBe('0');
    },
  );

  it('moves on from the first tab to the second with →, and back round to the last with ←', async () => {
    openTabs(A, B, C);
    files.setActiveFile(A);
    const { tabOf } = mount();
    await tick();

    await keyDown(tabOf(A), { key: 'ArrowRight' });
    expect(get(files).activeFilePath).toBe(B);

    await keyDown(tabOf(B), { key: 'ArrowLeft' });
    await keyDown(tabOf(A), { key: 'ArrowLeft' });
    expect(get(files).activeFilePath).toBe(C);
  });

  it('closes the focused tab with Delete and moves the focus to the tab used before it', async () => {
    openTabs(A, B, C);
    files.setActiveFile(A);
    files.setActiveFile(C);
    const { tabs, tabOf } = mount();
    await tick();
    tabOf(C).focus();

    const event = await keyDown(tabOf(C), { key: 'Delete' });

    expect(event.defaultPrevented).toBe(true);
    expect(get(files).openFiles.map((f) => f.path)).toEqual([A, B]);
    // B is the left neighbour; A was used last.
    expect(get(files).activeFilePath).toBe(A);
    expect(tabs()).toHaveLength(2);
    expect(document.activeElement).toBe(tabOf(A));
  });

  it('closes a tab from its close button and shows the tab used before it', async () => {
    openTabs(A, B, C);
    files.setActiveFile(A);
    files.setActiveFile(C);
    const { tabOf } = mount();
    await tick();

    (tabOf(C).nextElementSibling as HTMLElement).click();
    await tick();

    expect(get(files).openFiles.map((f) => f.path)).toEqual([A, B]);
    expect(get(files).activeFilePath).toBe(A);
  });

  it('names Alt+X, the key that closes the tab shown, in the tooltip of a close button', async () => {
    vi.stubGlobal('navigator', { platform: 'Linux x86_64', userAgent: 'X11; Linux x86_64' });
    openTabs(A, B);
    const { tabOf } = mount();
    await tick();
    vi.useFakeTimers();

    (tabOf(B).nextElementSibling as HTMLElement).dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(TOOLTIP_DELAY_MS);
    vi.useRealTimers();

    const keys = [...(document.getElementById(TOOLTIP_ID)?.querySelectorAll('kbd') ?? [])];
    expect(document.getElementById(TOOLTIP_ID)?.textContent).toContain('Close');
    expect(keys.map((kbd) => kbd.textContent)).toEqual(['Alt', 'X']);
  });

  // A switch of tabs by key from the strip asks for the focus on the tab now active.
  it('focuses the active tab when asked, and resets the request', async () => {
    openTabs(A, B, C);
    const { tabOf } = mount();
    await tick();
    tabOf(C).focus();

    files.setActiveFile(A);
    tabStripFocusRequested.set(true);

    await vi.waitFor(() => expect(document.activeElement).toBe(tabOf(A)));
    expect(get(tabStripFocusRequested)).toBe(false);
  });

  it('shows a tab that is clicked', async () => {
    openTabs(A, B, C);
    const { tabOf } = mount();
    await tick();

    tabOf(A).click();
    await tick();

    expect(get(files).activeFilePath).toBe(A);
    expect(tabOf(A).getAttribute('aria-selected')).toBe('true');
  });

  it('leaves its keys to a modal dialog: nothing moves or closes, and no key is cancelled', async () => {
    openTabs(A, B, C);
    const { tabOf } = mount();
    await tick();
    closeModal = registerModal();

    for (const key of ['ArrowRight', 'Home', 'Delete']) {
      const event = await keyDown(tabOf(C), { key });
      expect(event.defaultPrevented).toBe(false);
    }
    expect(get(files).openFiles).toHaveLength(3);
    expect(get(files).activeFilePath).toBe(C);
  });

  it('takes no arrow key with a modifier, which the browser keeps', async () => {
    openTabs(A, B, C);
    const { tabOf } = mount();
    await tick();

    const event = await keyDown(tabOf(C), { key: 'ArrowRight', altKey: true });

    expect(event.defaultPrevented).toBe(false);
    expect(get(files).activeFilePath).toBe(C);
  });

  it('moves a tab dropped on another to that place and keeps the active tab', async () => {
    openTabs(A, B, C);
    const { tabOf } = mount();
    await tick();

    tabOf(A).dispatchEvent(new Event('dragstart', { bubbles: true }));
    tabOf(C).dispatchEvent(new Event('dragover', { bubbles: true, cancelable: true }));
    tabOf(C).dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }));
    await tick();

    expect(get(files).openFiles.map((f) => f.path)).toEqual([B, C, A]);
    expect(get(files).activeFilePath).toBe(C);
  });
});

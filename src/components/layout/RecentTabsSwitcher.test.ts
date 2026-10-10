// @vitest-environment jsdom
import '$lib/testing/matchMediaStub';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { get } from 'svelte/store';
import { files } from '$lib/stores';
import { modalOpen, registerModal } from '$lib/stores/layout';
import { RECENT_LIST_DELAY_MS } from '$lib/utils/recentSwitch';
import KeyboardShortcuts from '../common/KeyboardShortcuts.svelte';
import RecentTabsSwitcher from './RecentTabsSwitcher.svelte';

const A = '/d/app.log';
const B = '/d/worker.log.3.gz';
const C = '/d/syslog-20260930.gz';
// A Mac types "œ" for Option+Q and "Œ" for Option+Shift+Q; the code names the key.
const ALT_Q: KeyboardEventInit = { key: 'œ', code: 'KeyQ', altKey: true };
const ALT_SHIFT_Q: KeyboardEventInit = { key: 'Œ', code: 'KeyQ', altKey: true, shiftKey: true };
const ALT_ESC: KeyboardEventInit = { key: 'Escape', code: 'Escape', altKey: true };
const ALT_RELEASED: KeyboardEventInit = { key: 'Alt', code: 'AltLeft', altKey: false };

let mounted: { $destroy(): void }[] = [];
let closeModal: (() => void) | null = null;

/**
 * Open the tabs without waiting for their lines: a tab is in the store
 * before its first request, and the backend here never answers. The
 * last one is shown, so the recent order is the reverse.
 */
function openTabs(...paths: string[]) {
  for (const path of paths) void files.openFile(path, { isIndexed: false });
}

/** The switcher, with the window-wide keys beside it as the app has them. */
function mount() {
  const target = document.body.appendChild(document.createElement('div'));
  mounted.push(new KeyboardShortcuts({ target }), new RecentTabsSwitcher({ target }));
  return {
    dialog: () => target.querySelector<HTMLElement>('[role="dialog"]'),
    listbox: () => target.querySelector<HTMLElement>('[role="listbox"]'),
    options: () => [...target.querySelectorAll<HTMLElement>('[role="option"]')],
  };
}

async function dispatchKey(type: 'keydown' | 'keyup', init: KeyboardEventInit, on?: Element) {
  const event = new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init });
  (on ?? document.activeElement ?? document.body).dispatchEvent(event);
  await tick();
  return event;
}

const keyDown = (init: KeyboardEventInit, on?: Element) => dispatchKey('keydown', init, on);
const keyUp = (init: KeyboardEventInit) => dispatchKey('keyup', init);

/** Let the switcher's delay pass, so its list shows. */
async function waitForList() {
  vi.advanceTimersByTime(RECENT_LIST_DELAY_MS);
  await tick();
}

const activeTab = () => get(files).activeFilePath;

beforeEach(() => {
  vi.stubGlobal('fetch', () => new Promise(() => {}));
  vi.useFakeTimers();
});

afterEach(() => {
  for (const component of mounted) component.$destroy();
  mounted = [];
  closeModal?.();
  closeModal = null;
  vi.useRealTimers();
  for (const file of get(files).openFiles) files.closeFile(file.path);
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe('the recent-tab switcher', () => {
  it('is drawn by the app, over the whole page', () => {
    const app = readFileSync(resolve(__dirname, '../../App.svelte'), 'utf-8');

    expect(app).toContain('<RecentTabsSwitcher />');
  });

  it('shows the tab used before with Alt+Q and the release of Alt', async () => {
    openTabs(A, B, C);
    mount();

    expect((await keyDown(ALT_Q)).defaultPrevented).toBe(true);
    expect(activeTab()).toBe(C);
    expect((await keyUp(ALT_RELEASED)).defaultPrevented).toBe(true);

    expect(activeTab()).toBe(B);
  });

  it('never draws its list for a quick Alt+Q', async () => {
    openTabs(A, B, C);
    const { listbox, options } = mount();

    await keyDown(ALT_Q);
    vi.advanceTimersByTime(RECENT_LIST_DELAY_MS - 1);
    await tick();
    expect(listbox()).toBeNull();
    await keyUp(ALT_RELEASED);
    vi.advanceTimersByTime(RECENT_LIST_DELAY_MS);
    await tick();

    expect(listbox()).toBeNull();
    expect(options()).toEqual([]);
    expect(activeTab()).toBe(B);
  });

  it('shows its list after 250 ms in the order the tabs were used, on the tab used before', async () => {
    openTabs(A, B, C);
    const { listbox, options } = mount();

    await keyDown(ALT_Q);
    await waitForList();

    expect(options().map((option) => option.textContent?.trim())).toEqual([
      'syslog-20260930.gz',
      'worker.log.3.gz',
      'app.log',
    ]);
    expect(options().map((option) => option.title)).toEqual([C, B, A]);
    expect(options().map((option) => option.getAttribute('aria-selected'))).toEqual([
      'false',
      'true',
      'false',
    ]);
    expect(listbox()?.getAttribute('aria-activedescendant')).toBe(options()[1].id);
    expect(document.activeElement).toBe(listbox());
  });

  it('goes further back with each Q while Alt is held and back with Shift+Q, round the ends', async () => {
    openTabs(A, B, C);
    const { options } = mount();
    const chosen = () => options().find((o) => o.getAttribute('aria-selected') === 'true')?.title;

    await keyDown(ALT_Q);
    await waitForList();
    await keyDown(ALT_Q);
    expect(chosen()).toBe(A);
    await keyDown(ALT_Q);
    expect(chosen()).toBe(C);
    await keyDown(ALT_SHIFT_Q);
    await keyDown(ALT_SHIFT_Q);
    expect(chosen()).toBe(B);
    await keyDown(ALT_Q);
    await keyUp(ALT_RELEASED);

    expect(activeTab()).toBe(A);
  });

  it('opens on the least recently used tab with Alt+Shift+Q', async () => {
    openTabs(A, B, C);
    mount();

    await keyDown(ALT_SHIFT_Q);
    await keyUp(ALT_RELEASED);

    expect(activeTab()).toBe(A);
  });

  it('counts as a modal dialog from the first Alt+Q until it closes', async () => {
    openTabs(A, B, C);
    const { dialog } = mount();

    await keyDown(ALT_Q);
    expect(get(modalOpen)).toBe(true);
    expect(dialog()?.getAttribute('aria-modal')).toBe('true');
    await waitForList();
    expect(get(modalOpen)).toBe(true);

    await keyUp(ALT_RELEASED);
    expect(get(modalOpen)).toBe(false);
    expect(dialog()).toBeNull();
  });

  it('leaves the other tab keys alone while it is open', async () => {
    openTabs(A, B, C);
    mount();

    await keyDown(ALT_Q);
    const next = await keyDown({ key: '‘', code: 'BracketRight', altKey: true });
    const close = await keyDown({ key: '≈', code: 'KeyX', altKey: true });

    expect(next.defaultPrevented).toBe(false);
    expect(close.defaultPrevented).toBe(false);
    expect(get(files).openFiles).toHaveLength(3);
    expect(activeTab()).toBe(C);
  });

  it('closes on Esc while Alt is held, switches to no tab and gives the focus back', async () => {
    openTabs(A, B, C);
    const { dialog } = mount();
    const field = document.body.appendChild(document.createElement('input'));
    field.focus();

    await keyDown(ALT_Q);
    await waitForList();
    const escape = await keyDown(ALT_ESC);
    const release = await keyUp(ALT_RELEASED);

    expect(escape.defaultPrevented).toBe(true);
    expect(release.defaultPrevented).toBe(false);
    expect(dialog()).toBeNull();
    expect(get(modalOpen)).toBe(false);
    expect(activeTab()).toBe(C);
    expect(document.activeElement).toBe(field);
  });

  // Alt released in another window never reaches the page.
  it('closes with no switch when the window loses the focus', async () => {
    openTabs(A, B, C);
    const { dialog } = mount();

    await keyDown(ALT_Q);
    await waitForList();
    window.dispatchEvent(new Event('blur'));
    await tick();

    expect(dialog()).toBeNull();
    expect(get(modalOpen)).toBe(false);
    expect(activeTab()).toBe(C);
    await keyUp(ALT_RELEASED);
    expect(activeTab()).toBe(C);
  });

  it('closes with no switch when the page is hidden', async () => {
    openTabs(A, B, C);
    const { dialog } = mount();
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);

    await keyDown(ALT_Q);
    document.dispatchEvent(new Event('visibilitychange'));
    await tick();
    hidden.mockRestore();

    expect(dialog()).toBeNull();
    expect(get(modalOpen)).toBe(false);
    expect(activeTab()).toBe(C);
  });

  it('drops a tab closed while it is open, and closes with fewer than two left', async () => {
    openTabs(A, B, C);
    const { dialog, options } = mount();

    await keyDown(ALT_Q);
    await waitForList();
    files.closeFile(A);
    await tick();
    expect(options().map((option) => option.title)).toEqual([C, B]);

    files.closeFile(B);
    await tick();
    expect(dialog()).toBeNull();
    expect(get(modalOpen)).toBe(false);
    await keyUp(ALT_RELEASED);
    expect(activeTab()).toBe(C);
  });

  it('shows an entry clicked in its list', async () => {
    openTabs(A, B, C);
    const { dialog, options } = mount();

    await keyDown(ALT_Q);
    await waitForList();
    options()[2].click();
    await tick();

    expect(activeTab()).toBe(A);
    expect(dialog()).toBeNull();
  });

  it('does not open with one tab or behind another dialog, and leaves Alt+Q to the browser', async () => {
    openTabs(A);
    const { dialog } = mount();

    expect((await keyDown(ALT_Q)).defaultPrevented).toBe(false);
    expect(dialog()).toBeNull();

    openTabs(B, C);
    closeModal = registerModal();
    expect((await keyDown(ALT_Q)).defaultPrevented).toBe(false);
    expect(dialog()).toBeNull();
  });

  it('takes Alt+Q typed in a search pattern field and keeps the "œ" out of it', async () => {
    openTabs(A, B, C);
    mount();
    const field = document.body.appendChild(document.createElement('input'));
    field.focus();

    const event = await keyDown(ALT_Q, field);
    await keyUp(ALT_RELEASED);

    // A cancelled key press types no character.
    expect(event.defaultPrevented).toBe(true);
    expect(activeTab()).toBe(B);
  });

  it('marks a chain as the tab strip does', async () => {
    vi.useRealTimers();
    const { FakeChain, serveChain } = await import('$lib/testing/fakeChain');
    const { health } = await import('$lib/stores/health');
    const { chainMode } = await import('$lib/stores/chainMode');
    const chain = new FakeChain({
      name: 'app.log',
      parts: [
        { name: 'app.log.1', lines: 100 },
        { name: 'app.log', lines: 100, isActive: true },
      ],
      state: 'ready',
    });
    serveChain(chain);
    await health.check();
    chainMode.set(true);
    await files.openFile('/l/app.log.1');
    await files.openChain('/l/app.log', {
      position: { kind: 'local', part: 'app.log.1', line: 50 },
    });
    vi.useFakeTimers();
    const { options } = mount();

    await keyDown(ALT_Q);
    await waitForList();
    chainMode.set(false);

    expect(options()[0].textContent?.trim()).toBe('app.log [1/2]');
    expect(options()[0].title).toBe('/l/app.log');
  });
});

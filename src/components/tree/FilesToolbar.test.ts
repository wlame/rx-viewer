// @vitest-environment jsdom
import '$lib/testing/matchMediaStub';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { get } from 'svelte/store';
import { TOOLTIP_ID } from '$lib/actions/tooltip';
import { health } from '$lib/stores';
import { chainMode } from '$lib/stores/chainMode';
import { DEFAULT_FILES_VIEW, filesView } from '$lib/stores/filesView';
import { sidebarTab, sidebarVisible } from '$lib/stores/layout';
import { LogDirBackend, serveLogDir } from '$lib/testing/fakeLogDir';
import { startViewSync } from '$lib/viewState';
import FilesToolbar from './FilesToolbar.svelte';

let mounted: FilesToolbar | null = null;
let stopViewSync: (() => void) | null = null;

async function mount(features: string[] = ['log_chains']) {
  serveLogDir(new LogDirBackend({ features }));
  await health.check();
  const target = document.createElement('div');
  document.body.appendChild(target);
  mounted = new FilesToolbar({ target });
  await tick();
  const button = (name: string) =>
    target.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
  const radio = (name: string) =>
    [...target.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(
      (r) => r.textContent?.trim() === name,
    );
  return {
    target,
    group: () => button('Group rotated logs'),
    labels: () => button('Show labels'),
    values: () => target.querySelector<HTMLElement>('[role="radiogroup"]'),
    size: () => radio('Size'),
    date: () => radio('Date'),
  };
}

async function keyDown(element: Element, init: KeyboardEventInit) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  element.dispatchEvent(event);
  await tick();
  return event;
}

/** Focus as Tab does, so the control matches `:focus-visible` and shows its tooltip at once. */
function focusByKeyboard(element: HTMLElement) {
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
  element.focus();
}

afterEach(() => {
  stopViewSync?.();
  stopViewSync = null;
  mounted?.$destroy();
  mounted = null;
  chainMode.set(false);
  filesView.set(DEFAULT_FILES_VIEW);
  sidebarTab.set('tree');
  sidebarVisible.set(true);
  window.history.replaceState(null, '', '/');
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('the files toolbar', () => {
  it('is titled Files', async () => {
    const { target } = await mount();

    expect(target.querySelector('h2')?.textContent?.trim()).toBe('Files');
  });

  it('has labelled toggles, Group rotated logs off and Show labels on', async () => {
    const { group, labels } = await mount();

    expect(group()?.getAttribute('aria-pressed')).toBe('false');
    expect(labels()?.getAttribute('aria-pressed')).toBe('true');
  });

  it('does not offer Group rotated logs while the backend serves no log chains', async () => {
    const { group, labels } = await mount([]);

    expect(group()).toBeNull();
    expect(labels()).not.toBeNull();
  });

  it('turns chain mode on and off with Group rotated logs', async () => {
    const { group } = await mount();

    group()?.click();
    await tick();
    expect(get(chainMode)).toBe(true);
    expect(group()?.getAttribute('aria-pressed')).toBe('true');

    group()?.click();
    await tick();
    expect(get(chainMode)).toBe(false);
    expect(group()?.getAttribute('aria-pressed')).toBe('false');
  });

  it('shows the chain mode a link set', async () => {
    const { group } = await mount();

    chainMode.set(true);
    await tick();

    expect(group()?.getAttribute('aria-pressed')).toBe('true');
  });

  it('turns the labels off and on with Show labels', async () => {
    const { labels } = await mount();

    labels()?.click();
    await tick();
    expect(get(filesView).labels).toBe(false);
    expect(labels()?.getAttribute('aria-pressed')).toBe('false');

    labels()?.click();
    await tick();
    expect(get(filesView).labels).toBe(true);
    expect(labels()?.getAttribute('aria-pressed')).toBe('true');
  });

  it('fills a toggle with the accent colour while it is on', async () => {
    const { labels } = await mount();
    expect(labels()?.className).toContain('bg-gh-accent-emphasis');

    labels()?.click();
    await tick();

    expect(labels()?.className).not.toContain('bg-gh-accent-emphasis');
    expect(labels()?.className).toContain('bg-gh-canvas-inset');
  });
});

describe('the Size/Date switch of the files toolbar', () => {
  it('is a radio group named Value shown, with Size checked', async () => {
    const { values, size, date } = await mount();

    expect(values()?.getAttribute('aria-label')).toBe('Value shown');
    expect(size()?.getAttribute('aria-checked')).toBe('true');
    expect(date()?.getAttribute('aria-checked')).toBe('false');
  });

  it('shows the date when Date is clicked, and the size when Size is', async () => {
    const { size, date } = await mount();

    date()?.click();
    await tick();
    expect(get(filesView).show).toBe('date');
    expect(date()?.getAttribute('aria-checked')).toBe('true');
    expect(size()?.getAttribute('aria-checked')).toBe('false');

    size()?.click();
    await tick();
    expect(get(filesView).show).toBe('size');
  });

  it('has one Tab stop, on the checked value', async () => {
    const { size, date } = await mount();
    expect([size()?.tabIndex, date()?.tabIndex]).toEqual([0, -1]);

    date()?.click();
    await tick();

    expect([size()?.tabIndex, date()?.tabIndex]).toEqual([-1, 0]);
  });

  it.each(['ArrowRight', 'ArrowLeft'])(
    'moves to the other value and chooses it on %s, around the ends',
    async (key) => {
      const { size, date } = await mount();
      size()?.focus();

      const event = await keyDown(size() as HTMLElement, { key });

      expect(event.defaultPrevented).toBe(true);
      expect(get(filesView).show).toBe('date');
      expect(document.activeElement).toBe(date());

      await keyDown(date() as HTMLElement, { key });

      expect(get(filesView).show).toBe('size');
      expect(document.activeElement).toBe(size());
    },
  );

  it.each([
    ['with Alt', { key: 'ArrowRight', altKey: true }],
    ['of an input method', { key: 'ArrowRight', isComposing: true }],
    ['another key', { key: 'ArrowDown' }],
  ])('leaves an arrow %s alone', async (_name, init) => {
    const { size } = await mount();
    size()?.focus();

    const event = await keyDown(size() as HTMLElement, init);

    expect(event.defaultPrevented).toBe(false);
    expect(get(filesView).show).toBe('size');
  });
});

describe('the tooltips of the files toolbar', () => {
  it('names Group rotated logs, its key and what it groups', async () => {
    vi.stubGlobal('navigator', { platform: 'Linux x86_64', userAgent: '' });
    const { group } = await mount();

    focusByKeyboard(group() as HTMLElement);

    expect(document.getElementById(TOOLTIP_ID)?.textContent).toBe(
      'Group rotated logsAlt+Gapp.log, app.log.1, app.log.2.gz … as one log chain',
    );
  });

  it('names Show labels and its key, as a Mac prints it', async () => {
    vi.stubGlobal('navigator', { platform: 'MacIntel', userAgent: '' });
    const { labels } = await mount();

    focusByKeyboard(labels() as HTMLElement);

    expect(document.getElementById(TOOLTIP_ID)?.textContent).toBe('Show labels⌥L');
  });

  it('names the key that switches the value on the focused value', async () => {
    vi.stubGlobal('navigator', { platform: 'Linux x86_64', userAgent: '' });
    const { size } = await mount();

    focusByKeyboard(size() as HTMLElement);

    expect(document.getElementById(TOOLTIP_ID)?.textContent).toBe('Size or dateAlt+V');
  });
});

describe('the files toolbar keys', () => {
  // A Mac sends the Option symbol as the key; the code names the letter.
  it('turns chain mode on with Alt+G and keeps the key from the browser', async () => {
    await mount();

    const event = await keyDown(document.body, { key: '©', code: 'KeyG', altKey: true });

    expect(event.defaultPrevented).toBe(true);
    expect(get(chainMode)).toBe(true);
  });

  it('turns the labels off with Alt+L and keeps the key from the browser', async () => {
    await mount();

    const event = await keyDown(document.body, { key: '¬', code: 'KeyL', altKey: true });

    expect(event.defaultPrevented).toBe(true);
    expect(get(filesView).labels).toBe(false);
  });

  it('switches to the date with Alt+V, and back, keeping the key from the browser', async () => {
    await mount();

    const event = await keyDown(document.body, { key: '√', code: 'KeyV', altKey: true });
    expect(event.defaultPrevented).toBe(true);
    expect(get(filesView).show).toBe('date');

    await keyDown(document.body, { key: '√', code: 'KeyV', altKey: true });
    expect(get(filesView).show).toBe('size');
  });

  it('does nothing for Alt+G, and leaves it to the browser, without log chains', async () => {
    await mount([]);

    const event = await keyDown(document.body, { key: '©', code: 'KeyG', altKey: true });

    expect(event.defaultPrevented).toBe(false);
    expect(get(chainMode)).toBe(false);
  });
});

describe('the files toolbar in the URL', () => {
  it('writes chains=1, labels=0 and show=date, and takes each out again', async () => {
    const { group, labels, date, size } = await mount();
    stopViewSync = startViewSync();
    const params = () => new URLSearchParams(window.location.search);

    group()?.click();
    labels()?.click();
    date()?.click();
    await tick();
    expect(params().get('chains')).toBe('1');
    expect(params().get('labels')).toBe('0');
    expect(params().get('show')).toBe('date');

    group()?.click();
    labels()?.click();
    size()?.click();
    await tick();
    expect(window.location.search).toBe('');
  });
});

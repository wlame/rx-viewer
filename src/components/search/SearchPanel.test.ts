// @vitest-environment jsdom
import '$lib/testing/matchMediaStub';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { writable } from 'svelte/store';
import { health, trace } from '$lib/stores';
import { chainMode } from '$lib/stores/chainMode';
import { registerModal } from '$lib/stores/layout';
import { searchRequest } from '$lib/stores/trace';
import SearchPanel from './SearchPanel.svelte';

// The real tree store loads its roots from the backend; the panel only
// needs one root to search in. The open tabs are a file and a log chain.
vi.mock('$lib/stores', async (importOriginal) => {
  const original = await importOriginal<typeof import('$lib/stores')>();
  return {
    ...original,
    tree: writable({ roots: [{ path: '/logs' }], loading: false }),
    files: writable({
      openFiles: [{ path: '/logs/notes.txt' }, { path: 'chain:/logs/app.log' }],
      matches: new Map(),
      activeFilePath: null,
    }),
  };
});

let panel: SearchPanel | null = null;

/** Mount the panel and return its first pattern field, with both searches stubbed out. */
function mount() {
  const search = vi.spyOn(trace, 'search').mockResolvedValue(null);
  const searchChains = vi.spyOn(trace, 'searchChains').mockResolvedValue(null);
  const target = document.createElement('div');
  document.body.appendChild(target);
  panel = new SearchPanel({ target });
  const input = target.querySelector<HTMLInputElement>('input[aria-label="Regex pattern 1"]');
  if (!input) throw new Error('the pattern field is not rendered');
  return { target, input, search, searchChains };
}

/** A backend whose `/health` lists `features`; chain mode as `isChainMode` says. */
async function backendWith(features: string[], isChainMode: boolean) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ contract_version: '1.7', features }),
      text: async () => '',
    })),
  );
  await health.check();
  chainMode.set(isChainMode);
}

/** Tick "Only opened files" under the panel's options. */
async function searchOnlyOpened(target: HTMLElement) {
  const options = [...target.querySelectorAll('button')].find((b) =>
    b.textContent?.includes('Options'),
  );
  options?.click();
  await tick();
  const onlyOpened = target.querySelector<HTMLInputElement>('#only-opened-files');
  if (!onlyOpened) throw new Error('the only-opened box is not rendered');
  onlyOpened.click();
  await tick();
}

async function typeValue(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await tick();
}

function keyDown(element: HTMLElement, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  element.dispatchEvent(event);
  return event;
}

afterEach(() => {
  panel?.$destroy();
  panel = null;
  vi.restoreAllMocks();
  searchRequest.set(null);
  chainMode.set(false);
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('SearchPanel pattern field', () => {
  it('runs the search on Enter', async () => {
    const { input, search } = mount();
    await typeValue(input, 'error|warn');

    const event = keyDown(input, { key: 'Enter' });

    expect(search).toHaveBeenCalledWith(['/logs'], ['error|warn'], expect.anything());
    expect(event.defaultPrevented).toBe(true);
  });

  // Enter confirms an input method's composition; Safari sends that
  // Enter with the key code 229 instead of isComposing.
  it.each([
    { key: 'Enter', isComposing: true },
    { key: 'Enter', keyCode: 229 },
  ])('leaves %o to the input method and does not search', async (init) => {
    const { input, search } = mount();
    await typeValue(input, 'erro');

    const event = keyDown(input, init);

    expect(search).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});

describe('SearchPanel route', () => {
  it('searches the roots with /v1/trace while chain mode is off', async () => {
    await backendWith(['log_chains'], false);
    const { input, search, searchChains } = mount();
    await typeValue(input, 'timeout');

    keyDown(input, { key: 'Enter' });

    expect(search).toHaveBeenCalledWith(['/logs'], ['timeout'], expect.anything());
    expect(searchChains).not.toHaveBeenCalled();
  });

  it('searches the same roots as log chains while chain mode is on', async () => {
    await backendWith(['log_chains'], true);
    const { input, search, searchChains } = mount();
    await typeValue(input, 'timeout');

    keyDown(input, { key: 'Enter' });

    expect(searchChains).toHaveBeenCalledWith(['/logs'], ['timeout'], expect.anything());
    expect(search).not.toHaveBeenCalled();
  });

  it('searches files with /v1/trace when the backend serves no log chains', async () => {
    await backendWith([], true);
    const { input, search, searchChains } = mount();
    await typeValue(input, 'timeout');

    keyDown(input, { key: 'Enter' });

    expect(search).toHaveBeenCalled();
    expect(searchChains).not.toHaveBeenCalled();
  });

  it("names each open chain's handle and each open file's path in chain mode", async () => {
    await backendWith(['log_chains'], true);
    const { target, input, searchChains } = mount();
    await searchOnlyOpened(target);
    await typeValue(input, 'timeout');

    keyDown(input, { key: 'Enter' });

    expect(searchChains).toHaveBeenCalledWith(
      ['/logs/notes.txt', '/logs/app.log'],
      ['timeout'],
      expect.anything(),
    );
    expect(target.querySelector('label[for="only-opened-files"]')?.textContent).toContain('(2)');
  });

  it('names only the open files with chain mode off', async () => {
    await backendWith(['log_chains'], false);
    const { target, input, search } = mount();
    await searchOnlyOpened(target);
    await typeValue(input, 'timeout');

    keyDown(input, { key: 'Enter' });

    expect(search).toHaveBeenCalledWith(['/logs/notes.txt'], ['timeout'], expect.anything());
    expect(target.querySelector('label[for="only-opened-files"]')?.textContent).toContain('(1)');
  });
});

/** The pressed state of the toggle named `name`. */
function pressed(target: HTMLElement, name: string): string | null {
  const button = target.querySelector(`button[aria-label="${name}"]`);
  if (!button) throw new Error(`no button named ${name}`);
  return button.getAttribute('aria-pressed');
}

// A Mac types the Option symbol as the key; the code names the letter.
const TOGGLE_KEYS: [string, string, KeyboardEventInit][] = [
  ['Alt+C', 'Match case', { key: 'ç', code: 'KeyC', altKey: true }],
  ['Alt+W', 'Match whole word', { key: '∑', code: 'KeyW', altKey: true }],
  ['Alt+R', 'Use regular expression', { key: '®', code: 'KeyR', altKey: true }],
];

describe('the search panel keys', () => {
  it.each(TOGGLE_KEYS)('%s switches %s from a pattern field', async (_key, name, init) => {
    await backendWith(['trace_matching_flags'], false);
    const { target, input } = mount();
    const before = pressed(target, name);
    input.focus();

    const event = keyDown(input, init);
    await tick();

    expect(event.defaultPrevented).toBe(true);
    expect(pressed(target, name)).not.toBe(before);
  });

  it.each(TOGGLE_KEYS)('%s switches %s from a toggle button', async (_key, name, init) => {
    await backendWith(['trace_matching_flags'], false);
    const { target } = mount();
    const before = pressed(target, name);
    const button = target.querySelector<HTMLButtonElement>('button[aria-label="Match case"]');
    if (!button) throw new Error('the toggles are not rendered');
    button.focus();

    const event = keyDown(button, init);
    await tick();

    expect(event.defaultPrevented).toBe(true);
    expect(pressed(target, name)).not.toBe(before);
  });

  it('sends the toggle a key switched with the next search', async () => {
    await backendWith(['trace_matching_flags'], false);
    const { input, search } = mount();
    await typeValue(input, 'timeout');

    keyDown(input, { key: 'ç', code: 'KeyC', altKey: true });
    await tick();
    keyDown(input, { key: 'Enter', code: 'Enter' });

    expect(search).toHaveBeenCalledWith(['/logs'], ['timeout'], {
      maxResults: 100,
      flags: { ignore_case: true },
    });
  });
});

/**
 * The search panel's keys belong to it only while the focus is inside it
 * and no dialog owns the keyboard; a key that does not act changes
 * nothing and is left to the browser.
 */
describe('the search panel keys while something else owns the keyboard', () => {
  it.each(TOGGLE_KEYS)(
    '%s with the focus outside the panel does nothing',
    async (_k, name, init) => {
      await backendWith(['trace_matching_flags'], false);
      const { target } = mount();
      const before = pressed(target, name);
      const elsewhere = document.body.appendChild(document.createElement('button'));
      elsewhere.focus();

      const event = keyDown(elsewhere, init);
      await tick();

      expect(event.defaultPrevented).toBe(false);
      expect(pressed(target, name)).toBe(before);
    },
  );

  it.each(TOGGLE_KEYS)(
    '%s does nothing on a backend that takes no match options',
    async (_key, name, init) => {
      await backendWith([], false);
      const { target, input } = mount();
      const before = pressed(target, name);
      input.focus();

      const event = keyDown(input, init);
      await tick();

      expect(event.defaultPrevented).toBe(false);
      expect(pressed(target, name)).toBe(before);
    },
  );

  it.each(TOGGLE_KEYS)('%s does nothing while a modal dialog is open', async (_key, name, init) => {
    await backendWith(['trace_matching_flags'], false);
    const { target, input } = mount();
    const before = pressed(target, name);
    const closeDialog = registerModal();
    try {
      const event = keyDown(input, init);
      await tick();

      expect(event.defaultPrevented).toBe(false);
      expect(pressed(target, name)).toBe(before);
    } finally {
      closeDialog();
    }
  });

  it('leaves Alt+C of an input method alone', async () => {
    await backendWith(['trace_matching_flags'], false);
    const { target, input } = mount();

    const event = keyDown(input, { key: 'ç', code: 'KeyC', altKey: true, isComposing: true });
    await tick();

    expect(event.defaultPrevented).toBe(false);
    expect(pressed(target, 'Match case')).toBe('true');
  });
});

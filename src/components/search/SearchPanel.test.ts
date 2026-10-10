// @vitest-environment jsdom
import '$lib/testing/matchMediaStub';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { get, writable } from 'svelte/store';
import { files, health, trace } from '$lib/stores';
import { chainMode } from '$lib/stores/chainMode';
import { registerModal } from '$lib/stores/layout';
import { draftFromSearch, searchDraft } from '$lib/stores/searchDraft';
import { searchRequest } from '$lib/stores/trace';
import type { SearchState } from '$lib/utils/urlState';
import SearchPanel from './SearchPanel.svelte';

// The real tree store loads its roots from the backend; the panel only
// needs one root to search in. The open tabs are a file and a log chain.
const OPEN_TABS = vi.hoisted(() => ({
  openFiles: [{ path: '/logs/notes.txt' }, { path: 'chain:/logs/app.log' }],
  matches: new Map(),
  activeFilePath: null,
}));
vi.mock('$lib/stores', async (importOriginal) => {
  const original = await importOriginal<typeof import('$lib/stores')>();
  return {
    ...original,
    tree: writable({ roots: [{ path: '/logs' }], loading: false }),
    files: writable(OPEN_TABS),
  };
});

/** The open tabs as the mocked store holds them. */
const openTabs = files as unknown as {
  set(value: {
    openFiles: { path: string }[];
    matches: Map<string, unknown>;
    activeFilePath: null;
  }): void;
};

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

/** The "only opened files" toggle of the options line. */
function onlyOpenedToggle(target: HTMLElement): HTMLButtonElement {
  const toggle = target.querySelector<HTMLButtonElement>(
    'button[aria-label="Search only the opened files"]',
  );
  if (!toggle) throw new Error('the only-opened toggle is not rendered');
  return toggle;
}

/** The max box of the options line. */
function maxBox(target: HTMLElement): HTMLInputElement {
  const box = target.querySelector<HTMLInputElement>('input[aria-label="Most matches"]');
  if (!box) throw new Error('the max box is not rendered');
  return box;
}

/** Turn "Only opened files" on with a click. */
async function searchOnlyOpened(target: HTMLElement) {
  onlyOpenedToggle(target).click();
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
  searchDraft.set(draftFromSearch(null));
  openTabs.set(OPEN_TABS);
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
    expect(onlyOpenedToggle(target).textContent?.trim()).toBe('2');
  });

  it('names only the open files with chain mode off', async () => {
    await backendWith(['log_chains'], false);
    const { target, input, search } = mount();
    await searchOnlyOpened(target);
    await typeValue(input, 'timeout');

    keyDown(input, { key: 'Enter' });

    expect(search).toHaveBeenCalledWith(['/logs/notes.txt'], ['timeout'], expect.anything());
    expect(onlyOpenedToggle(target).textContent?.trim()).toBe('1');
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
  ['Alt+O', 'Search only the opened files', { key: 'ø', code: 'KeyO', altKey: true }],
];
const ALT_O: KeyboardEventInit = { key: 'ø', code: 'KeyO', altKey: true };

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

  it.each(TOGGLE_KEYS)('%s switches %s from the max box', async (_key, name, init) => {
    await backendWith(['trace_matching_flags'], false);
    const { target } = mount();
    const before = pressed(target, name);
    maxBox(target).focus();

    const event = keyDown(maxBox(target), init);
    await tick();

    expect(event.defaultPrevented).toBe(true);
    expect(pressed(target, name)).not.toBe(before);
    expect(maxBox(target).value).toBe('100');
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

  it.each(TOGGLE_KEYS.slice(0, 3))(
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

  it('leaves Alt+O alone while no file is open, and the toggle off', async () => {
    const { target, input } = mount();
    openTabs.set({ openFiles: [], matches: new Map(), activeFilePath: null });
    await tick();

    const event = keyDown(input, ALT_O);
    await tick();

    expect(event.defaultPrevented).toBe(false);
    expect(onlyOpenedToggle(target).getAttribute('aria-disabled')).toBe('true');
    expect(pressed(target, 'Search only the opened files')).toBe('false');
  });

  // Turned on while files were open, it can still be turned off after
  // the last one closes; otherwise no search could run until a file opens.
  it('lets Alt+O turn only opened files off after the last file closed', async () => {
    const { target, input } = mount();
    await searchOnlyOpened(target);
    openTabs.set({ openFiles: [], matches: new Map(), activeFilePath: null });
    await tick();

    const event = keyDown(input, ALT_O);
    await tick();

    expect(event.defaultPrevented).toBe(true);
    expect(pressed(target, 'Search only the opened files')).toBe('false');
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

describe('a max the search cannot take', () => {
  /** Mount the panel with a pattern typed and `max` in the max box. */
  async function mountWithMax(max: string) {
    const mounted = mount();
    await typeValue(mounted.input, 'timeout');
    await typeValue(maxBox(mounted.target), max);
    return mounted;
  }

  function ruleOf(target: HTMLElement) {
    return target.querySelector<HTMLElement>('[data-max-rule]');
  }

  it('refuses Enter in a pattern field: nothing is sent and the focus goes to the max box', async () => {
    const { target, input, search } = await mountWithMax('0');
    input.focus();

    const event = keyDown(input, { key: 'Enter' });
    await tick();

    expect(event.defaultPrevented).toBe(true);
    expect(search).not.toHaveBeenCalled();
    expect(get(searchRequest)).toBeNull();
    expect(document.activeElement).toBe(maxBox(target));
    expect(maxBox(target).getAttribute('aria-invalid')).toBe('true');
    expect(ruleOf(target)?.getAttribute('role')).toBe('alert');
    expect(ruleOf(target)?.textContent?.trim()).toBe('max: 1 to 10,000');
  });

  it('refuses the Search button the same way', async () => {
    const { target, search } = await mountWithMax('10001');
    const button = [...target.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Search',
    );

    button?.click();
    await tick();

    expect(search).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(maxBox(target));
    expect(ruleOf(target)?.getAttribute('role')).toBe('alert');
  });

  it('runs once the max is fixed and Enter is pressed in the max box, with the max as typed', async () => {
    const { target, search } = await mountWithMax('12a');
    keyDown(target.querySelector('input') as HTMLInputElement, { key: 'Enter' });
    await tick();

    await typeValue(maxBox(target), '10000');
    const event = keyDown(maxBox(target), { key: 'Enter' });

    expect(event.defaultPrevented).toBe(true);
    expect(search).toHaveBeenCalledWith(['/logs'], ['timeout'], {
      maxResults: 10_000,
      flags: {},
    });
    expect(get(searchRequest)?.maxResults).toBe(10_000);
    expect(ruleOf(target)).toBeNull();
  });
});

describe('the search draft', () => {
  it('writes the search it runs as the search request, from the form', async () => {
    await backendWith(['trace_matching_flags'], false);
    const { target, input, search } = mount();
    await typeValue(input, 'timeout');
    await typeValue(maxBox(target), '50');
    await searchOnlyOpened(target);
    target.querySelector<HTMLButtonElement>('button[aria-label="Match whole word"]')?.click();
    await tick();

    keyDown(input, { key: 'Enter' });

    expect(get(searchRequest)).toEqual({
      patterns: ['timeout'],
      maxResults: 50,
      onlyOpenedFiles: true,
      flags: { word_regexp: true },
    });
    expect(search).toHaveBeenCalledWith(['/logs/notes.txt'], ['timeout'], {
      maxResults: 50,
      flags: { word_regexp: true },
    });
  });

  // The draft is a store: a panel built again shows what the last one held.
  it('keeps unsent patterns and options in a panel built again', async () => {
    await backendWith(['trace_matching_flags'], false);
    const first = mount();
    await typeValue(first.input, 'ERROR');
    await typeValue(maxBox(first.target), '50');
    first.target.querySelector<HTMLButtonElement>('button[aria-label="Match case"]')?.click();
    await tick();
    panel?.$destroy();

    const second = mount();
    await tick();

    expect(second.input.value).toBe('ERROR');
    expect(maxBox(second.target).value).toBe('50');
    expect(pressed(second.target, 'Match case')).toBe('false');
    expect(get(searchRequest)).toBeNull();
  });

  it("shows a link's search and runs it as the link names it", async () => {
    await backendWith(['trace_matching_flags'], false);
    const search: SearchState = {
      patterns: ['ERROR', 'WARN'],
      maxResults: 20,
      onlyOpenedFiles: false,
      flags: { ignore_case: true },
    };
    // What restoring a link does.
    searchDraft.set(draftFromSearch(search));
    searchRequest.set(search);

    const { target, search: run } = mount();
    await tick();

    const fields = [
      ...target.querySelectorAll<HTMLInputElement>('input[aria-label^="Regex pattern"]'),
    ];
    expect(fields.map((field) => field.value)).toEqual(['ERROR', 'WARN']);
    expect(maxBox(target).value).toBe('20');
    expect(pressed(target, 'Match case')).toBe('false');
    expect(run).toHaveBeenCalledWith(['/logs'], ['ERROR', 'WARN'], {
      maxResults: 20,
      flags: { ignore_case: true },
    });
  });

  it('adds and removes pattern fields in the draft', async () => {
    const { target } = mount();
    const addButton = [...target.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Add Pattern'),
    );

    addButton?.click();
    await tick();
    expect(get(searchDraft).patterns).toEqual(['', '']);

    target.querySelector<HTMLButtonElement>('button[title="Remove pattern"]')?.click();
    await tick();
    expect(get(searchDraft).patterns).toEqual(['']);
  });
});

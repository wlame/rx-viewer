// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { writable } from 'svelte/store';
import { trace } from '$lib/stores';
import SearchPanel from './SearchPanel.svelte';

// jsdom has no matchMedia, and the settings store asks it for the
// system theme when it is imported.
vi.hoisted(() => {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }) as unknown as MediaQueryList;
});

// The real tree store loads its roots from the backend; the panel only
// needs one root to search in.
vi.mock('$lib/stores', async (importOriginal) => {
  const original = await importOriginal<typeof import('$lib/stores')>();
  return { ...original, tree: writable({ roots: [{ path: '/logs' }], loading: false }) };
});

let panel: SearchPanel | null = null;

/** Mount the panel and return its first pattern field, with search stubbed out. */
function mount() {
  const search = vi.spyOn(trace, 'search').mockResolvedValue(null);
  const target = document.createElement('div');
  document.body.appendChild(target);
  panel = new SearchPanel({ target });
  const input = target.querySelector<HTMLInputElement>('input[aria-label="Regex pattern 1"]');
  if (!input) throw new Error('the pattern field is not rendered');
  return { input, search };
}

async function typeValue(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await tick();
}

function keyDown(input: HTMLInputElement, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  input.dispatchEvent(event);
  return event;
}

afterEach(() => {
  panel?.$destroy();
  panel = null;
  vi.restoreAllMocks();
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

// @vitest-environment jsdom
import '$lib/testing/matchMediaStub';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { get } from 'svelte/store';
import { TOOLTIP_ID } from '$lib/actions/tooltip';
import { DEFAULT_FILES_VIEW, filesView } from '$lib/stores/filesView';
import { registerModal, sidebarTab, sidebarVisible } from '$lib/stores/layout';
import { ICONS, type IconName } from '$lib/utils/icons';
import type { TreeSort } from '$lib/utils/treeSort';
import TreeHeader from './TreeHeader.svelte';

let mounted: TreeHeader | null = null;
let closeModal: (() => void) | null = null;

function mount() {
  const target = document.createElement('div');
  document.body.appendChild(target);
  mounted = new TreeHeader({ target });
  const buttons = () => [...target.querySelectorAll<HTMLButtonElement>('button')];
  return {
    target,
    name: () => buttons()[0],
    value: () => buttons()[1],
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

/** The arrow a header button draws, by the shapes of its icon, or null without one. */
function arrowOf(button: HTMLElement): IconName | null {
  const shapes = [...(button.querySelector('svg')?.children ?? [])];
  const names: IconName[] = ['arrow-up', 'arrow-down'];
  const drawn = names.find(
    (name) =>
      ICONS[name].length === shapes.length &&
      ICONS[name].every(
        (shape, i) =>
          shapes[i].tagName.toLowerCase() === shape.tag &&
          Object.entries(shape.attrs).every(
            ([attr, value]) => shapes[i].getAttribute(attr) === value,
          ),
      ),
  );
  return drawn ?? null;
}

const ALT_N: KeyboardEventInit = { key: 'Dead', code: 'KeyN', altKey: true };
const ALT_S: KeyboardEventInit = { key: 'ß', code: 'KeyS', altKey: true };
const sorted = (key: TreeSort['key'], dir: TreeSort['dir']): TreeSort => ({ key, dir });

afterEach(() => {
  mounted?.$destroy();
  mounted = null;
  closeModal?.();
  closeModal = null;
  filesView.set(DEFAULT_FILES_VIEW);
  sidebarTab.set('tree');
  sidebarVisible.set(true);
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('the column header of the files panel', () => {
  it('names Name on the left and the size on the right', () => {
    const { name, value } = mount();

    expect(name().textContent?.trim()).toBe('Name');
    expect(value().textContent?.trim()).toBe('Size');
  });

  it('names the date on the right while the date is shown', async () => {
    const { value } = mount();

    filesView.update((view) => ({ ...view, show: 'date' }));
    await tick();

    expect(value().textContent?.trim()).toBe('Date');
  });

  it('says the sort on the sorted column and only the action on the other', () => {
    const { name, value } = mount();

    expect(name().getAttribute('aria-label')).toBe('Sort by name, ascending');
    expect(value().getAttribute('aria-label')).toBe('Sort by size');
  });

  it('draws the arrow of the direction on the sorted column only', () => {
    const { name, value } = mount();

    expect(arrowOf(name())).toBe('arrow-up');
    expect(value().querySelector('svg')).toBeNull();
  });

  it('sorts by the size, largest first, then smallest first, then by name, A to Z and Z to A', async () => {
    const { name, value } = mount();
    const steps: [HTMLButtonElement, TreeSort, string, IconName][] = [
      [value(), sorted('size', 'desc'), 'Sort by size, descending', 'arrow-down'],
      [value(), sorted('size', 'asc'), 'Sort by size, ascending', 'arrow-up'],
      [name(), sorted('name', 'asc'), 'Sort by name, ascending', 'arrow-up'],
      [name(), sorted('name', 'desc'), 'Sort by name, descending', 'arrow-down'],
    ];

    for (const [button, sort, label, arrow] of steps) {
      button.click();
      await tick();

      expect(get(filesView).sort).toEqual(sort);
      expect(button.getAttribute('aria-label')).toBe(label);
      expect(arrowOf(button)).toBe(arrow);
    }
    expect(value().getAttribute('aria-label')).toBe('Sort by size');
    expect(value().querySelector('svg')).toBeNull();
  });

  it('sorts by the date, newest first, while the date is shown', async () => {
    const { value } = mount();
    filesView.update((view) => ({ ...view, show: 'date' }));
    await tick();

    value().click();
    await tick();

    expect(get(filesView).sort).toEqual(sorted('date', 'desc'));
    expect(value().getAttribute('aria-label')).toBe('Sort by date, descending');
  });

  // The gutter applies to a box that clips its overflow; it has the
  // width of the tree's thin scrollbar.
  it("reserves a gutter as wide as the tree's scrollbar, without scrolling", () => {
    const { name } = mount();
    const header = name().parentElement;

    expect(header?.classList).toContain('[scrollbar-gutter:stable]');
    expect(header?.classList).toContain('scrollbar-thin');
    expect(header?.classList).toContain('overflow-hidden');
  });

  it('stands outside the tree, as plain buttons', () => {
    const { target } = mount();

    expect(target.querySelector('[role="tree"], [role="treeitem"]')).toBeNull();
    expect(target.querySelectorAll('button[type="button"]')).toHaveLength(2);
  });
});

describe('the tooltips of the column header', () => {
  it('names sorting by name and its key, as a Mac prints it', () => {
    vi.stubGlobal('navigator', { platform: 'MacIntel', userAgent: '' });
    const { name } = mount();

    focusByKeyboard(name());

    expect(document.getElementById(TOOLTIP_ID)?.textContent).toBe('Sort by name⌥N');
  });

  it('names sorting by the value shown and its key', () => {
    vi.stubGlobal('navigator', { platform: 'Linux x86_64', userAgent: '' });
    const { value } = mount();

    focusByKeyboard(value());

    expect(document.getElementById(TOOLTIP_ID)?.textContent).toBe('Sort by sizeAlt+S');
  });
});

describe('the column header keys', () => {
  it('sorts by name with Alt+N, and again reverses it, keeping the key from the browser', async () => {
    mount();

    const event = await keyDown(document.body, ALT_N);
    expect(event.defaultPrevented).toBe(true);
    expect(get(filesView).sort).toEqual(sorted('name', 'desc'));

    await keyDown(document.body, ALT_N);
    expect(get(filesView).sort).toEqual(sorted('name', 'asc'));
  });

  it('sorts by the value shown with Alt+S, and again reverses it', async () => {
    mount();

    const event = await keyDown(document.body, ALT_S);
    expect(event.defaultPrevented).toBe(true);
    expect(get(filesView).sort).toEqual(sorted('size', 'desc'));

    await keyDown(document.body, ALT_S);
    expect(get(filesView).sort).toEqual(sorted('size', 'asc'));
  });

  it('sorts by the date with Alt+S while the date is shown', async () => {
    mount();
    filesView.update((view) => ({ ...view, show: 'date' }));

    await keyDown(document.body, ALT_S);

    expect(get(filesView).sort).toEqual(sorted('date', 'desc'));
  });

  it.each([
    ['while Search is shown', () => sidebarTab.set('search')],
    ['while the side panel is hidden', () => sidebarVisible.set(false)],
    ['while a dialog is open', () => (closeModal = registerModal())],
  ])(
    'does nothing for Alt+N or Alt+S, and leaves them to the browser, %s',
    async (_name, setUp) => {
      mount();
      setUp();

      for (const init of [ALT_N, ALT_S]) {
        const event = await keyDown(document.body, init);

        expect(event.defaultPrevented).toBe(false);
        expect(get(filesView).sort).toEqual(DEFAULT_FILES_VIEW.sort);
      }
    },
  );

  it('leaves N and S without Alt, and Alt+N of an input method, to the browser', async () => {
    mount();

    for (const init of [
      { key: 'n', code: 'KeyN' },
      { key: 's', code: 'KeyS' },
      { ...ALT_N, isComposing: true },
    ]) {
      const event = await keyDown(document.body, init);

      expect(event.defaultPrevented).toBe(false);
    }
    expect(get(filesView).sort).toEqual(DEFAULT_FILES_VIEW.sort);
  });
});

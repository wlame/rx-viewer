// @vitest-environment jsdom
import '$lib/testing/matchMediaStub';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { get } from 'svelte/store';
import { TOOLTIP_ID } from '$lib/actions/tooltip';
import { draftFromSearch, searchDraft } from '$lib/stores/searchDraft';
import SearchOptionsBar from './SearchOptionsBar.svelte';

let bar: SearchOptionsBar | null = null;

interface BarProps {
  togglesDisabled?: boolean;
  togglesUnavailable?: string | null;
  openCount?: number;
  onlyOpenedDisabled?: boolean;
}

/** Mount the options line with three opened files unless told otherwise. */
function mount(props: BarProps = {}) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  bar = new SearchOptionsBar({
    target,
    props: { openCount: 3, onlyOpenedDisabled: false, ...props },
  });
  const query = <T extends HTMLElement>(selector: string) => {
    const element = target.querySelector<T>(selector);
    if (!element) throw new Error(`nothing matches ${selector}`);
    return element;
  };
  return {
    target,
    bar,
    line: () => query('[role="group"][aria-label="Search options"]'),
    onlyOpened: () => query<HTMLButtonElement>('button[aria-label="Search only the opened files"]'),
    maxBox: () => query<HTMLInputElement>('input[aria-label="Most matches"]'),
    rule: () => target.querySelector<HTMLElement>('[data-max-rule]'),
  };
}

/** Focus `element` as the keyboard does, so its tooltip shows at once. */
function focusByKeyboard(element: HTMLElement) {
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
  element.focus();
}

async function typeValue(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await tick();
}

afterEach(() => {
  bar?.$destroy();
  bar = null;
  searchDraft.set(draftFromSearch(null));
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('the search options line', () => {
  it('holds the three toggles, only opened files and the max box, and no Options fold', () => {
    const { target, line, onlyOpened, maxBox } = mount();

    for (const name of ['Match case', 'Match whole word', 'Use regular expression']) {
      expect(line().querySelector(`button[aria-label="${name}"]`)).not.toBeNull();
    }
    expect(line().contains(onlyOpened())).toBe(true);
    expect(line().contains(maxBox())).toBe(true);
    expect(target.textContent).not.toContain('Options');
  });

  // A length limit would cut a pasted 100000 to 10000 without a word.
  it('has a plain text max box five characters wide, with no length limit and no spinner arrows', () => {
    const { target, maxBox } = mount();

    expect(maxBox().getAttribute('type')).toBe('text');
    expect(maxBox().getAttribute('inputmode')).toBe('numeric');
    expect(maxBox().getAttribute('size')).toBe('5');
    expect(maxBox().hasAttribute('maxlength')).toBe(false);
    expect(target.querySelector('input[type="number"]')).toBeNull();
  });

  it("shows the draft's max as typed and keeps what is typed in the draft", async () => {
    const { maxBox } = mount();
    expect(maxBox().value).toBe('100');

    await typeValue(maxBox(), '050');

    expect(get(searchDraft).maxResults).toBe('050');
  });

  it('switches a match toggle in the draft on a click', async () => {
    const { line } = mount();

    line().querySelector<HTMLButtonElement>('button[aria-label="Match case"]')?.click();
    await tick();

    expect(get(searchDraft).toggles.matchCase).toBe(false);
  });
});

describe('the match toggles', () => {
  function matchCase(target: HTMLElement): HTMLButtonElement {
    const button = target.querySelector<HTMLButtonElement>('button[aria-label="Match case"]');
    if (!button) throw new Error('no Match case toggle');
    return button;
  }

  it.each([
    ['MacIntel', 'Match case⌥COff: ripgrep -i'],
    ['Linux x86_64', 'Match caseAlt+COff: ripgrep -i'],
  ])('names Aa, its key as %s prints it, and the ripgrep flag in its tooltip', (platform, text) => {
    vi.stubGlobal('navigator', { platform, userAgent: '' });
    const { target } = mount();

    focusByKeyboard(matchCase(target));

    expect(document.getElementById(TOOLTIP_ID)?.textContent).toBe(text);
    expect(matchCase(target).hasAttribute('title')).toBe(false);
  });

  it('says why in its tooltip on a backend that takes no match options, and does not switch', async () => {
    vi.stubGlobal('navigator', { platform: 'Linux x86_64', userAgent: '' });
    const reason = 'This backend does not take match options';
    const { target } = mount({ togglesUnavailable: reason });

    matchCase(target).click();
    await tick();
    focusByKeyboard(matchCase(target));

    expect(matchCase(target).getAttribute('aria-disabled')).toBe('true');
    expect(matchCase(target).disabled).toBe(false);
    expect(document.activeElement).toBe(matchCase(target));
    expect(document.getElementById(TOOLTIP_ID)?.textContent).toBe(reason);
    expect(get(searchDraft).toggles.matchCase).toBe(true);
  });

  it('keeps the focus but does not switch, and names no key, while there is no root', async () => {
    vi.stubGlobal('navigator', { platform: 'Linux x86_64', userAgent: '' });
    const { target } = mount({ togglesDisabled: true });

    matchCase(target).click();
    await tick();
    focusByKeyboard(matchCase(target));

    expect(matchCase(target).getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(matchCase(target));
    expect(document.getElementById(TOOLTIP_ID)?.textContent).toBe('Match caseOff: ripgrep -i');
    expect(get(searchDraft).toggles.matchCase).toBe(true);
  });
});

describe('only opened files', () => {
  it('shows the number of opened files beside its icon, pressed as the draft says', async () => {
    const { onlyOpened } = mount({ openCount: 3 });

    expect(onlyOpened().textContent?.trim()).toBe('3');
    expect(onlyOpened().querySelector('svg')).not.toBeNull();
    expect(onlyOpened().getAttribute('aria-pressed')).toBe('false');

    searchDraft.update((draft) => ({ ...draft, onlyOpenedFiles: true }));
    await tick();

    expect(onlyOpened().getAttribute('aria-pressed')).toBe('true');
  });

  it.each([
    [3, 'Search only the 3 opened filesAlt+O'],
    [1, 'Search only the 1 opened fileAlt+O'],
  ])('names the %d opened files and the key in its tooltip', (openCount, text) => {
    vi.stubGlobal('navigator', { platform: 'Linux x86_64', userAgent: '' });
    const { onlyOpened } = mount({ openCount });

    focusByKeyboard(onlyOpened());

    expect(document.getElementById(TOOLTIP_ID)?.textContent).toBe(text);
  });

  it('asks the panel to switch it on a click', () => {
    const { bar: component, onlyOpened } = mount();
    const asked = vi.fn();
    component.$on('switchOnlyOpened', asked);

    onlyOpened().click();

    expect(asked).toHaveBeenCalledTimes(1);
  });

  it('is disabled with "No file is open" while no file is open, and asks nothing', () => {
    vi.stubGlobal('navigator', { platform: 'Linux x86_64', userAgent: '' });
    const { bar: component, onlyOpened } = mount({ openCount: 0, onlyOpenedDisabled: true });
    const asked = vi.fn();
    component.$on('switchOnlyOpened', asked);

    onlyOpened().click();
    focusByKeyboard(onlyOpened());

    expect(onlyOpened().getAttribute('aria-disabled')).toBe('true');
    expect(asked).not.toHaveBeenCalled();
    expect(document.getElementById(TOOLTIP_ID)?.textContent).toBe('No file is open');
  });
});

describe('the max box', () => {
  it('says what it does in its tooltip', () => {
    const { maxBox } = mount();

    focusByKeyboard(maxBox());

    expect(document.getElementById(TOOLTIP_ID)?.textContent).toBe('Stop after this many matches');
  });

  it.each(['', '0', '10001', '100000', '12a', ' 5'])(
    'marks %j red and invalid, with the rule under the line',
    async (text) => {
      const { maxBox, rule } = mount();

      await typeValue(maxBox(), text);

      expect(maxBox().getAttribute('aria-invalid')).toBe('true');
      expect(maxBox().className).toContain('border-gh-danger-emphasis');
      // The box keeps the focus after a refused run: red while focused too.
      expect(maxBox().className).toContain('focus:border-gh-danger-emphasis');
      expect(maxBox().className).toContain('dark:focus:border-gh-danger-dark-emphasis');
      expect(rule()?.textContent?.trim()).toBe('max: 1 to 10,000');
      expect(rule()?.getAttribute('role')).toBeNull();
      expect(maxBox().getAttribute('aria-describedby')).toContain(rule()?.id);
      // The text stays as typed: it is never changed into a value in range.
      expect(maxBox().value).toBe(text);
    },
  );

  it('shows no rule and no red state for a valid max', () => {
    const { maxBox, rule } = mount();

    expect(maxBox().getAttribute('aria-invalid')).toBeNull();
    expect(maxBox().className).not.toContain('border-gh-danger-emphasis');
    expect(rule()).toBeNull();
  });

  it('announces the rule and takes the focus when a run is refused', async () => {
    const { bar: component, maxBox, rule } = mount();
    await typeValue(maxBox(), '0');

    component.refuseMax();
    await tick();

    expect(rule()?.getAttribute('role')).toBe('alert');
    expect(document.activeElement).toBe(maxBox());
  });

  it('drops the rule once the max is valid again', async () => {
    const { bar: component, maxBox, rule } = mount();
    await typeValue(maxBox(), '0');
    component.refuseMax();
    await tick();

    await typeValue(maxBox(), '20');

    expect(rule()).toBeNull();
    expect(maxBox().getAttribute('aria-invalid')).toBeNull();
  });

  it('asks the panel to run the search on Enter', () => {
    const { bar: component, maxBox } = mount();
    const run = vi.fn();
    component.$on('run', run);

    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    maxBox().dispatchEvent(event);

    expect(run).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('leaves the Enter of an input method alone', () => {
    const { bar: component, maxBox } = mount();
    const run = vi.fn();
    component.$on('run', run);

    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      isComposing: true,
      bubbles: true,
      cancelable: true,
    });
    maxBox().dispatchEvent(event);

    expect(run).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});

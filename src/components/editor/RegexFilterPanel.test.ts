// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import RegexFilterPanel from './RegexFilterPanel.svelte';

type Mode = 'hide' | 'show' | 'highlight';

let panel: RegexFilterPanel | null = null;

/** Mount the panel with `pattern`, recording the events it sends. */
function mount(pattern = '', mode: Mode = 'highlight') {
  const target = document.createElement('div');
  document.body.appendChild(target);
  panel = new RegexFilterPanel({ target, props: { pattern, mode } });
  const apply = vi.fn();
  const close = vi.fn();
  panel.$on('apply', (event) => apply(event.detail));
  panel.$on('close', close);
  const input = target.querySelector<HTMLInputElement>('input#regex-filter-input');
  const overlay = target.querySelector<HTMLElement>('pre[aria-hidden="true"]');
  if (!input || !overlay) throw new Error('the pattern box is not rendered');
  return { input, overlay, apply, close };
}

/** Type into the box the way the browser reports it: a new value, then an input event. */
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

/** A paste event carrying `text` as plain text. */
function paste(input: HTMLInputElement, text: string): Event {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: { getData: (type: string) => (type === 'text/plain' ? text : '') },
  });
  input.dispatchEvent(event);
  return event;
}

afterEach(() => {
  panel?.$destroy();
  panel = null;
  document.body.replaceChildren();
});

describe('RegexFilterPanel pattern box', () => {
  it('is a text input holding the pattern it was given', () => {
    const { input } = mount('error|warn');

    expect(input.type).toBe('text');
    expect(input.value).toBe('error|warn');
  });

  it('paints the pattern in the overlay as it is typed', async () => {
    const { input, overlay } = mount();

    await typeValue(input, '(a)+');

    expect(overlay.textContent).toBe('(a)+');
    expect(overlay.querySelector('.token.group')?.textContent).toBe('(');
    expect(overlay.querySelector('.token.quantifier')?.textContent).toBe('+');
  });

  it.each(['&lt;', '<script>alert(1)</script>', '<img src=x onerror=alert(1)>'])(
    'shows markup in the pattern %s as text and builds no element from it',
    async (pattern) => {
      const { input, overlay } = mount();

      await typeValue(input, pattern);

      expect(overlay.textContent).toBe(pattern);
      expect(overlay.querySelector('script, img')).toBeNull();
      for (const element of overlay.querySelectorAll('*')) {
        expect(element.tagName).toBe('SPAN');
      }
    },
  );

  it('applies the typed pattern and the mode on Enter', async () => {
    const { input, apply } = mount('', 'hide');
    await typeValue(input, 'error|warn');

    const event = keyDown(input, { key: 'Enter' });

    expect(apply).toHaveBeenCalledWith({ pattern: 'error|warn', mode: 'hide' });
    expect(event.defaultPrevented).toBe(true);
  });

  it('closes on Escape', () => {
    const { input, close } = mount('x');

    const event = keyDown(input, { key: 'Escape' });

    expect(close).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  // Enter and Escape end or cancel an input method's composition; they
  // are the composition's, not the filter's.
  it('leaves Enter and Escape to an input method while it composes', () => {
    const { input, apply, close } = mount('x');

    const enter = keyDown(input, { key: 'Enter', isComposing: true });
    const escape = keyDown(input, { key: 'Escape', isComposing: true });

    expect(apply).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(enter.defaultPrevented).toBe(false);
    expect(escape.defaultPrevented).toBe(false);
  });

  it('leaves other keys, Cmd+A among them, to the browser', () => {
    const { input, apply, close } = mount('x');

    const selectAll = keyDown(input, { key: 'a', metaKey: true });

    expect(selectAll.defaultPrevented).toBe(false);
    expect(apply).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  it('pastes only the first line of a multi-line text, at the caret', async () => {
    const { input, overlay, apply } = mount('ab');
    input.setSelectionRange(1, 1);

    const event = paste(input, 'x|y\nsecond line\nthird');
    await tick();

    expect(event.defaultPrevented).toBe(true);
    expect(input.value).toBe('ax|yb');
    expect(input.selectionStart).toBe(4);
    expect(overlay.textContent).toBe('ax|yb');
    keyDown(input, { key: 'Enter' });
    expect(apply).toHaveBeenCalledWith({ pattern: 'ax|yb', mode: 'highlight' });
  });

  it('pastes over the selection', async () => {
    const { input } = mount('abcd');
    input.setSelectionRange(1, 3);

    paste(input, 'X\r\nY');
    await tick();

    expect(input.value).toBe('aXd');
  });

  it('leaves the paste of a single line to the browser', () => {
    const { input } = mount('ab');

    const event = paste(input, 'one line');

    expect(event.defaultPrevented).toBe(false);
  });

  it('scrolls the overlay with the input', async () => {
    const { input, overlay } = mount('a'.repeat(400));
    const painted = overlay.querySelector<HTMLElement>('[data-overlay-text]');
    if (!painted) throw new Error('the overlay has no painted text');

    // jsdom does no layout, so the scroll position the browser would set
    // is given here.
    Object.defineProperty(input, 'scrollLeft', { value: 137, configurable: true });
    input.dispatchEvent(new Event('scroll'));
    await tick();

    expect(painted.style.transform).toBe('translateX(-137px)');
  });

  it('follows a pattern set from outside, as when a selection is sent to the filter', async () => {
    const { input, overlay } = mount('old');

    panel?.$set({ pattern: 'new|pattern' });
    await tick();

    expect(input.value).toBe('new|pattern');
    expect(overlay.textContent).toBe('new|pattern');
  });
});

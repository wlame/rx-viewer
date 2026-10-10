// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import TooltipHarness from '$lib/testing/TooltipHarness.svelte';
import {
  TOOLTIP_DELAY_MS,
  TOOLTIP_EDGE_PX,
  TOOLTIP_GAP_PX,
  TOOLTIP_ID,
  tooltipPosition,
  type TooltipParams,
} from './tooltip';

const MAC_NAVIGATOR = { platform: 'MacIntel', userAgent: '' };
const LINUX_NAVIGATOR = { platform: 'Linux x86_64', userAgent: '' };

const harnesses: TooltipHarness[] = [];

/** Mount a button that carries `params` as its tooltip. */
function mount(params: TooltipParams) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const harness = new TooltipHarness({ target, props: { params } });
  harnesses.push(harness);
  const trigger = target.querySelector('button');
  if (!trigger) throw new Error('the harness drew no button');
  return { harness, trigger };
}

/** The tooltip element while it is shown, else null. */
function shownTooltip(): HTMLElement | null {
  const element = document.getElementById(TOOLTIP_ID);
  return element && !element.hidden ? element : null;
}

/** Focus as Tab does, so the element matches `:focus-visible`. */
function focusByKeyboard(element: HTMLElement) {
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
  element.focus();
}

/** Focus as Tab does and check that the tooltip is shown, before a test hides it. */
function showByKeyboard(element: HTMLElement) {
  focusByKeyboard(element);
  expect(shownTooltip()).not.toBeNull();
}

/** Focus as a click does, so the element does not match `:focus-visible`. */
function focusByMouse(element: HTMLElement) {
  element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  element.focus();
}

function hover(element: HTMLElement) {
  element.dispatchEvent(new MouseEvent('mouseenter'));
}

/** An IntersectionObserver the test drives: `report` says whether the trigger is drawn. */
class FakeIntersectionObserver {
  static latest: FakeIntersectionObserver | null = null;
  observed: Element[] = [];
  isDisconnected = false;

  constructor(private readonly callback: IntersectionObserverCallback) {
    FakeIntersectionObserver.latest = this;
  }

  observe(target: Element) {
    this.observed.push(target);
  }

  unobserve() {}

  disconnect() {
    this.isDisconnected = true;
  }

  takeRecords() {
    return [];
  }

  report(isIntersecting: boolean) {
    const entries = this.observed.map(
      (target) => ({ target, isIntersecting }) as unknown as IntersectionObserverEntry,
    );
    this.callback(entries, this as unknown as IntersectionObserver);
  }
}

beforeEach(() => {
  vi.useFakeTimers();
});

/**
 * jsdom judges `:focus-visible` from the element focused before, even
 * one removed while focused, which would make the next test's keyboard
 * focus read as a mouse focus. A focus and blur of a fresh button forgets it.
 */
function forgetFocus() {
  const scratch = document.body.appendChild(document.createElement('button'));
  scratch.focus();
  scratch.blur();
  scratch.remove();
}

afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.$destroy();
  forgetFocus();
  FakeIntersectionObserver.latest = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('the tooltip action', () => {
  it('waits half a second', () => {
    expect(TOOLTIP_DELAY_MS).toBe(500);
    expect(TOOLTIP_ID).toBe('rx-tooltip');
  });

  it('shows the label after the hover delay and not before', () => {
    const { trigger } = mount({ label: 'Show labels' });

    hover(trigger);
    vi.advanceTimersByTime(TOOLTIP_DELAY_MS - 1);
    expect(shownTooltip()).toBeNull();

    vi.advanceTimersByTime(1);
    const shown = shownTooltip();
    expect(shown?.getAttribute('role')).toBe('tooltip');
    expect(shown?.textContent).toBe('Show labels');
    expect(shown?.parentElement).toBe(document.body);
  });

  it('shows nothing when the pointer leaves before the delay', () => {
    const { trigger } = mount({ label: 'Show labels' });

    hover(trigger);
    vi.advanceTimersByTime(TOOLTIP_DELAY_MS / 2);
    trigger.dispatchEvent(new MouseEvent('mouseleave'));
    vi.advanceTimersByTime(TOOLTIP_DELAY_MS);

    expect(shownTooltip()).toBeNull();
  });

  it('hides when the pointer leaves', () => {
    const { trigger } = mount({ label: 'Show labels' });
    hover(trigger);
    vi.advanceTimersByTime(TOOLTIP_DELAY_MS);

    trigger.dispatchEvent(new MouseEvent('mouseleave'));

    expect(shownTooltip()).toBeNull();
  });

  it('shows at once on keyboard focus and hides on blur', () => {
    const { trigger } = mount({ label: 'Files' });

    focusByKeyboard(trigger);
    expect(shownTooltip()?.textContent).toBe('Files');

    trigger.blur();
    expect(shownTooltip()).toBeNull();
  });

  it('shows nothing at once on a focus by the mouse', () => {
    const { trigger } = mount({ label: 'Files' });

    focusByMouse(trigger);

    expect(shownTooltip()).toBeNull();
  });

  it('describes its trigger only while shown', () => {
    const { trigger } = mount({ label: 'Files' });

    focusByKeyboard(trigger);
    expect(trigger.getAttribute('aria-describedby')).toBe(TOOLTIP_ID);

    trigger.blur();
    expect(trigger.hasAttribute('aria-describedby')).toBe(false);
  });

  it('keeps a description the trigger had before', () => {
    const { trigger } = mount({ label: 'Files' });
    trigger.setAttribute('aria-describedby', 'files-hint');

    focusByKeyboard(trigger);
    expect(trigger.getAttribute('aria-describedby')).toBe(`files-hint ${TOOLTIP_ID}`);

    trigger.blur();
    expect(trigger.getAttribute('aria-describedby')).toBe('files-hint');
  });

  it('hides on Escape on its trigger and leaves the key to others', () => {
    const { trigger } = mount({ label: 'Files' });
    showByKeyboard(trigger);

    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    trigger.dispatchEvent(escape);

    expect(shownTooltip()).toBeNull();
    expect(trigger.hasAttribute('aria-describedby')).toBe(false);
    expect(escape.defaultPrevented).toBe(false);
  });

  it('stays on an Escape that cancels a composition', () => {
    const { trigger } = mount({ label: 'Files' });
    focusByKeyboard(trigger);

    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true }));

    expect(shownTooltip()).not.toBeNull();
  });

  it('hides on a scroll anywhere', () => {
    const { trigger } = mount({ label: 'Files' });
    const list = document.body.appendChild(document.createElement('div'));
    showByKeyboard(trigger);
    vi.advanceTimersToNextFrame();

    list.dispatchEvent(new Event('scroll'));

    expect(shownTooltip()).toBeNull();
  });

  // A focus that scrolls its trigger into view sends `scroll` after
  // `focus`, before the next frame's animation callbacks.
  it('stays through the scroll its keyboard focus causes, and hides on a later one', () => {
    const { trigger } = mount({ label: 'Files' });
    const list = document.body.appendChild(document.createElement('div'));
    showByKeyboard(trigger);

    list.dispatchEvent(new Event('scroll'));
    expect(shownTooltip()?.textContent).toBe('Files');

    vi.advanceTimersToNextFrame();
    list.dispatchEvent(new Event('scroll'));
    expect(shownTooltip()).toBeNull();
  });

  it('hides on a pointer press anywhere', () => {
    const { trigger } = mount({ label: 'Files' });
    showByKeyboard(trigger);

    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));

    expect(shownTooltip()).toBeNull();
  });

  it('shows nothing after a press on its trigger during the hover delay', () => {
    const { trigger } = mount({ label: 'Files' });

    hover(trigger);
    trigger.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    vi.advanceTimersByTime(TOOLTIP_DELAY_MS);

    expect(shownTooltip()).toBeNull();
  });

  it('shows its detail on a second line', () => {
    const { trigger } = mount({
      label: 'Group rotated logs',
      detail: 'app.log, app.log.1, app.log.2.gz … as one log chain',
    });

    focusByKeyboard(trigger);

    const lines = shownTooltip()?.children;
    expect(lines).toHaveLength(2);
    expect(lines?.[0].textContent).toBe('Group rotated logs');
    expect(lines?.[1].textContent).toBe('app.log, app.log.1, app.log.2.gz … as one log chain');
  });

  it('takes a new label while shown, as a toggle does when it changes', async () => {
    const { harness, trigger } = mount({ label: 'Show labels' });
    focusByKeyboard(trigger);

    harness.$set({ params: { label: 'Hide labels' } });
    await tick();

    expect(shownTooltip()?.textContent).toBe('Hide labels');
  });

  it('shows nothing when its label changes while hidden', async () => {
    const { harness } = mount({ label: 'Show labels' });

    harness.$set({ params: { label: 'Hide labels' } });
    await tick();

    expect(shownTooltip()).toBeNull();
  });

  it('places itself below its trigger, centred on it', () => {
    const { trigger } = mount({ label: 'Files' });
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 50, 40, 20));

    focusByKeyboard(trigger);

    // jsdom lays nothing out, so the tooltip measures 0 × 0.
    expect(shownTooltip()?.style.left).toBe('120px');
    expect(shownTooltip()?.style.top).toBe(`${50 + 20 + TOOLTIP_GAP_PX}px`);
  });

  it('places itself right of its trigger, centred on it, when its placement is right', () => {
    const { trigger } = mount({ label: 'Files', placement: 'right' });
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 40, 40));

    focusByKeyboard(trigger);

    expect(shownTooltip()?.style.left).toBe(`${40 + TOOLTIP_GAP_PX}px`);
    expect(shownTooltip()?.style.top).toBe('120px');
  });

  // A box with `position: fixed` and `left` set is at most as wide as the
  // room right of `left`. The stub gives jsdom that rule: the tooltip is
  // 10 px per character, cut to the room right of its current `left`.
  it('measures itself away from where the last tooltip stood', () => {
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.id !== TOOLTIP_ID) return 0;
      const room = window.innerWidth - (parseFloat(this.style.left) || 0);
      return Math.min((this.textContent ?? '').length * 10, room);
    });
    const nearRightEdge = mount({ label: 'Help' });
    vi.spyOn(nearRightEdge.trigger, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(window.innerWidth - 24, 10, 20, 20),
    );
    showByKeyboard(nearRightEdge.trigger);
    expect(shownTooltip()?.style.left).toBe(`${window.innerWidth - TOOLTIP_EDGE_PX - 40}px`);
    nearRightEdge.trigger.blur();

    const wider = mount({ label: 'Group rotated logs' });
    vi.spyOn(wider.trigger, 'getBoundingClientRect').mockReturnValue(new DOMRect(400, 10, 20, 20));
    showByKeyboard(wider.trigger);

    // 180 px wide, centred on x = 410.
    expect(shownTooltip()?.style.left).toBe(`${410 - 90}px`);
  });
});

describe('the keys in a tooltip', () => {
  function shownKeys(): string[] {
    return [...(shownTooltip()?.querySelectorAll('kbd') ?? [])].map((kbd) => kbd.textContent ?? '');
  }

  it('are the Mac keys of the shortcut on a Mac', () => {
    vi.stubGlobal('navigator', MAC_NAVIGATOR);
    const { trigger } = mount({ label: 'Search', shortcut: 'focusSearch' });

    focusByKeyboard(trigger);

    expect(shownKeys()).toEqual(['⌘', 'K']);
    expect(shownTooltip()?.textContent).toBe('Search⌘K');
  });

  it('are named and joined by plus signs elsewhere', () => {
    vi.stubGlobal('navigator', LINUX_NAVIGATOR);
    const { trigger } = mount({ label: 'Search', shortcut: 'focusSearch' });

    focusByKeyboard(trigger);

    expect(shownKeys()).toEqual(['Ctrl', 'K']);
    expect(shownTooltip()?.textContent).toBe('SearchCtrl+K');
  });

  it('are those of the first chord of the row only', () => {
    vi.stubGlobal('navigator', LINUX_NAVIGATOR);
    const { trigger } = mount({ label: 'Go to line', shortcut: 'gotoLine' });

    focusByKeyboard(trigger);

    expect(shownKeys()).toEqual([':']);
  });

  it('are absent without a shortcut', () => {
    const { trigger } = mount({ label: 'Files' });

    showByKeyboard(trigger);

    expect(shownKeys()).toEqual([]);
  });
});

describe('a tooltip whose trigger goes away while it is shown', () => {
  it('hides when the trigger is destroyed', () => {
    const { harness, trigger } = mount({ label: 'Show labels' });
    showByKeyboard(trigger);

    harness.$destroy();

    expect(shownTooltip()).toBeNull();
    expect(trigger.hasAttribute('aria-describedby')).toBe(false);
  });

  it('lets a second trigger show its own label after the first is destroyed', () => {
    const first = mount({ label: 'Show labels' });
    showByKeyboard(first.trigger);
    first.harness.$destroy();

    const second = mount({ label: 'Search' });
    hover(second.trigger);
    vi.advanceTimersByTime(TOOLTIP_DELAY_MS);

    expect(shownTooltip()?.textContent).toBe('Search');
    expect(second.trigger.getAttribute('aria-describedby')).toBe(TOOLTIP_ID);
  });

  it('leaves no listener of the destroyed trigger behind', () => {
    const added = vi.spyOn(window, 'addEventListener');
    const removed = vi.spyOn(window, 'removeEventListener');
    const { harness, trigger } = mount({ label: 'Show labels' });
    showByKeyboard(trigger);

    harness.$destroy();

    const windowListeners = added.mock.calls.filter(([type]) =>
      ['scroll', 'pointerdown'].includes(type),
    );
    expect(windowListeners).toHaveLength(2);
    for (const call of windowListeners) expect(removed).toHaveBeenCalledWith(...call);
    // The trigger's own listeners: a hover or a focus on the removed button shows nothing.
    hover(trigger);
    vi.advanceTimersByTime(TOOLTIP_DELAY_MS);
    expect(shownTooltip()).toBeNull();
    vi.spyOn(trigger, 'matches').mockReturnValue(true);
    trigger.dispatchEvent(new FocusEvent('focus'));
    expect(shownTooltip()).toBeNull();
    expect(() => window.dispatchEvent(new Event('scroll'))).not.toThrow();
    expect(shownTooltip()).toBeNull();
  });

  it('hides when the trigger stops being drawn, as when its panel is hidden', () => {
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    const { trigger } = mount({ label: 'Show labels' });
    focusByKeyboard(trigger);
    const watch = FakeIntersectionObserver.latest;
    expect(watch?.observed).toEqual([trigger]);

    watch?.report(true);
    expect(shownTooltip()).not.toBeNull();

    watch?.report(false);
    expect(shownTooltip()).toBeNull();
    expect(trigger.hasAttribute('aria-describedby')).toBe(false);
    expect(watch?.isDisconnected).toBe(true);
  });
});

describe('the text of a tooltip', () => {
  it('shows markup in a label or a detail as text', () => {
    const { trigger } = mount({
      label: '<img src=x onerror=alert(1)>',
      detail: '<b>bold</b>',
    });

    focusByKeyboard(trigger);

    expect(shownTooltip()?.querySelector('img')).toBeNull();
    expect(shownTooltip()?.querySelector('b')).toBeNull();
    expect(shownTooltip()?.textContent).toBe('<img src=x onerror=alert(1)><b>bold</b>');
  });
});

describe('tooltipPosition', () => {
  const viewport = { width: 800, height: 600 };
  const size = { width: 60, height: 24 };

  it('is below the trigger and centred on it', () => {
    const anchor = new DOMRect(100, 50, 40, 20);

    expect(tooltipPosition(anchor, size, viewport)).toEqual({
      left: 100 + 20 - 30,
      top: 50 + 20 + TOOLTIP_GAP_PX,
    });
  });

  it('flips above the trigger when below would leave the window', () => {
    const anchor = new DOMRect(100, 570, 40, 20);

    expect(tooltipPosition(anchor, size, viewport).top).toBe(570 - TOOLTIP_GAP_PX - 24);
  });

  it('keeps 8 pixels from the left and right edges', () => {
    expect(TOOLTIP_EDGE_PX).toBe(8);
    expect(tooltipPosition(new DOMRect(0, 50, 20, 20), size, viewport).left).toBe(8);
    expect(tooltipPosition(new DOMRect(790, 50, 10, 20), size, viewport).left).toBe(800 - 8 - 60);
  });

  it('keeps 8 pixels from the top in a window too low for either side', () => {
    const anchor = new DOMRect(100, 10, 40, 20);

    expect(tooltipPosition(anchor, size, { width: 800, height: 50 }).top).toBe(8);
  });

  it('starts at the left margin when it is wider than the window', () => {
    const anchor = new DOMRect(100, 50, 40, 20);

    expect(tooltipPosition(anchor, { width: 900, height: 24 }, viewport).left).toBe(8);
  });

  it('is right of the trigger and centred on it when its placement is right', () => {
    const anchor = new DOMRect(0, 100, 40, 40);

    expect(tooltipPosition(anchor, size, viewport, 'right')).toEqual({
      left: 40 + TOOLTIP_GAP_PX,
      top: 100 + 20 - 12,
    });
  });

  it('flips left of the trigger when right would leave the window', () => {
    const anchor = new DOMRect(760, 100, 40, 40);

    expect(tooltipPosition(anchor, size, viewport, 'right').left).toBe(760 - TOOLTIP_GAP_PX - 60);
  });

  it('keeps 8 pixels from the top and bottom when its placement is right', () => {
    expect(tooltipPosition(new DOMRect(0, 0, 40, 10), size, viewport, 'right').top).toBe(8);
    expect(tooltipPosition(new DOMRect(0, 590, 40, 10), size, viewport, 'right').top).toBe(
      600 - 8 - 24,
    );
  });
});

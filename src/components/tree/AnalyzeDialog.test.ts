// @vitest-environment jsdom
import '$lib/testing/matchMediaStub';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AnalyzeDialog from './AnalyzeDialog.svelte';

// The analysis waits on the backend; here it never answers, so the
// dialog stays in its loading state.
vi.mock('$lib/indexTasks', () => ({ analyzeFile: () => new Promise(() => {}) }));

let dialog: AnalyzeDialog | null = null;

/** Mount the dialog on screen, recording its close events. */
function mount() {
  const target = document.createElement('div');
  document.body.appendChild(target);
  dialog = new AnalyzeDialog({ target, props: { path: '/logs/app.log', name: 'app.log' } });
  const close = vi.fn();
  dialog.$on('close', close);
  const backdrop = target.querySelector<HTMLElement>('div[role="presentation"]');
  if (!backdrop) throw new Error('the dialog is not rendered');
  // jsdom does no layout; the dialog checks it has a box before it
  // takes Escape, so the test gives it one.
  backdrop.getClientRects = () => [new DOMRect(0, 0, 800, 600)] as unknown as DOMRectList;
  return { close };
}

function keyDown(init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  document.body.dispatchEvent(event);
  return event;
}

afterEach(() => {
  dialog?.$destroy();
  dialog = null;
  document.body.replaceChildren();
});

describe('AnalyzeDialog keys', () => {
  it('closes on Escape', () => {
    const { close } = mount();

    keyDown({ key: 'Escape' });

    expect(close).toHaveBeenCalledTimes(1);
  });

  // Escape cancels an input method's composition in a field elsewhere;
  // Safari reports it with the key code 229.
  it.each([
    { key: 'Escape', isComposing: true },
    { key: 'Escape', keyCode: 229 },
  ])('stays open on %o', (init) => {
    const { close } = mount();

    keyDown(init);

    expect(close).not.toHaveBeenCalled();
  });
});

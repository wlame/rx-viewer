// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import CommandHistory from './CommandHistory.svelte';

let panel: CommandHistory | null = null;

/** Mount the panel with one command, recording its close events. */
function mount() {
  const target = document.createElement('div');
  document.body.appendChild(target);
  panel = new CommandHistory({
    target,
    props: { entries: [{ action: 'search', command: 'rx trace error /logs', at: 0 }] },
  });
  const close = vi.fn();
  panel.$on('close', close);
  return { close };
}

function keyDown(init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  document.body.dispatchEvent(event);
  return event;
}

afterEach(() => {
  panel?.$destroy();
  panel = null;
  document.body.replaceChildren();
});

describe('CommandHistory keys', () => {
  it('closes on Escape', () => {
    const { close } = mount();

    keyDown({ key: 'Escape' });

    expect(close).toHaveBeenCalledTimes(1);
  });

  // Escape cancels an input method's composition, for instance in the
  // search field; Safari reports it with the key code 229.
  it.each([
    { key: 'Escape', isComposing: true },
    { key: 'Escape', keyCode: 229 },
    { key: 'Enter' },
  ])('stays open on %o', (init) => {
    const { close } = mount();

    keyDown(init);

    expect(close).not.toHaveBeenCalled();
  });
});

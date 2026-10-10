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

  // The file tree takes Esc to go to the editor: one press acts once.
  it('stays open on an Escape that the control with the focus acted on', () => {
    const { close } = mount();
    const row = document.body.appendChild(document.createElement('div'));
    row.addEventListener('keydown', (event) => event.preventDefault());

    row.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );

    expect(close).not.toHaveBeenCalled();
  });
});

describe('CommandHistory per-part commands', () => {
  it('lists the commands of an answer pieces under it, each with its copy button', () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const details = ['rx samples /l/app.log.1 --lines=1-20', 'rx samples /l/app.log --lines=1-80'];
    panel = new CommandHistory({
      target,
      props: {
        entries: [
          { action: 'file', command: 'rx logs samples /l/app.log --lines=1-100', details, at: 0 },
        ],
      },
    });
    const copy = vi.fn();
    panel.$on('copy', (event) => copy(event.detail));

    const pieces = [...target.querySelectorAll('ul[aria-label] code')].map((c) => c.textContent);
    target.querySelector<HTMLButtonElement>(`button[aria-label="Copy ${details[1]}"]`)?.click();

    expect(pieces).toEqual(details);
    expect(copy).toHaveBeenCalledWith(details[1]);
  });
});

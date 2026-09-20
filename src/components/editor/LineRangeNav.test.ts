// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import LineRangeNav from './LineRangeNav.svelte';

let nav: LineRangeNav | null = null;

/** Mount the readout for lines 1 to 100 and open its go-to box. */
async function openGotoBox() {
  const target = document.createElement('div');
  document.body.appendChild(target);
  nav = new LineRangeNav({ target, props: { startLine: 1, endLine: 100, totalLines: 1000 } });
  const goto = vi.fn();
  nav.$on('goto', (event) => goto(event.detail));
  nav.openGoto();
  await tick();
  const input = target.querySelector<HTMLInputElement>('input');
  if (!input) throw new Error('the go-to box is not rendered');
  return { target, input, goto };
}

async function typeValue(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await tick();
}

async function keyDown(input: HTMLInputElement, init: KeyboardEventInit): Promise<KeyboardEvent> {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  input.dispatchEvent(event);
  await tick();
  return event;
}

afterEach(() => {
  nav?.$destroy();
  nav = null;
  document.body.replaceChildren();
});

describe('LineRangeNav go-to box', () => {
  it('jumps to the typed line on Enter and closes', async () => {
    const { target, input, goto } = await openGotoBox();
    await typeValue(input, '420');

    const event = await keyDown(input, { key: 'Enter' });

    expect(goto).toHaveBeenCalledWith({ line: 420 });
    expect(event.defaultPrevented).toBe(true);
    expect(target.querySelector('input')).toBeNull();
  });

  it('closes on Escape without jumping', async () => {
    const { target, input, goto } = await openGotoBox();

    const event = await keyDown(input, { key: 'Escape' });

    expect(goto).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
    expect(target.querySelector('input')).toBeNull();
  });

  // Enter confirms an input method's composition and Escape cancels it;
  // Safari sends the confirming Enter with the key code 229 instead.
  it.each([
    { key: 'Enter', isComposing: true },
    { key: 'Enter', keyCode: 229 },
    { key: 'Escape', isComposing: true },
  ])('leaves %o to the input method and stays open', async (init) => {
    const { target, input, goto } = await openGotoBox();
    await typeValue(input, '420');

    const event = await keyDown(input, init);

    expect(goto).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    expect(target.querySelector('input')).toBe(input);
  });
});

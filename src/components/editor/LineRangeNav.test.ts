// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import LineRangeNav from './LineRangeNav.svelte';
import type { ChainPart } from '$lib/types';
import { parseChainLineTarget } from '$lib/utils/chainParts';

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

describe('LineRangeNav go-to box of a log chain', () => {
  /** Mount the readout of a chain whose line box reads a global line or part:line. */
  async function openChainBox(labels: { start: string; middle: string; end: string } | null) {
    const target = document.createElement('div');
    document.body.appendChild(target);
    nav = new LineRangeNav({
      target,
      props: {
        startLine: 1,
        endLine: 100,
        totalLines: null,
        labels,
        readChainTarget: (text: string) =>
          parseChainLineTarget(text, {
            state: 'ready',
            parts: [{ name: 'syslog.3.gz' }, { name: 'syslog' }] as ChainPart[],
          }),
      },
    });
    const gotoChain = vi.fn();
    nav.$on('gotoChain', (event) => gotoChain(event.detail));
    nav.openGoto();
    await tick();
    const input = target.querySelector<HTMLInputElement>('input');
    if (!input) throw new Error('the go-to box is not rendered');
    return { target, input, gotoChain };
  }

  it('shows the held lines as part:line and starts the box on the middle one', async () => {
    const labels = { start: 'syslog.3.gz:1', middle: 'syslog.3.gz:50', end: 'syslog:3' };
    const { target, input } = await openChainBox(labels);

    expect(input.value).toBe('syslog.3.gz:50');
    expect(input.type).toBe('text');
    expect(target.textContent).toContain('syslog.3.gz:1');
    expect(target.textContent).toContain('syslog:3');
  });

  it.each([
    ['123456', { kind: 'global', line: 123456 }],
    ['syslog.3.gz:500', { kind: 'local', part: 'syslog.3.gz', line: 500 }],
  ])('goes to %s', async (text, expected) => {
    const { target, input, gotoChain } = await openChainBox(null);
    await typeValue(input, text);

    await keyDown(input, { key: 'Enter' });

    expect(gotoChain).toHaveBeenCalledWith(expected);
    expect(target.querySelector('input')).toBeNull();
  });

  it.each(['syslog.9.gz:5', 'abc', '0'])('refuses %s, says why and stays open', async (text) => {
    const { target, input, gotoChain } = await openChainBox(null);
    await typeValue(input, text);

    await keyDown(input, { key: 'Enter' });

    expect(gotoChain).not.toHaveBeenCalled();
    expect(target.querySelector('input')).toBe(input);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(target.querySelector('[role="alert"]')?.textContent).not.toBe('');
  });
});

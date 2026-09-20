// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { tick } from 'svelte';
import KeyboardShortcuts from './KeyboardShortcuts.svelte';

let shortcuts: KeyboardShortcuts | null = null;

/** Mount the component and open the help with Cmd+/. */
async function openHelp() {
  const target = document.createElement('div');
  document.body.appendChild(target);
  shortcuts = new KeyboardShortcuts({ target });
  window.dispatchEvent(new KeyboardEvent('keydown', { key: '/', metaKey: true, cancelable: true }));
  await tick();
  const backdrop = target.querySelector<HTMLElement>('[aria-label="Close dialog"]');
  if (!backdrop) throw new Error('the help is not open');
  return { target, backdrop };
}

async function keyDown(element: HTMLElement, init: KeyboardEventInit) {
  element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
  await tick();
}

afterEach(() => {
  shortcuts?.$destroy();
  shortcuts = null;
  document.body.replaceChildren();
});

describe('KeyboardShortcuts help', () => {
  it('closes on Escape on its backdrop', async () => {
    const { target, backdrop } = await openHelp();

    await keyDown(backdrop, { key: 'Escape' });

    expect(target.querySelector('[role="dialog"]')).toBeNull();
  });

  it('stays open on an Escape that cancels a composition', async () => {
    const { target, backdrop } = await openHelp();

    await keyDown(backdrop, { key: 'Escape', isComposing: true });

    expect(target.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it.each([
    ['the file tree', 'Enter or Space'],
    ['a panel is open', 'Esc'],
  ])('lists the keys used in %s', async (scopeWords, label) => {
    const { target } = await openHelp();

    const heading = [...target.querySelectorAll('h3')].find((h) =>
      h.textContent?.includes(scopeWords),
    );

    expect(heading).toBeDefined();
    expect(heading?.nextElementSibling?.textContent).toContain(label);
  });
});

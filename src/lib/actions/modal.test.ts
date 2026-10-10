import { readFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { modalOpen } from '$lib/stores/layout';
import { modal } from './modal';

/** Every `.svelte` file under `dir`, with its path. */
function svelteFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return svelteFiles(path);
    return entry.name.endsWith('.svelte') ? [path] : [];
  });
}

function countOf(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

describe('the modal action', () => {
  it('makes modalOpen hold while its element is in the page', () => {
    // The action reads nothing from its element; this file runs in Node.
    const handle = modal({} as HTMLElement);
    expect(get(modalOpen)).toBe(true);

    handle.destroy();
    expect(get(modalOpen)).toBe(false);
  });

  // The window-wide keys leave the keyboard to an open modal dialog only
  // when the dialog says it is open; a new dialog that forgets would let
  // a panel key hide it or move the focus behind it.
  it('is on every modal dialog of the viewer', () => {
    const components = resolve(__dirname, '../../components');
    const forgotten = svelteFiles(components)
      .map((path) => {
        const text = readFileSync(path, 'utf-8');
        return {
          path,
          dialogs: countOf(text, 'aria-modal="true"'),
          uses: countOf(text, 'use:modal'),
        };
      })
      .filter((file) => file.dialogs !== file.uses)
      .map((file) => file.path.slice(components.length + 1));

    expect(forgotten).toEqual([]);
  });
});

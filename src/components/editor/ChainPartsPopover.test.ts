// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import type { ChainPart } from '$lib/types';
import ChainPartsPopover from './ChainPartsPopover.svelte';

function part(name: string, fields: Partial<ChainPart> = {}): ChainPart {
  return {
    name,
    path: `/l/${name}`,
    is_active: false,
    key: null,
    compression_format: null,
    size: 100,
    modified_at: '2026-10-01T00:00:00.000000Z',
    is_indexed: true,
    line_count: 3000,
    first_ms: null,
    last_ms: null,
    max_ms: null,
    max_is_bound: false,
    global_start: null,
    time_format: null,
    day_first: null,
    example: null,
    duplicates: [],
    ...fields,
  };
}

const PARTS = [
  part('app.log.3.gz', { compression_format: 'gzip', global_start: 1 }),
  part('app.log.2', { size: 0, is_indexed: false, line_count: 0, global_start: 3001 }),
  part('app.log.1', { is_indexed: false, global_start: 3001, line_count: 1500 }),
  part('app.log', { is_active: true, is_indexed: false, line_count: null, global_start: 4501 }),
];

let popover: ChainPartsPopover | null = null;

async function mount() {
  const target = document.createElement('div');
  document.body.appendChild(target);
  popover = new ChainPartsPopover({ target, props: { parts: PARTS } });
  const goto = vi.fn();
  popover.$on('goto', (event) => goto(event.detail));
  const toggle = target.querySelector<HTMLButtonElement>('button[aria-controls]');
  if (!toggle) throw new Error('no toggle button');
  toggle.click();
  await tick();
  return { target, toggle, goto };
}

function rows(target: HTMLElement): HTMLButtonElement[] {
  return [...target.querySelectorAll<HTMLButtonElement>('li button')];
}

afterEach(() => {
  popover?.$destroy();
  popover = null;
  document.body.replaceChildren();
});

describe('ChainPartsPopover', () => {
  it('lists each part with its compression, global lines and index', async () => {
    const { target, toggle } = await mount();

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(rows(target).map((row) => row.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      `app.log.3.gz gzip lines 1–${(3000).toLocaleString()} indexed`,
      'app.log.2 plain empty',
      `app.log.1 plain lines ${(3001).toLocaleString()}–${(4500).toLocaleString()} not indexed`,
      `app.log plain lines from ${(4501).toLocaleString()} not indexed`,
    ]);
  });

  it('goes to the first line of the part clicked, and closes', async () => {
    const { target, goto } = await mount();

    rows(target)[2].click();
    await tick();

    expect(goto).toHaveBeenCalledWith({ kind: 'local', part: 'app.log.1', line: 1 });
    expect(target.querySelector('ul')).toBeNull();
  });

  it('cannot go to an empty part', async () => {
    const { target } = await mount();
    expect(rows(target)[1].disabled).toBe(true);
  });

  it('closes on Escape', async () => {
    const { target } = await mount();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await tick();

    expect(target.querySelector('ul')).toBeNull();
  });

  // The file tree takes Esc to go to the editor: one press acts once.
  it('stays open on an Escape that the control with the focus acted on', async () => {
    const { target } = await mount();
    const row = document.body.appendChild(document.createElement('div'));
    row.addEventListener('keydown', (event) => event.preventDefault());

    row.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    await tick();

    expect(target.querySelector('ul')).not.toBeNull();
  });
});

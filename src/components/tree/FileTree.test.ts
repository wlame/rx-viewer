// @vitest-environment jsdom
import '$lib/testing/matchMediaStub';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { get } from 'svelte/store';
import { health } from '$lib/stores';
import { chainMode } from '$lib/stores/chainMode';
import { LogDirBackend, serveLogDir } from '$lib/testing/fakeLogDir';
import FileTree from './FileTree.svelte';

let mounted: FileTree | null = null;

async function mount(features: string[]) {
  serveLogDir(new LogDirBackend({ features }));
  await health.check();
  const target = document.createElement('div');
  document.body.appendChild(target);
  mounted = new FileTree({ target });
  await tick();
  return {
    toggle: () => target.querySelector<HTMLInputElement>('input[role="switch"]'),
  };
}

afterEach(() => {
  mounted?.$destroy();
  mounted = null;
  chainMode.set(false);
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('the chain mode switch of the files panel', () => {
  it('is not shown while the backend serves no log chains', async () => {
    const { toggle } = await mount([]);

    expect(toggle()).toBeNull();
  });

  it('is a labelled switch, off by default', async () => {
    const { toggle } = await mount(['log_chains']);

    const input = toggle();
    expect(input?.labels?.[0]?.textContent?.trim()).toBe('Group rotated logs');
    expect(input?.checked).toBe(false);
    expect(input?.getAttribute('aria-checked')).toBe('false');
  });

  it('turns chain mode on and off', async () => {
    const { toggle } = await mount(['log_chains']);

    toggle()?.click();
    await tick();
    expect(get(chainMode)).toBe(true);
    expect(toggle()?.checked).toBe(true);

    toggle()?.click();
    await tick();
    expect(get(chainMode)).toBe(false);
  });

  it('shows the mode a link set', async () => {
    const { toggle } = await mount(['log_chains']);

    chainMode.set(true);
    await tick();

    expect(toggle()?.checked).toBe(true);
    expect(toggle()?.getAttribute('aria-checked')).toBe('true');
  });
});

// @vitest-environment jsdom
import '$lib/testing/matchMediaStub';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { get } from 'svelte/store';
import { notifications } from '$lib/stores';
import { analysisTarget, closeAnalysis, openAnalysis } from '$lib/stores/analysisDialog';
import { modalOpen } from '$lib/stores/layout';
import AnalyzeDialogHost from './AnalyzeDialogHost.svelte';

// The analysis waits on the backend; here it never answers, so the
// dialog stays open until the test closes it.
const { analyzeFile } = vi.hoisted(() => ({
  analyzeFile: vi.fn((): Promise<unknown> => new Promise(() => {})),
}));
vi.mock('$lib/indexTasks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/indexTasks')>()),
  analyzeFile,
}));

let host: AnalyzeDialogHost | null = null;

function mount(): HTMLElement {
  const target = document.body.appendChild(document.createElement('div'));
  host = new AnalyzeDialogHost({ target });
  return target;
}

afterEach(() => {
  host?.$destroy();
  host = null;
  closeAnalysis();
  analyzeFile.mockReset();
  analyzeFile.mockImplementation(() => new Promise(() => {}));
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

/** Let every pending promise settle, then the dialogs update. */
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await tick();
}

describe('AnalyzeDialogHost', () => {
  it('draws the dialog of the file opened, and its Close closes it', async () => {
    const target = mount();

    openAnalysis({ path: '/logs/app.log', name: 'app.log' });
    await tick();

    expect(target.querySelector('h2')?.textContent).toContain('Analysis: app.log');
    expect(analyzeFile).toHaveBeenCalledWith('/logs/app.log', expect.anything());
    target.querySelector<HTMLButtonElement>('button[aria-label="Close"]')?.click();
    await tick();
    expect(target.querySelector('[role="dialog"]')).toBeNull();
    expect(get(analysisTarget)).toBeNull();
  });

  it('starts a new analysis for a new request', async () => {
    const target = mount();
    openAnalysis({ path: '/logs/app.log', name: 'app.log' });
    await tick();

    openAnalysis({ path: '/logs/worker.log.3.gz', name: 'worker.log.3.gz' });
    await tick();

    expect(target.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(target.querySelector('h2')?.textContent).toContain('Analysis: worker.log.3.gz');
    expect(analyzeFile).toHaveBeenCalledTimes(2);
    expect(analyzeFile).toHaveBeenLastCalledWith('/logs/worker.log.3.gz', expect.anything());
    expect(document.querySelectorAll('[aria-modal="true"]')).toHaveLength(1);
    expect(get(modalOpen)).toBe(true);

    target.querySelector<HTMLButtonElement>('button[aria-label="Close"]')?.click();
    await tick();

    expect(document.querySelectorAll('[aria-modal="true"]')).toHaveLength(0);
    expect(get(modalOpen)).toBe(false);
  });

  it('keeps a new dialog open when the analysis of the one it replaced fails', async () => {
    let failFirst: (reason: Error) => void = () => {};
    analyzeFile.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          failFirst = reject;
        }),
    );
    const notifyError = vi.spyOn(notifications, 'error');
    const target = mount();
    openAnalysis({ path: '/logs/app.log', name: 'app.log' });
    await tick();
    openAnalysis({ path: '/logs/worker.log.3.gz', name: 'worker.log.3.gz' });
    await tick();

    failFirst(new Error('the backend went away'));
    await settle();

    expect(target.querySelector('h2')?.textContent).toContain('Analysis: worker.log.3.gz');
    expect(get(analysisTarget)?.path).toBe('/logs/worker.log.3.gz');
    expect(get(modalOpen)).toBe(true);
    expect(notifyError).not.toHaveBeenCalled();

    target.querySelector<HTMLButtonElement>('button[aria-label="Close"]')?.click();
    await tick();

    expect(get(modalOpen)).toBe(false);
  });
});

describe('the app', () => {
  // A tree row only names the file in the store; without the host in the
  // app, Analyze would do nothing.
  it('draws the analysis dialog host, before the shortcut list that opens over it', () => {
    const app = readFileSync(resolve(__dirname, '../../App.svelte'), 'utf-8');
    const host = app.indexOf('<AnalyzeDialogHost />');

    expect(host).toBeGreaterThan(-1);
    expect(host).toBeLessThan(app.indexOf('<KeyboardShortcuts />'));
  });
});

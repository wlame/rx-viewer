// @vitest-environment jsdom
import '$lib/testing/matchMediaStub';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { get } from 'svelte/store';
import { analysisTarget, closeAnalysis, openAnalysis } from '$lib/stores/analysisDialog';
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
  analyzeFile.mockClear();
  document.body.replaceChildren();
});

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
  });
});

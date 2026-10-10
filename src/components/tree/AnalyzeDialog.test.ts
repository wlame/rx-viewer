// @vitest-environment jsdom
import '$lib/testing/matchMediaStub';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { get } from 'svelte/store';
import { notifications } from '$lib/stores';
import { modalOpen } from '$lib/stores/layout';
import { AnalysisUnavailableError } from '$lib/indexTasks';
import AnalyzeDialog from './AnalyzeDialog.svelte';

// The analysis waits on the backend; by default it never answers, so
// the dialog stays in its loading state. A test that needs an answer
// gives one.
const { analyzeFile } = vi.hoisted(() => ({
  analyzeFile: vi.fn((): Promise<unknown> => new Promise(() => {})),
}));
vi.mock('$lib/indexTasks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/indexTasks')>()),
  analyzeFile,
}));

let dialog: AnalyzeDialog | null = null;
let mountedTarget: HTMLElement | null = null;

/** Mount the dialog on screen, recording its close events. */
function mount() {
  const target = document.createElement('div');
  mountedTarget = target;
  document.body.appendChild(target);
  dialog = new AnalyzeDialog({ target, props: { path: '/logs/app.log', name: 'app.log' } });
  const close = vi.fn();
  dialog.$on('close', close);
  return { close };
}

function keyDown(init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  document.body.dispatchEvent(event);
  return event;
}

afterEach(() => {
  analyzeFile.mockReset();
  analyzeFile.mockImplementation(() => new Promise(() => {}));
  vi.restoreAllMocks();
  dialog?.$destroy();
  dialog = null;
  document.body.replaceChildren();
});

describe('AnalyzeDialog keys', () => {
  it('closes on Escape', () => {
    const { close } = mount();

    keyDown({ key: 'Escape' });

    expect(close).toHaveBeenCalledTimes(1);
  });

  // Escape cancels an input method's composition in a field elsewhere;
  // Safari reports it with the key code 229.
  it.each([
    { key: 'Escape', isComposing: true },
    { key: 'Escape', keyCode: 229 },
  ])('stays open on %o', (init) => {
    const { close } = mount();

    keyDown(init);

    expect(close).not.toHaveBeenCalled();
  });

  // The shortcut list over the dialog takes Esc to close: one press acts once.
  it('stays open on an Escape that something under the window acted on', () => {
    const { close } = mount();
    const list = document.body.appendChild(document.createElement('div'));
    list.addEventListener('keydown', (event) => event.preventDefault());

    list.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );

    expect(close).not.toHaveBeenCalled();
  });
});

describe('AnalyzeDialog as a modal dialog', () => {
  it('counts as an open modal dialog until it is closed', () => {
    mount();
    expect(get(modalOpen)).toBe(true);

    dialog?.$destroy();
    dialog = null;

    expect(get(modalOpen)).toBe(false);
  });
});

describe('AnalyzeDialog without an analysis', () => {
  it('says the analysis is not available, with the reason, and stays open', async () => {
    analyzeFile.mockImplementation(() =>
      Promise.reject(new AnalysisUnavailableError('/logs/app.log is not a text file')),
    );
    const notifyError = vi.spyOn(notifications, 'error');
    const { close } = mount();

    await tick();
    await tick();

    expect(analyzeFile).toHaveBeenCalledTimes(1);
    expect(mountedTarget?.textContent).toContain(
      'Analysis not available for this file: /logs/app.log is not a text file',
    );
    expect(close).not.toHaveBeenCalled();
    expect(notifyError).not.toHaveBeenCalled();
  });
});

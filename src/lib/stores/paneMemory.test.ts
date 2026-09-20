import { afterEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import type { OpenFile } from '../types';
import { files } from './files';
import {
  DEFAULT_PANE,
  forgetPane,
  recallPane,
  rememberPane,
  scrollOnShow,
  type PaneMemory,
} from './paneMemory';

function paneWithFilter(pattern: string, mode: 'hide' | 'show' | 'highlight'): PaneMemory {
  return {
    ...DEFAULT_PANE,
    filterPanelVisible: true,
    filterDraft: { pattern, mode },
  };
}

/** The fields of an open file `scrollOnShow` reads. */
function shownFile(fields: Partial<OpenFile>): OpenFile {
  return {
    path: '/logs/a.log',
    startLine: 1,
    endLine: 1000,
    anchorLine: 1,
    scrollToLine: undefined,
    ...fields,
  } as OpenFile;
}

describe('the pane memory of each tab', () => {
  afterEach(() => {
    forgetPane('/logs/a.log');
    forgetPane('/logs/b.log');
  });

  it('gives a tab never shown the default pane', () => {
    expect(recallPane('/logs/a.log')).toEqual(DEFAULT_PANE);
  });

  it('restores each tab its own filter bar after switching between them', () => {
    rememberPane('/logs/a.log', paneWithFilter('ERROR', 'show'));
    rememberPane('/logs/b.log', paneWithFilter('user=\\d+', 'hide'));

    expect(recallPane('/logs/a.log').filterDraft).toEqual({ pattern: 'ERROR', mode: 'show' });
    expect(recallPane('/logs/b.log').filterDraft).toEqual({ pattern: 'user=\\d+', mode: 'hide' });
    expect(recallPane('/logs/a.log').filterPanelVisible).toBe(true);
  });

  it('forgets the pane of a file that was closed', async () => {
    // An empty file: the samples answer holds no line.
    const emptyFile = {
      samples: { '1-1000': null },
      before_context: 0,
      after_context: 0,
      is_compressed: false,
      compression_format: null,
      cli_command: null,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => emptyFile,
        text: async () => '',
      })),
    );
    await files.openFile('/logs/a.log', { isIndexed: false });
    rememberPane('/logs/a.log', paneWithFilter('ERROR', 'show'));

    files.closeFile('/logs/a.log');

    expect(recallPane('/logs/a.log')).toEqual(DEFAULT_PANE);
    expect(get(files).openFiles).toEqual([]);
    vi.unstubAllGlobals();
  });
});

describe('scrollOnShow', () => {
  it('leaves the view to a navigation that is still pending', () => {
    const file = shownFile({ scrollToLine: 500, anchorLine: 500 });
    const remembered = { ...DEFAULT_PANE, scroll: { startLine: 1, scrollTop: 900, scrollLeft: 0 } };
    expect(scrollOnShow(file, remembered)).toEqual({ kind: 'none' });
  });

  it('restores the scroll a tab had when its window is the same', () => {
    const file = shownFile({ startLine: 4500, endLine: 5500, anchorLine: 5000 });
    const remembered = {
      ...DEFAULT_PANE,
      scroll: { startLine: 4500, scrollTop: 7300, scrollLeft: 40 },
    };
    expect(scrollOnShow(file, remembered)).toEqual({
      kind: 'restore',
      scrollTop: 7300,
      scrollLeft: 40,
    });
  });

  it('shows the anchor line when the window changed since the tab was shown', () => {
    const file = shownFile({ startLine: 4500, endLine: 5500, anchorLine: 5000 });
    const remembered = {
      ...DEFAULT_PANE,
      scroll: { startLine: 1, scrollTop: 7300, scrollLeft: 0 },
    };
    expect(scrollOnShow(file, remembered)).toEqual({ kind: 'reveal', line: 5000 });
  });

  it('shows the anchor line of a tab shown for the first time', () => {
    const file = shownFile({ startLine: 1, endLine: 1001, anchorLine: 700 });
    expect(scrollOnShow(file, DEFAULT_PANE)).toEqual({ kind: 'reveal', line: 700 });
  });

  it('leaves the view alone when the anchor is outside the held lines', () => {
    const file = shownFile({ startLine: 1, endLine: 1000, anchorLine: 7000 });
    expect(scrollOnShow(file, DEFAULT_PANE)).toEqual({ kind: 'none' });
  });
});

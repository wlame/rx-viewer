import { afterEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import {
  DEFAULT_FILES_VIEW,
  filesPanelShown,
  filesView,
  showFilesValue,
  sortFilesBy,
} from './filesView';
import { sidebarTab, sidebarVisible } from './layout';

afterEach(() => {
  filesView.set(DEFAULT_FILES_VIEW);
  sidebarTab.set('tree');
  sidebarVisible.set(true);
});

describe('filesView', () => {
  it('starts with the labels on, the sizes shown and the rows by name, A to Z', () => {
    expect(get(filesView)).toEqual({
      labels: true,
      show: 'size',
      sort: { key: 'name', dir: 'asc' },
    });
  });
});

describe('sortFilesBy', () => {
  it('sorts by a new column in its first direction, and reverses the sorted one', () => {
    sortFilesBy('size');
    expect(get(filesView).sort).toEqual({ key: 'size', dir: 'desc' });

    sortFilesBy('size');
    expect(get(filesView).sort).toEqual({ key: 'size', dir: 'asc' });

    sortFilesBy('name');
    expect(get(filesView).sort).toEqual({ key: 'name', dir: 'asc' });

    sortFilesBy('name');
    expect(get(filesView).sort).toEqual({ key: 'name', dir: 'desc' });
  });
});

describe('showFilesValue', () => {
  it.each([
    [
      { key: 'size', dir: 'desc' },
      { key: 'date', dir: 'desc' },
    ],
    [
      { key: 'size', dir: 'asc' },
      { key: 'date', dir: 'desc' },
    ],
    [
      { key: 'name', dir: 'desc' },
      { key: 'name', dir: 'desc' },
    ],
  ] as const)('moves the sort %o to %o when the date is shown', (before, after) => {
    filesView.update((view) => ({ ...view, sort: before }));

    showFilesValue('date');

    expect(get(filesView)).toMatchObject({ show: 'date', sort: after });
  });

  it('keeps a sort on the value already shown', () => {
    filesView.update((view) => ({ ...view, sort: { key: 'size', dir: 'asc' } }));

    showFilesValue('size');

    expect(get(filesView)).toMatchObject({ show: 'size', sort: { key: 'size', dir: 'asc' } });
  });
});

describe('filesPanelShown', () => {
  it('holds while the side panel is shown with Files', () => {
    expect(get(filesPanelShown)).toBe(true);
  });

  it('does not hold while the side panel shows Search', () => {
    sidebarTab.set('search');

    expect(get(filesPanelShown)).toBe(false);
  });

  it('does not hold while the side panel is hidden, on Files', () => {
    sidebarVisible.set(false);

    expect(get(filesPanelShown)).toBe(false);
  });
});

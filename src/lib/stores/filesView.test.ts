import { afterEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { DEFAULT_FILES_VIEW, filesPanelShown, filesView } from './filesView';
import { sidebarTab, sidebarVisible } from './layout';

afterEach(() => {
  filesView.set(DEFAULT_FILES_VIEW);
  sidebarTab.set('tree');
  sidebarVisible.set(true);
});

describe('filesView', () => {
  it('starts with the labels on and the sizes shown', () => {
    expect(get(filesView)).toEqual({ labels: true, show: 'size' });
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

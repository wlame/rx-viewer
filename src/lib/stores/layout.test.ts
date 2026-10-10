import { afterEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import {
  clickPanelButton,
  searchFocusRequested,
  showPanel,
  sidebarTab,
  sidebarVisible,
  toggleSidebar,
  treeFocusRequested,
} from './layout';

describe('layout', () => {
  afterEach(() => {
    sidebarTab.set('tree');
    sidebarVisible.set(true);
    searchFocusRequested.set(false);
    treeFocusRequested.set(false);
  });

  it('showPanel opens a hidden side panel on Search and asks for the pattern field focus', () => {
    sidebarVisible.set(false);

    showPanel('search', true);

    expect(get(sidebarVisible)).toBe(true);
    expect(get(sidebarTab)).toBe('search');
    expect(get(searchFocusRequested)).toBe(true);
    expect(get(treeFocusRequested)).toBe(false);
  });

  it('showPanel opens a hidden side panel on Files and asks for the tree focus', () => {
    sidebarTab.set('search');
    sidebarVisible.set(false);

    showPanel('tree', true);

    expect(get(sidebarVisible)).toBe(true);
    expect(get(sidebarTab)).toBe('tree');
    expect(get(treeFocusRequested)).toBe(true);
    expect(get(searchFocusRequested)).toBe(false);
  });

  it('showPanel without focus shows the panel and asks for no focus', () => {
    sidebarVisible.set(false);

    showPanel('search', false);

    expect(get(sidebarVisible)).toBe(true);
    expect(get(sidebarTab)).toBe('search');
    expect(get(searchFocusRequested)).toBe(false);
  });

  it('clickPanelButton on the shown panel hides the side panel and keeps the panel', () => {
    sidebarTab.set('search');

    clickPanelButton('search');

    expect(get(sidebarVisible)).toBe(false);
    expect(get(sidebarTab)).toBe('search');
  });

  it('clickPanelButton on another panel shows it and leaves the focus on the button', () => {
    clickPanelButton('search');

    expect(get(sidebarVisible)).toBe(true);
    expect(get(sidebarTab)).toBe('search');
    expect(get(searchFocusRequested)).toBe(false);
  });

  it('clickPanelButton on the panel a hidden side panel was on shows the side panel', () => {
    sidebarTab.set('search');
    sidebarVisible.set(false);

    clickPanelButton('search');

    expect(get(sidebarVisible)).toBe(true);
    expect(get(sidebarTab)).toBe('search');
  });

  it('toggleSidebar hides and shows the sidebar', () => {
    toggleSidebar();
    expect(get(sidebarVisible)).toBe(false);

    toggleSidebar();
    expect(get(sidebarVisible)).toBe(true);
  });
});

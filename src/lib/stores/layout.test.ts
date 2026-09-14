import { afterEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import {
  focusSearch,
  searchFocusRequested,
  sidebarTab,
  sidebarVisible,
  toggleSidebar,
} from './layout';

describe('layout', () => {
  afterEach(() => {
    sidebarTab.set('tree');
    sidebarVisible.set(true);
    searchFocusRequested.set(false);
  });

  it('focusSearch opens a hidden sidebar on the Search tab and asks for the field focus', () => {
    sidebarVisible.set(false);

    focusSearch();

    expect(get(sidebarVisible)).toBe(true);
    expect(get(sidebarTab)).toBe('search');
    expect(get(searchFocusRequested)).toBe(true);
  });

  it('toggleSidebar hides and shows the sidebar', () => {
    toggleSidebar();
    expect(get(sidebarVisible)).toBe(false);

    toggleSidebar();
    expect(get(sidebarVisible)).toBe(true);
  });
});

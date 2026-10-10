import { describe, expect, it } from 'vitest';
import { ICONS } from './icons';
import { PANELS } from './panels';
import { shortcutById } from './shortcuts';

describe('PANELS', () => {
  it('holds Files and then Search, with their icons and panel keys', () => {
    expect(PANELS).toEqual([
      { id: 'tree', label: 'Files', icon: 'files', shortcut: 'showFiles' },
      { id: 'search', label: 'Search', icon: 'search', shortcut: 'showSearch' },
    ]);
  });

  it('names an icon and a shortcut row that exist for every panel', () => {
    for (const panel of PANELS) {
      expect(ICONS[panel.icon]).toBeDefined();
      expect(shortcutById(panel.shortcut).scope).toBe('panels');
    }
  });
});

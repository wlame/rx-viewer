import { describe, expect, it } from 'vitest';
import { ICONS, type IconName, type IconShape } from './icons';

const ICON_NAMES: readonly IconName[] = [
  'files',
  'search',
  'keyboard',
  'layers',
  'tag',
  'square-stack',
  'arrow-up',
  'arrow-down',
];

const SHAPE_TAGS: readonly IconShape['tag'][] = ['path', 'circle', 'rect', 'line', 'polyline'];

describe('ICONS', () => {
  it('has a row for every icon name and no other', () => {
    expect(Object.keys(ICONS).sort()).toEqual([...ICON_NAMES].sort());
  });

  it.each(ICON_NAMES)('draws %s with at least one shape of a known tag', (name) => {
    const shapes = ICONS[name];

    expect(shapes.length).toBeGreaterThan(0);
    for (const shape of shapes) {
      expect(SHAPE_TAGS).toContain(shape.tag);
      expect(Object.keys(shape.attrs).length).toBeGreaterThan(0);
      for (const value of Object.values(shape.attrs)) expect(typeof value).toBe('string');
    }
  });

  it('gives a path its outline and nothing that runs', () => {
    for (const shapes of Object.values(ICONS)) {
      for (const shape of shapes) {
        for (const attribute of Object.keys(shape.attrs)) expect(attribute).not.toMatch(/^on/i);
        if (shape.tag === 'path') expect(shape.attrs.d).toMatch(/^[mM]/);
      }
    }
  });
});

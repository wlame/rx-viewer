import { describe, expect, it } from 'vitest';
import type { CategoryInfo } from '../types';
import { CATEGORY_PALETTE, categoryStyle, paletteStyleSheet } from './categoryStyle';

/** A /v1/detectors category list with these names, in this order. */
function categoryList(...names: string[]): CategoryInfo[] {
  return names.map((name) => ({ name, description: '', detectors: [] }));
}

// rx-go's categories, in the order its /v1/detectors lists them.
const RX_GO_CATEGORIES = categoryList(
  'format',
  'log-traceback',
  'log-crash',
  'secrets',
  'repetition',
);

describe('categoryStyle', () => {
  it('gives a listed category the palette color at its position in the list', () => {
    RX_GO_CATEGORIES.forEach(({ name }, i) => {
      expect(categoryStyle(name, RX_GO_CATEGORIES)).toEqual({
        color: CATEGORY_PALETTE[i],
        decorationClass: `palette-${i}`,
      });
    });
  });

  it('gives as many listed categories as the palette has colors different colors', () => {
    const names = CATEGORY_PALETTE.map((_, i) => `category-${i}`);
    const categories = categoryList(...names);

    const colors = names.map((name) => categoryStyle(name, categories).color);

    expect(new Set(colors).size).toBe(CATEGORY_PALETTE.length);
  });

  it('wraps around the palette for a category listed past its end', () => {
    const names = [...CATEGORY_PALETTE.map((_, i) => `category-${i}`), 'one-more'];

    expect(categoryStyle('one-more', categoryList(...names)).color).toBe(CATEGORY_PALETTE[0]);
  });

  it('gives a category the list does not name a palette color by its name', () => {
    const style = categoryStyle('not-listed', RX_GO_CATEGORIES);

    expect(CATEGORY_PALETTE).toContain(style.color);
    expect(style.decorationClass).toMatch(/^palette-\d+$/);
    expect(categoryStyle('not-listed', RX_GO_CATEGORIES)).toEqual(style);
  });

  it('keeps a category the list does not name off the colors of the listed ones', () => {
    const listedColors = RX_GO_CATEGORIES.map(
      ({ name }) => categoryStyle(name, RX_GO_CATEGORIES).color,
    );

    for (const name of ['error', 'warning', 'traceback', 'security', 'timing', 'multiline']) {
      expect(listedColors).not.toContain(categoryStyle(name, RX_GO_CATEGORIES).color);
    }
  });

  it('colors a category by its name while the list has not loaded', () => {
    const style = categoryStyle('secrets', []);

    expect(CATEGORY_PALETTE).toContain(style.color);
    expect(categoryStyle('secrets', [])).toEqual(style);
  });
});

describe('paletteStyleSheet', () => {
  it('defines a line class and a glyph class for every palette color', () => {
    const css = paletteStyleSheet();

    CATEGORY_PALETTE.forEach((color, i) => {
      expect(css).toContain(`.monaco-anomaly-palette-${i} {`);
      expect(css).toContain(`.monaco-anomaly-palette-${i}-glyph { background-color: ${color}`);
    });
  });
});

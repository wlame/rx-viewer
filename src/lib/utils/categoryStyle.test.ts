import { describe, expect, it } from 'vitest';
import { CATEGORY_PALETTE, categoryStyle, paletteStyleSheet } from './categoryStyle';

describe('categoryStyle', () => {
  it('keeps the hand-picked style of a known category', () => {
    expect(categoryStyle('format')).toMatchObject({
      color: '#8b5cf6',
      label: 'Format',
      decorationClass: 'format',
    });
  });

  // rx-go's categories (log-traceback, secrets, log-crash, repetition)
  // are not in the hand-picked table; each still needs a color of its
  // own, or every chip and highlight is the same gray.
  it('gives any other category a palette color, by name', () => {
    const style = categoryStyle('log-traceback');

    expect(CATEGORY_PALETTE).toContain(style.color);
    expect(style.decorationClass).toMatch(/^palette-\d+$/);
    expect(style.label).toBe('log-traceback');
  });

  it('gives a category the same color every time', () => {
    expect(categoryStyle('secrets')).toEqual(categoryStyle('secrets'));
  });

  it('spreads the categories rx-go reports over different colors', () => {
    const colors = ['log-traceback', 'log-crash', 'secrets', 'repetition'].map(
      (name) => categoryStyle(name).color,
    );

    expect(new Set(colors).size).toBe(colors.length);
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

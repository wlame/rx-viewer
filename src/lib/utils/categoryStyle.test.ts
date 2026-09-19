import { describe, expect, it } from 'vitest';
import { CATEGORY_PALETTE, categoryStyle, paletteStyleSheet } from './categoryStyle';

describe('categoryStyle', () => {
  // Category names come from the backend's /v1/detectors; none is
  // written into the viewer, so every one takes a palette color by name.
  it.each(['format', 'error', 'log-traceback'])('gives %s a palette color by name', (name) => {
    const style = categoryStyle(name);

    expect(CATEGORY_PALETTE).toContain(style.color);
    expect(style.decorationClass).toMatch(/^palette-\d+$/);
  });

  it('gives a category the same color every time', () => {
    expect(categoryStyle('secrets')).toEqual(categoryStyle('secrets'));
  });

  it('spreads the categories rx-go reports over different colors', () => {
    const colors = ['format', 'log-traceback', 'log-crash', 'secrets', 'repetition'].map(
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

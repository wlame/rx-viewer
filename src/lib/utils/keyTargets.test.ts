import { describe, expect, it } from 'vitest';
import { acceptsTyping, type KeyTarget } from './keyTargets';

/** A stand-in for a DOM element: its tag, classes and ancestors. */
function element(
  tagName: string,
  options: { classes?: string[]; ancestors?: string[]; editable?: boolean } = {},
): KeyTarget {
  const classes = options.classes ?? [];
  const ancestors = options.ancestors ?? [];
  return {
    tagName,
    isContentEditable: options.editable ?? false,
    classList: { contains: (name: string) => classes.includes(name) },
    closest: (selector: string) =>
      ancestors.includes(selector.replace(/^\./, '')) ? ({} as Element) : null,
  };
}

describe('acceptsTyping', () => {
  it('is true for text fields, text areas and editable regions', () => {
    expect(acceptsTyping(element('INPUT'))).toBe(true);
    expect(acceptsTyping(element('TEXTAREA'))).toBe(true);
    expect(acceptsTyping(element('DIV', { editable: true }))).toBe(true);
  });

  it('is false for a button or the pane itself', () => {
    expect(acceptsTyping(element('BUTTON'))).toBe(false);
    expect(acceptsTyping(element('DIV'))).toBe(false);
  });

  // The editor is read-only: its own text area takes no typing, so a
  // shortcut typed while it has focus belongs to the pane.
  it('is false for the read-only editor text area', () => {
    expect(acceptsTyping(element('TEXTAREA', { classes: ['inputarea'] }))).toBe(false);
  });

  it('is true for the editor find box, which does take typing', () => {
    const findBox = element('TEXTAREA', { classes: ['inputarea'], ancestors: ['find-widget'] });

    expect(acceptsTyping(findBox)).toBe(true);
  });
});

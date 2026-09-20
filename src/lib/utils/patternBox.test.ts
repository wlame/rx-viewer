import { describe, expect, it } from 'vitest';
import { firstLine, regexHighlightPieces } from './patternBox';

/** The text the pieces paint, in order. */
function paintedText(pattern: string): string {
  return regexHighlightPieces(pattern)
    .map((piece) => piece.text)
    .join('');
}

describe('regexHighlightPieces', () => {
  it('returns no pieces for an empty pattern', () => {
    expect(regexHighlightPieces('')).toEqual([]);
  });

  it.each(['error|warn', '(\\w+)@(\\w+)\\.com', '[a-z\\d-]+?', '^\\s*(?<level>INFO|WARN)$'])(
    'paints exactly the characters of %s',
    (pattern) => {
      expect(paintedText(pattern)).toBe(pattern);
    },
  );

  // The pieces become text nodes, so markup in a pattern stays text: an
  // escaped entity is shown as typed and a tag is never parsed.
  it.each(['&lt;', '&amp;lt;', '<script>alert(1)</script>', '<img src=x onerror=alert(1)>'])(
    'keeps markup in %s as literal text',
    (pattern) => {
      expect(paintedText(pattern)).toBe(pattern);
    },
  );

  it('classes groups, quantifiers and alternation the way Prism names them', () => {
    expect(regexHighlightPieces('(a)+|b')).toEqual([
      { text: '(', className: 'token group punctuation' },
      { text: 'a', className: '' },
      { text: ')', className: 'token group punctuation' },
      { text: '+', className: 'token quantifier number' },
      { text: '|', className: 'token alternation keyword' },
      { text: 'b', className: '' },
    ]);
  });

  // A token inside a character class keeps the class's classes before
  // its own, so the stylesheet colours it as the nested markup would.
  it('gives a token inside a character class the classes of both, outer first', () => {
    const pieces = regexHighlightPieces('[\\d]');

    expect(pieces).toEqual([
      { text: '[', className: 'token char-class token char-class-punctuation punctuation' },
      { text: '\\d', className: 'token char-class token char-set class-name' },
      { text: ']', className: 'token char-class token char-class-punctuation punctuation' },
    ]);
  });
});

describe('firstLine', () => {
  it.each([
    ['error|warn', 'error|warn'],
    ['first\nsecond', 'first'],
    ['first\r\nsecond', 'first'],
    ['first\rsecond', 'first'],
    ['\nsecond', ''],
    ['', ''],
  ])('returns the first line of %j', (text, expected) => {
    expect(firstLine(text)).toBe(expected);
  });
});

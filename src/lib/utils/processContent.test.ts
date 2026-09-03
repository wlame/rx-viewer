import { describe, it, expect } from 'vitest';
import { processContent, HIDDEN_MARKER, type EditorLine } from './processContent';
import type { RegexFilter } from '../types';

function lines(...contents: string[]): EditorLine[] {
  return contents.map((content) => ({ content }));
}

function filter(pattern: string, mode: RegexFilter['mode']): RegexFilter {
  return {
    enabled: true,
    pattern,
    mode,
    compiledRegex: new RegExp(pattern, 'g'),
    error: null,
    applying: false,
  };
}

describe('carriage returns', () => {
  it('strips them by default, so Monaco does not count extra lines', () => {
    const { content } = processContent(lines('a\r', 'b\r'), null, false);
    expect(content).toBe('a\nb');
  });

  it('shows them as U+240D when invisible characters are on', () => {
    const { content } = processContent(lines('a\r'), null, true);
    expect(content).toBe('a␍');
  });

  it('keeps the line count stable either way', () => {
    const input = lines('a\r\r', 'b', 'c\r');
    expect(processContent(input, null, false).content.split('\n')).toHaveLength(3);
    expect(processContent(input, null, true).content.split('\n')).toHaveLength(3);
  });
});

describe('no filter', () => {
  it('joins the lines unchanged', () => {
    const { content, hiddenContent } = processContent(lines('one', 'two'), null, false);
    expect(content).toBe('one\ntwo');
    expect(hiddenContent.size).toBe(0);
  });

  it('leaves highlight mode alone — it is drawn with decorations', () => {
    const { content, hiddenContent } = processContent(
      lines('level=ERROR'),
      filter('level=(\\w+)', 'highlight'),
      false,
    );
    expect(content).toBe('level=ERROR');
    expect(hiddenContent.size).toBe(0);
  });

  it('ignores a disabled filter', () => {
    const f = { ...filter('(\\w+)', 'hide'), enabled: false };
    expect(processContent(lines('abc'), f, false).content).toBe('abc');
  });
});

describe('hide mode', () => {
  it('replaces the captured group with a marker and keeps the rest', () => {
    const { content } = processContent(
      lines('user=alice id=42'),
      filter('id=(\\d+)', 'hide'),
      false,
    );
    expect(content).toBe(`user=alice id=${HIDDEN_MARKER}`);
  });

  it('hides the whole match when the pattern has no group', () => {
    const { content } = processContent(lines('a SECRET b'), filter('SECRET', 'hide'), false);
    expect(content).toBe(`a ${HIDDEN_MARKER} b`);
  });

  it('records what each marker replaced, keyed by line and marker index', () => {
    const { hiddenContent } = processContent(
      lines('id=1 id=2'),
      filter('id=(\\d+)', 'hide'),
      false,
    );
    expect(hiddenContent.get('1:0')).toBe('1');
    expect(hiddenContent.get('1:1')).toBe('2');
  });

  it('numbers lines from 1, as Monaco does', () => {
    const { hiddenContent } = processContent(
      lines('nothing', 'id=7'),
      filter('id=(\\d+)', 'hide'),
      false,
    );
    expect(hiddenContent.get('2:0')).toBe('7');
    expect(hiddenContent.has('1:0')).toBe(false);
  });

  it('leaves a non-matching line untouched', () => {
    const { content } = processContent(
      lines('id=1', 'no match here'),
      filter('id=(\\d+)', 'hide'),
      false,
    );
    expect(content.split('\n')[1]).toBe('no match here');
  });
});

describe('show mode', () => {
  it('keeps the group and hides everything around it', () => {
    const { content } = processContent(
      lines('noise id=42 noise'),
      filter('id=(\\d+)', 'show'),
      false,
    );
    expect(content).toBe(`${HIDDEN_MARKER}42${HIDDEN_MARKER}`);
  });

  it('collapses a line with no match to a single marker', () => {
    const { content, hiddenContent } = processContent(
      lines('nothing matches'),
      filter('id=(\\d+)', 'show'),
      false,
    );
    expect(content).toBe(HIDDEN_MARKER);
    expect(hiddenContent.get('1:0')).toBe('nothing matches');
  });

  it('leaves an empty line empty rather than marking it', () => {
    const { content } = processContent(lines(''), filter('id=(\\d+)', 'show'), false);
    expect(content).toBe('');
  });

  it('records the hidden segments in left-to-right marker order', () => {
    const { hiddenContent } = processContent(
      lines('aaa id=42 bbb'),
      filter('id=(\\d+)', 'show'),
      false,
    );
    // Only the captured group survives, so the literal "id=" is hidden
    // along with the text before it.
    expect(hiddenContent.get('1:0')).toBe('aaa id=');
    expect(hiddenContent.get('1:1')).toBe(' bbb');
  });
});

describe('robustness', () => {
  it('returns the unfiltered text rather than throwing on a bad pattern', () => {
    // compiledRegex is set but the raw pattern is what the per-line
    // RegExp is rebuilt from, so a broken one must not lose the content.
    const f: RegexFilter = {
      enabled: true,
      pattern: '(',
      mode: 'hide',
      compiledRegex: /x/g,
      error: null,
      applying: false,
    };
    expect(processContent(lines('keep me'), f, false).content).toBe('keep me');
  });

  it('does not carry state between calls', () => {
    const f = filter('id=(\\d+)', 'hide');
    const first = processContent(lines('id=1'), f, false);
    const second = processContent(lines('nothing'), f, false);
    expect(first.hiddenContent.get('1:0')).toBe('1');
    expect(second.hiddenContent.size).toBe(0);
  });

  it('handles an empty file', () => {
    const { content, hiddenContent } = processContent([], filter('x', 'hide'), false);
    expect(content).toBe('');
    expect(hiddenContent.size).toBe(0);
  });
});

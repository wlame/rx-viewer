import { describe, it, expect, vi } from 'vitest';
import {
  processContent,
  HIDDEN_MARKER,
  type EditorLine,
  type ProcessedContent,
} from './processContent';
import type { RegexFilter } from '../types';

/** Far more exec calls than a few short lines need; a loop stuck on one index exceeds it at once. */
const EXEC_CALL_BUDGET = 10_000;

/**
 * Run processContent with a cap on RegExp exec calls.
 *
 * A vitest timeout cannot stop a synchronous loop, so a filter loop that
 * never advances would hang the whole run. Past the cap, exec throws and
 * the loop ends; processContent catches that, so the test asserts on the
 * flag rather than on the error.
 */
function processWithinExecBudget(
  input: readonly EditorLine[],
  regexFilter: RegexFilter,
): ProcessedContent {
  const realExec = RegExp.prototype.exec;
  let calls = 0;
  let isBudgetExceeded = false;
  const spy = vi.spyOn(RegExp.prototype, 'exec').mockImplementation(function (
    this: RegExp,
    text: string,
  ) {
    calls += 1;
    if (calls > EXEC_CALL_BUDGET) {
      isBudgetExceeded = true;
      throw new Error('exec call budget exceeded');
    }
    return realExec.call(this, text);
  });
  let result: ProcessedContent;
  try {
    result = processContent(input, regexFilter, false);
  } finally {
    spy.mockRestore();
  }
  expect(isBudgetExceeded, 'the filter loop did not advance past an empty match').toBe(false);
  return result;
}

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
  // The group's text also occurs earlier inside the match; the marker
  // goes where the group matched, not where its text first appears.
  it('hides a captured group at its own position in the match', () => {
    const { content, hiddenContent } = processContent(lines('aba'), filter('a.(a)', 'hide'), false);
    expect(content).toBe(`ab${HIDDEN_MARKER}`);
    expect(hiddenContent.get('1:0')).toBe('a');
  });

  it.each([
    ['an escaped paren', '\\(x\\)', 'f(x)', `f${HIDDEN_MARKER}`],
    ['a paren in a class', '[(]x', 'f(x)', `f${HIDDEN_MARKER})`],
  ])('reads %s as no group and hides the whole match', (_case, pattern, line, expected) => {
    expect(processContent(lines(line), filter(pattern, 'hide'), false).content).toBe(expected);
  });

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

describe('patterns that can match the empty string', () => {
  it('hides only the digits with \\d* and leaves the other lines alone', () => {
    const { content, hiddenContent } = processWithinExecBudget(
      lines('a12b', 'no digits', '7'),
      filter('\\d*', 'hide'),
    );
    expect(content).toBe(`a${HIDDEN_MARKER}b\nno digits\n${HIDDEN_MARKER}`);
    expect([...hiddenContent]).toEqual([
      ['1:0', '12'],
      ['3:0', '7'],
    ]);
  });

  it('keeps every line with ^ in show mode, each behind one marker holding its text', () => {
    const { content, hiddenContent } = processWithinExecBudget(
      lines('first', 'second', ''),
      filter('^', 'show'),
    );
    expect(content).toBe(`${HIDDEN_MARKER}\n${HIDDEN_MARKER}\n`);
    expect([...hiddenContent]).toEqual([
      ['1:0', 'first'],
      ['2:0', 'second'],
    ]);
  });

  it('keeps every line with x? in show mode, showing the x and hiding the rest', () => {
    const { content, hiddenContent } = processWithinExecBudget(
      lines('axb', 'none'),
      filter('x?', 'show'),
    );
    expect(content).toBe(`${HIDDEN_MARKER}x${HIDDEN_MARKER}\n${HIDDEN_MARKER}`);
    expect([...hiddenContent]).toEqual([
      ['1:0', 'a'],
      ['1:1', 'b'],
      ['2:0', 'none'],
    ]);
  });

  it('leaves no marker for an empty captured group', () => {
    const { content, hiddenContent } = processWithinExecBudget(
      lines('id= next'),
      filter('id=(\\d*)', 'hide'),
    );
    expect(content).toBe('id= next');
    expect(hiddenContent.size).toBe(0);
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

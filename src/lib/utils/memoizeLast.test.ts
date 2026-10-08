import { describe, expect, it, vi } from 'vitest';
import { memoizeLast } from './memoizeLast';

describe('memoizeLast', () => {
  it('gives the last answer again for the same arguments, without working it out', () => {
    const compute = vi.fn((lines: readonly string[], mode: string) => ({ text: lines.join(mode) }));
    const memo = memoizeLast(compute);
    const lines = ['a', 'b'];

    const first = memo(lines, '\n');

    expect(memo(lines, '\n')).toBe(first);
    expect(compute).toHaveBeenCalledTimes(1);
  });

  // Arguments are compared as objects, not by what they hold: a copy is
  // another value, and its answer is worked out again.
  it.each([
    ['another object with the same content', [['a', 'b'], '\n']],
    ['another value of a primitive', [null, ' ']],
  ])('works the answer out again for %s', (_name, change) => {
    const compute = vi.fn((lines: readonly string[], mode: string) => ({ text: lines.join(mode) }));
    const memo = memoizeLast(compute);
    const lines = ['a', 'b'];
    const [newLines, newMode] = change as [readonly string[] | null, string];

    const first = memo(lines, '\n');
    const second = memo(newLines ?? lines, newMode);

    expect(second).not.toBe(first);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it('keeps only the last answer', () => {
    const compute = vi.fn((n: number) => ({ n }));
    const memo = memoizeLast(compute);

    memo(1);
    memo(2);
    memo(1);

    expect(compute).toHaveBeenCalledTimes(3);
  });
});

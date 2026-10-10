import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SEARCH_TOGGLES,
  SEARCH_TOGGLES,
  matchingFlagParams,
  toggleFlagLine,
  togglesFromFlags,
  type SearchToggles,
} from './searchToggles';

describe('matchingFlagParams', () => {
  it('sends no parameter at the defaults, which are ripgrep defaults', () => {
    expect(matchingFlagParams(DEFAULT_SEARCH_TOGGLES)).toEqual({});
  });

  it.each([
    [{ matchCase: false }, { ignore_case: true }],
    [{ wholeWord: true }, { word_regexp: true }],
    [{ regex: false }, { fixed_strings: true }],
  ])('turns %o into %o', (change, expected) => {
    expect(matchingFlagParams({ ...DEFAULT_SEARCH_TOGGLES, ...change })).toEqual(expected);
  });

  it('sends every parameter whose toggle is away from the default', () => {
    expect(matchingFlagParams({ matchCase: false, wholeWord: true, regex: false })).toEqual({
      ignore_case: true,
      word_regexp: true,
      fixed_strings: true,
    });
  });
});

describe('SEARCH_TOGGLES', () => {
  it('gives every toggle its own shortcut', () => {
    const codes = SEARCH_TOGGLES.map((spec) => spec.shortcutCode);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe('toggleFlagLine', () => {
  it.each([
    ['matchCase', 'Off: ripgrep -i'],
    ['wholeWord', 'On: ripgrep -w'],
    ['regex', 'Off: ripgrep -F'],
  ])('says which state of %s sends which ripgrep flag: %j', (key, line) => {
    const spec = SEARCH_TOGGLES.find((toggle) => toggle.key === key);
    if (!spec) throw new Error(`no toggle ${key}`);

    expect(toggleFlagLine(spec)).toBe(line);
  });
});

describe('togglesFromFlags', () => {
  it('gives the defaults when no flag is set', () => {
    expect(togglesFromFlags({})).toEqual(DEFAULT_SEARCH_TOGGLES);
  });

  // Every combination of the three toggles, so the URL can carry any of
  // them through matchingFlagParams and back.
  const combinations: SearchToggles[] = [false, true].flatMap((matchCase) =>
    [false, true].flatMap((wholeWord) =>
      [false, true].map((regex) => ({ matchCase, wholeWord, regex })),
    ),
  );

  it.each(combinations)('inverts matchingFlagParams for %o', (toggles) => {
    expect(togglesFromFlags(matchingFlagParams(toggles))).toEqual(toggles);
  });
});

import { describe, expect, it } from 'vitest';
import { DEFAULT_SEARCH_TOGGLES } from '../utils/searchToggles';
import type { SearchState } from '../utils/urlState';
import { draftFromSearch, parseMaxResults } from './searchDraft';

describe('parseMaxResults', () => {
  it.each([
    ['100', 100],
    ['1', 1],
    ['10000', 10_000],
    ['050', 50],
  ])('reads %j as %d', (text, expected) => {
    expect(parseMaxResults(text)).toBe(expected);
  });

  // The box holds what was typed; a value the search cannot take is
  // refused, never changed into one it can.
  it.each(['', '0', '00000', '10001', '99999', '12a', ' 5', '5 ', '-3', '+3', '1e3', '1.5', '٣'])(
    'refuses %j',
    (text) => {
      expect(parseMaxResults(text)).toBeNull();
    },
  );
});

describe('draftFromSearch', () => {
  it('starts with one empty pattern, the default toggles, all files and 100 matches', () => {
    expect(draftFromSearch(null)).toEqual({
      patterns: [''],
      toggles: DEFAULT_SEARCH_TOGGLES,
      onlyOpenedFiles: false,
      maxResults: '100',
    });
  });

  it("holds a link's patterns, flags, only-opened and max as text", () => {
    const search: SearchState = {
      patterns: ['ERROR', 'timeout [0-9]+'],
      maxResults: 50,
      onlyOpenedFiles: true,
      flags: { ignore_case: true, fixed_strings: true },
    };

    expect(draftFromSearch(search)).toEqual({
      patterns: ['ERROR', 'timeout [0-9]+'],
      toggles: { matchCase: false, wholeWord: false, regex: false },
      onlyOpenedFiles: true,
      maxResults: '50',
    });
  });

  // An edit of the draft must not change the search the URL holds.
  it("copies the link's patterns", () => {
    const search: SearchState = {
      patterns: ['ERROR'],
      maxResults: 100,
      onlyOpenedFiles: false,
      flags: {},
    };

    const draft = draftFromSearch(search);
    draft.patterns[0] = 'WARN';

    expect(search.patterns).toEqual(['ERROR']);
  });

  it('gives each empty draft toggles of its own', () => {
    const draft = draftFromSearch(null);
    draft.toggles.matchCase = false;

    expect(draftFromSearch(null).toggles).toEqual(DEFAULT_SEARCH_TOGGLES);
    expect(DEFAULT_SEARCH_TOGGLES.matchCase).toBe(true);
  });
});

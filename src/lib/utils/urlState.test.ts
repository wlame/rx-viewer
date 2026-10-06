import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  historyModeFor,
  parseViewState,
  serializeViewState,
  readViewState,
  writeViewState,
  debounce,
  DEFAULT_MAX_RESULTS,
  DEFAULT_VIEW,
  type SearchState,
  type ViewState,
} from './urlState';

/**
 * The URL is how a viewer session is shared and restored. A value that
 * survives a write but not a read means a shared link opens the wrong
 * view, so the round trip is what these tests pin; and the URL is input
 * like any other, so a bad value must fall back to its default.
 */
function setLocation(search: string, hash = '') {
  const calls: { mode: 'push' | 'replace'; url: string }[] = [];
  const move = (mode: 'push' | 'replace') => (_state: unknown, _title: string, next: string) => {
    calls.push({ mode, url: next });
    const parsed = new URL(next, 'http://localhost:5173');
    Object.assign(window.location, {
      href: parsed.toString(),
      pathname: parsed.pathname,
      search: parsed.search,
      hash: parsed.hash,
    });
  };
  vi.stubGlobal('window', {
    location: {
      href: `http://localhost:5173/${search}${hash}`,
      pathname: '/',
      search,
      hash,
    },
    history: { replaceState: move('replace'), pushState: move('push') },
  });
  return calls;
}

const plainSearch: SearchState = {
  patterns: ['error'],
  maxResults: DEFAULT_MAX_RESULTS,
  onlyOpenedFiles: false,
  flags: {},
};

function view(overrides: Partial<ViewState>): ViewState {
  return { ...DEFAULT_VIEW, ...overrides };
}

describe('parseViewState', () => {
  it('gives the default view for an empty query', () => {
    expect(parseViewState('')).toEqual(DEFAULT_VIEW);
  });

  it('reads a line as a whole number from 1 up', () => {
    expect(parseViewState('?file=/a.log&line=169').line).toBe(169);
  });

  // A negative line counts from the end in /v1/samples, so the URL must
  // never pass one through.
  it.each(['-5', 'abc', '0', '1.5', '', '1e3', '99999999999999999999'])(
    'falls back to no line for line=%s',
    (value) => {
      expect(parseViewState(`?file=/a.log&line=${value}`).line).toBeNull();
    },
  );

  it('reads a time as the UTC instant it names', () => {
    expect(parseViewState('?file=/a.log&time=2025-12-10T07:30:00.123Z').time).toBe(
      Date.UTC(2025, 11, 10, 7, 30, 0, 123),
    );
  });

  // The URL carries an instant the viewer wrote: RFC 3339 with ms and Z.
  it.each([
    '07:30:00',
    '2025-12-10 07:30:00',
    '2025-12-10T07:30:00Z',
    '2025-12-10T07:30:00.123',
    '2025-12-10T07:30:00.123+01:00',
    '2025-13-10T07:30:00.000Z',
    '2025-02-30T07:30:00.000Z',
    '2025-12-10T25:30:00.000Z',
    '',
  ])('falls back to no time for time=%s', (value) => {
    expect(parseViewState(`?file=/a.log&time=${encodeURIComponent(value)}`).time).toBeNull();
  });

  it('leaves highlighting to the size-based default when the link has no highlight', () => {
    expect(parseViewState('?file=/a.log').highlight).toBeNull();
  });

  it.each([
    ['1', true],
    ['true', true],
    ['0', false],
    ['false', false],
    ['yes', null],
  ])('reads highlight=%s as %s', (value, expected) => {
    expect(parseViewState(`?file=/a.log&highlight=${value}`).highlight).toBe(expected);
  });

  it('opens the Search tab for a link that carries a search and names no tab', () => {
    expect(parseViewState('?regexp=error').tab).toBe('search');
    expect(parseViewState('?file=/a.log').tab).toBe('tree');
  });

  it('keeps the Files tab a link asks for even with a search', () => {
    expect(parseViewState('?regexp=error&tab=files').tab).toBe('tree');
  });

  it('ignores a tab it does not know', () => {
    expect(parseViewState('?tab=settings').tab).toBe('tree');
  });

  it('reads a filter mode it does not know as highlight', () => {
    expect(parseViewState('?file=/a.log&filter=x&filter_mode=sparkle').filter).toEqual({
      pattern: 'x',
      mode: 'highlight',
    });
  });

  it('reads an empty filter or category as none', () => {
    const parsed = parseViewState('?file=/a.log&filter=&filter_mode=hide&category=');
    expect(parsed.filter).toBeNull();
    expect(parsed.category).toBeNull();
  });

  it('returns no search when the URL names no pattern, or only empty ones', () => {
    expect(parseViewState('?file=%2Fa.log').search).toBeNull();
    expect(parseViewState('?regexp=&regexp=%20').search).toBeNull();
  });

  it.each(['abc', '0', '-5', '1.5', '99999'])(
    'falls back to the default cap for max_results=%s',
    (value) => {
      expect(parseViewState(`?regexp=a&max_results=${value}`).search?.maxResults).toBe(
        DEFAULT_MAX_RESULTS,
      );
    },
  );

  it('reads a search flag written as true as well as 1', () => {
    expect(parseViewState('?regexp=a&word_regexp=true').search?.flags).toEqual({
      word_regexp: true,
    });
  });

  it('ignores a search parameter the search panel cannot set', () => {
    expect(parseViewState('?regexp=a&pcre2=1&line_regexp=1').search?.flags).toEqual({});
  });
});

describe('serializeViewState and parseViewState', () => {
  const cases: [string, ViewState][] = [
    ['the default view', DEFAULT_VIEW],
    ['a file at a line', view({ file: '/var/log/app.log', line: 351232 })],
    ['a path with URL syntax', view({ file: '/logs/with space/and&amp+sign #1.log', line: 7 })],
    ['a unicode path', view({ file: '/logs/unicode-日本語.log', highlight: true })],
    ['highlighting off', view({ file: '/a.log', highlight: false })],
    ['a file at a time', view({ file: '/a.log', time: Date.UTC(2025, 11, 10, 7, 45, 12, 345) })],
    [
      'a filter and a category',
      view({
        file: '/a.log',
        filter: { pattern: '(\\w+)@(\\w+)\\.com', mode: 'hide' },
        category: 'error',
      }),
    ],
    ['a search on its tab', view({ search: plainSearch, tab: 'search' })],
    ['a search on the Files tab', view({ search: plainSearch, tab: 'tree' })],
    ['the Search tab with no search', view({ tab: 'search' })],
    ['byte offsets', view({ offsets: true, search: plainSearch, tab: 'search' })],
    [
      'a search with every option',
      view({
        tab: 'search',
        search: {
          patterns: ['timeout (\\d+)ms', 'a&b=c', 'naïve 日本語', 'x+y #1'],
          maxResults: 5000,
          onlyOpenedFiles: true,
          flags: { ignore_case: true, word_regexp: true, fixed_strings: true },
        },
      }),
    ],
  ];

  it.each(cases)('survives a write then a read: %s', (_name, state) => {
    expect(parseViewState(serializeViewState(state, ''))).toEqual(state);
  });

  // A link should carry what makes the view differ from a plain one and
  // nothing else, under the names /v1/trace uses for the search.
  it('leaves values at their default out of the link', () => {
    expect(serializeViewState(view({ file: '/a.log' }), '')).toBe('?file=%2Fa.log');
    expect(serializeViewState(view({ search: plainSearch, tab: 'search' }), '')).toBe(
      '?regexp=error',
    );
    expect(serializeViewState(DEFAULT_VIEW, '')).toBe('');
  });

  it('writes a time as RFC 3339 with ms and Z', () => {
    expect(
      serializeViewState(view({ file: '/a.log', time: Date.UTC(2025, 11, 10, 7, 30) }), ''),
    ).toBe('?file=%2Fa.log&time=2025-12-10T07%3A30%3A00.000Z');
  });

  it('writes a search flag as 1', () => {
    const query = serializeViewState(
      view({ search: { ...plainSearch, flags: { ignore_case: true } }, tab: 'search' }),
      '',
    );
    expect(query).toContain('ignore_case=1');
  });

  it('keeps a parameter it does not own', () => {
    expect(serializeViewState(view({ file: '/a.log' }), '?debug=1&line=4')).toBe(
      '?debug=1&file=%2Fa.log',
    );
  });
});

/**
 * Back must undo a step the user took (open a file, run a search, switch
 * the sidebar tab) and skip the fine-grained changes in between (a
 * scroll, a jump inside the file, a filter, a toggle).
 */
describe('historyModeFor', () => {
  const fileA = view({ file: '/a.log' });

  const steps: { name: string; previous: ViewState; next: ViewState; mode: 'push' | 'replace' }[] =
    [
      { name: 'opening the first file', previous: DEFAULT_VIEW, next: fileA, mode: 'push' },
      {
        name: 'switching to another file',
        previous: fileA,
        next: view({ file: '/b.log' }),
        mode: 'push',
      },
      { name: 'closing the last file', previous: fileA, next: DEFAULT_VIEW, mode: 'replace' },
      {
        name: 'moving the line',
        previous: fileA,
        next: view({ file: '/a.log', line: 500 }),
        mode: 'replace',
      },
      {
        name: 'toggling highlighting',
        previous: fileA,
        next: view({ file: '/a.log', highlight: true }),
        mode: 'replace',
      },
      {
        name: 'applying a filter',
        previous: fileA,
        next: view({ file: '/a.log', filter: { pattern: 'x', mode: 'hide' } }),
        mode: 'replace',
      },
      {
        name: 'picking an anomaly category',
        previous: fileA,
        next: view({ file: '/a.log', category: 'error' }),
        mode: 'replace',
      },
      {
        name: 'switching the sidebar tab',
        previous: DEFAULT_VIEW,
        next: view({ tab: 'search' }),
        mode: 'push',
      },
      {
        name: 'switching the results to offsets',
        previous: DEFAULT_VIEW,
        next: view({ offsets: true }),
        mode: 'replace',
      },
      {
        name: 'running a search',
        previous: DEFAULT_VIEW,
        next: view({ search: plainSearch, tab: 'search' }),
        mode: 'push',
      },
      {
        name: 'running another search',
        previous: view({ search: plainSearch, tab: 'search' }),
        next: view({ search: { ...plainSearch, patterns: ['warn'] }, tab: 'search' }),
        mode: 'push',
      },
      {
        name: 'dropping the search',
        previous: view({ search: plainSearch }),
        next: DEFAULT_VIEW,
        mode: 'replace',
      },
      {
        name: 'jumping to a time',
        previous: view({ file: '/a.log', line: 500 }),
        next: view({ file: '/a.log', time: 1_000 }),
        mode: 'push',
      },
      {
        name: 'jumping to another time',
        previous: view({ file: '/a.log', time: 1_000 }),
        next: view({ file: '/a.log', time: 2_000 }),
        mode: 'push',
      },
      {
        name: 'moving by line after a time jump',
        previous: view({ file: '/a.log', time: 1_000 }),
        next: view({ file: '/a.log', line: 640 }),
        mode: 'replace',
      },
      { name: 'changing nothing', previous: fileA, next: fileA, mode: 'replace' },
    ];

  it.each(steps)('$name is a $mode', ({ previous, next, mode }) => {
    expect(historyModeFor(previous, next)).toBe(mode);
  });
});

describe('readViewState and writeViewState', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reads the view from the address bar', () => {
    setLocation('?file=%2Fa.log&line=12&highlight=0');
    expect(readViewState()).toEqual(view({ file: '/a.log', line: 12, highlight: false }));
  });

  it('replaces the entry when asked to replace', () => {
    const calls = setLocation('');
    writeViewState(view({ file: '/a.log', line: 3 }), 'replace');
    expect(calls).toEqual([{ mode: 'replace', url: '/?file=%2Fa.log&line=3' }]);
  });

  it('adds an entry when asked to push', () => {
    const calls = setLocation('?file=%2Fa.log');
    writeViewState(view({ file: '/b.log' }), 'push');
    expect(calls).toEqual([{ mode: 'push', url: '/?file=%2Fb.log' }]);
  });

  it('writes nothing when the URL already says the same', () => {
    const calls = setLocation('?file=%2Fa.log&line=3');
    writeViewState(view({ file: '/a.log', line: 3 }), 'push');
    expect(calls).toEqual([]);
  });

  it('replaces rather than pushes a URL that says the same view in other bytes', () => {
    const calls = setLocation('?regexp=a%20b&line=-5');
    writeViewState(view({ search: { ...plainSearch, patterns: ['a b'] }, tab: 'search' }), 'push');
    expect(calls).toEqual([{ mode: 'replace', url: '/?regexp=a+b' }]);
  });

  it('keeps the hash it finds', () => {
    const calls = setLocation('', '#section');
    writeViewState(view({ file: '/a.log' }), 'replace');
    expect(calls[0].url).toBe('/?file=%2Fa.log#section');
  });
});

describe('debounce', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('calls the function once after the delay, not per invocation', () => {
    const spy = vi.fn();
    const debounced = debounce(spy, 100);

    debounced('a');
    debounced('b');
    debounced('c');
    expect(spy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('passes the arguments of the last call', () => {
    const spy = vi.fn();
    const debounced = debounce(spy, 50);

    debounced('first');
    debounced('last');
    vi.advanceTimersByTime(50);

    expect(spy).toHaveBeenCalledWith('last');
  });

  it('restarts the timer on every call', () => {
    const spy = vi.fn();
    const debounced = debounce(spy, 100);

    debounced();
    vi.advanceTimersByTime(90);
    debounced();
    vi.advanceTimersByTime(90);
    expect(spy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(10);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

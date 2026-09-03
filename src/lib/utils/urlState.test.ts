import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { updateUrlState, readUrlState, debounce, type FileState } from './urlState';

/**
 * The URL is how a viewer session is shared and restored. A path that
 * survives a write but not a read means a shared link opens the wrong
 * file, so the round trip is what these tests pin.
 */
function setLocation(search: string) {
  const url = `http://localhost:5173/${search}`;
  vi.stubGlobal('window', {
    location: { href: url, search: search.startsWith('?') ? search : '' },
    history: {
      replaceState: (_state: unknown, _title: string, next: string) => {
        const parsed = new URL(next);
        (window as unknown as { location: { href: string; search: string } }).location = {
          href: parsed.toString(),
          search: parsed.search,
        };
      },
    },
  });
}

describe('readUrlState', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns null when no file is named', () => {
    setLocation('?line=10');
    expect(readUrlState()).toBeNull();
  });

  it('defaults to line 1 when the line is absent', () => {
    setLocation('?file=/var/log/app.log');
    expect(readUrlState()).toEqual({
      path: '/var/log/app.log',
      line: 1,
      syntaxHighlighting: false,
    });
  });

  it('falls back to line 1 rather than NaN when the line is not a number', () => {
    setLocation('?file=/a.log&line=abc');
    expect(readUrlState()?.line).toBe(1);
  });

  it('treats any highlight value other than 1 as off', () => {
    setLocation('?file=/a.log&highlight=yes');
    expect(readUrlState()?.syntaxHighlighting).toBe(false);
  });
});

describe('updateUrlState and readUrlState', () => {
  afterEach(() => vi.unstubAllGlobals());

  const cases: FileState[] = [
    { path: '/var/log/app.log', line: 1, syntaxHighlighting: false },
    { path: '/var/log/app.log', line: 351232, syntaxHighlighting: true },
    { path: '/logs/with space/and&ersand.log', line: 7, syntaxHighlighting: false },
    { path: '/logs/unicode-日本語.log', line: 2, syntaxHighlighting: true },
    { path: '/logs/plus+sign.log', line: 3, syntaxHighlighting: false },
  ];

  it.each(cases)('survives a write then a read: $path line $line', (state) => {
    setLocation('');
    updateUrlState(state);
    expect(readUrlState()).toEqual(state);
  });

  it('clears every file parameter when passed null', () => {
    setLocation('');
    updateUrlState({ path: '/a.log', line: 5, syntaxHighlighting: true });
    updateUrlState(null);
    expect(readUrlState()).toBeNull();
    expect(window.location.search).not.toContain('line=');
    expect(window.location.search).not.toContain('highlight=');
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

import { afterEach, describe, expect, it } from 'vitest';
import { clearApiToken, getApiToken, setApiToken, takeTokenFromHash } from './apiToken';

/** A Storage that keeps values in a Map, or throws on every call. */
function memoryStorage(failing = false) {
  const values = new Map<string, string>();
  const guard = () => {
    if (failing) throw new DOMException('denied', 'SecurityError');
  };
  return {
    getItem: (key: string) => (guard(), values.get(key) ?? null),
    setItem: (key: string, value: string) => (guard(), void values.set(key, value)),
    removeItem: (key: string) => (guard(), void values.delete(key)),
  };
}

afterEach(() => clearApiToken(memoryStorage()));

describe('takeTokenFromHash', () => {
  it('takes the token and leaves nothing behind', () => {
    expect(takeTokenFromHash('#token=abc123')).toEqual({ token: 'abc123', hash: '' });
  });

  it('decodes the token the way it was encoded into the link', () => {
    expect(takeTokenFromHash('#token=a%2Fb%2Bc').token).toBe('a/b+c');
  });

  it('keeps a plus sign as a plus sign', () => {
    expect(takeTokenFromHash('#token=a+b').token).toBe('a+b');
  });

  it('keeps the rest of the fragment', () => {
    expect(takeTokenFromHash('#view=tree&token=abc&x=1')).toEqual({
      token: 'abc',
      hash: '#view=tree&x=1',
    });
  });

  it('finds no token in a fragment without one, or with an empty one', () => {
    expect(takeTokenFromHash('')).toEqual({ token: null, hash: '' });
    expect(takeTokenFromHash('#view=tree')).toEqual({ token: null, hash: '#view=tree' });
    expect(takeTokenFromHash('#token=')).toEqual({ token: null, hash: '' });
  });
});

describe('the stored token', () => {
  it('is kept in the storage it is given', () => {
    const storage = memoryStorage();

    setApiToken('abc', storage);

    expect(getApiToken(storage)).toBe('abc');
    expect(storage.getItem('rx.apiToken')).toBe('abc');
  });

  it('is kept for the page when the storage refuses it', () => {
    const storage = memoryStorage(true);

    setApiToken('abc', storage);

    expect(getApiToken(storage)).toBe('abc');
  });

  it('is gone after clearing', () => {
    const storage = memoryStorage();
    setApiToken('abc', storage);

    clearApiToken(storage);

    expect(getApiToken(storage)).toBeNull();
  });
});

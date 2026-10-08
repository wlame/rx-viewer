import { describe, expect, it } from 'vitest';
import { chainHandleOf, chainKey, chainSearchPaths, fileKeys, isChainKey } from './tabKey';

describe('chainKey', () => {
  it('prefixes the handle with chain:', () => {
    expect(chainKey('/var/log/syslog')).toBe('chain:/var/log/syslog');
  });

  // The handle equals the active file's path in the usual case, so the
  // two tabs need different keys.
  it('never equals the path of the file at the handle', () => {
    expect(chainKey('/var/log/syslog')).not.toBe('/var/log/syslog');
  });
});

describe('isChainKey', () => {
  it.each([
    ['chain:/var/log/syslog', true],
    ['/var/log/syslog', false],
    ['/var/log/chain:syslog', false],
    ['', false],
  ])('reads %j as a chain key: %s', (key, expected) => {
    expect(isChainKey(key)).toBe(expected);
  });
});

describe('chainHandleOf', () => {
  it.each([
    '/var/log/syslog',
    '/srv/my app (1).log',
    '/srv/a#b&c%d+e@f.log',
    '/var/log/журнал.log',
  ])('gives back the handle %s', (handle) => {
    expect(chainHandleOf(chainKey(handle))).toBe(handle);
  });

  it('gives null for a file key', () => {
    expect(chainHandleOf('/var/log/syslog')).toBeNull();
  });
});

describe('fileKeys', () => {
  it('keeps the files of the open tabs and leaves the chains out', () => {
    expect(fileKeys(['/l/a.log', chainKey('/l/syslog'), '/l/syslog'])).toEqual([
      '/l/a.log',
      '/l/syslog',
    ]);
  });
});

describe('chainSearchPaths', () => {
  it('names each chain tab by its handle and each file tab by its path, in tab order', () => {
    expect(chainSearchPaths(['/l/a.log', chainKey('/l/syslog'), '/l/b.log'])).toEqual([
      '/l/a.log',
      '/l/syslog',
      '/l/b.log',
    ]);
  });

  // The tab of the file at a chain's handle names the same path as the
  // chain's tab: the search reads it once, as that chain.
  it('names a path two tabs share once', () => {
    expect(chainSearchPaths([chainKey('/l/syslog'), '/l/syslog'])).toEqual(['/l/syslog']);
  });
});

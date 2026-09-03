import { describe, it, expect } from 'vitest';
import {
  logLanguageTokenizer,
  getLogLanguageThemeRules,
  getLogLanguageThemeRulesDark,
} from './logGrammar';

/**
 * Monarch applies the first rule that matches, so both the patterns and
 * their order are the contract. Booting a real Monaco editor in Node is
 * not worth it, so these tests run the rules the way Monarch would: try
 * each in order, first match wins.
 */
type Rule = [RegExp, string];

const rules = (logLanguageTokenizer.tokenizer!.root as Rule[]).filter(
  (r): r is Rule => Array.isArray(r) && r[0] instanceof RegExp,
);

/** The token the grammar assigns to a whole string, or null if none matches it exactly. */
function tokenOf(text: string): string | null {
  for (const [pattern, token] of rules) {
    const anchored = new RegExp(`^(?:${pattern.source})$`, pattern.flags.replace('g', ''));
    if (anchored.test(text)) return token;
  }
  return null;
}

describe('log grammar', () => {
  describe('log levels', () => {
    it.each([
      ['FATAL', 'log-level-fatal'],
      ['CRITICAL', 'log-level-fatal'],
      ['ERROR', 'log-level-error'],
      ['EXCEPTION', 'log-level-error'],
      ['FAILED', 'log-level-error'],
      ['WARN', 'log-level-warn'],
      ['WARNING', 'log-level-warn'],
      ['INFO', 'log-level-info'],
      ['NOTICE', 'log-level-info'],
      ['DEBUG', 'log-level-debug'],
      ['TRACE', 'log-level-debug'],
    ])('tokenizes %s as %s', (text, token) => {
      expect(tokenOf(text)).toBe(token);
    });

    it('matches a level regardless of case', () => {
      expect(tokenOf('error')).toBe('log-level-error');
    });
  });

  describe('timestamps', () => {
    it.each([
      '2024-01-15T10:30:45.123Z',
      '2024-01-15T10:30:45+00:00',
      '2024-01-15 10:30:45',
      '2024/01/15 10:30:45',
      '15/Jan/2024:10:30:45',
      '10:30:45.123',
    ])('recognises %s as a datetime', (text) => {
      expect(tokenOf(text)).toBe('datetime');
    });
  });

  describe('addresses and identifiers', () => {
    it.each([
      ['192.168.1.1', 'ip-address'],
      ['192.168.1.1:8080', 'ip-address'],
      ['2001:0db8:85a3:0000:0000:8a2e:0370:7334', 'ip-address'],
      ['550e8400-e29b-41d4-a716-446655440000', 'uuid'],
      ['user@example.com', 'email'],
      ['https://example.com/path?q=1', 'url'],
      ['0xdeadbeef', 'number-hex'],
      ['/var/log/app.log', 'path'],
    ])('tokenizes %s as %s', (text, token) => {
      expect(tokenOf(text)).toBe(token);
    });
  });

  describe('rule order', () => {
    it('puts the log levels before the catch-all', () => {
      const levelIndex = rules.findIndex(([, token]) => token === 'log-level-error');
      const catchAllIndex = rules.findIndex(([pattern]) => pattern.source === '\\S+');
      expect(levelIndex).toBeGreaterThanOrEqual(0);
      expect(levelIndex).toBeLessThan(catchAllIndex);
    });

    it('ends with a catch-all so no text goes untokenized', () => {
      expect(rules[rules.length - 1][0].source).toBe('\\S+');
    });

    it('tries URLs before emails, so a URL with an @ stays one token', () => {
      const urlIndex = rules.findIndex(([, token]) => token === 'url');
      const emailIndex = rules.findIndex(([, token]) => token === 'email');
      expect(urlIndex).toBeLessThan(emailIndex);
    });
  });

  describe('theme coverage', () => {
    it('styles every token the grammar can emit, in both themes', () => {
      const emitted = new Set(rules.map(([, token]) => token).filter(Boolean));
      for (const themeRules of [getLogLanguageThemeRules(), getLogLanguageThemeRulesDark()]) {
        const styled = new Set(themeRules.map((r) => r.token));
        const unstyled = [...emitted].filter((t) => !styled.has(t));
        expect(unstyled, 'tokens with no colour would render as plain text').toEqual([]);
      }
    });
  });
});

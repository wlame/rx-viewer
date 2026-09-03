import { describe, it, expect } from 'vitest';
import { applyRegexFilter } from './regexFilter';
import type { RegexFilter } from '../types';

/**
 * The filter rewrites log lines into HTML that the editor renders. Two
 * things matter: the mode must transform only the captured groups, and
 * every byte that reaches the output must be escaped — log content is
 * attacker-influenced in most deployments.
 */
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

describe('applyRegexFilter', () => {
  describe('when no filter applies', () => {
    it('escapes the line when the filter is null', () => {
      expect(applyRegexFilter('<b>&</b>', null)).toBe('&lt;b&gt;&amp;&lt;/b&gt;');
    });

    it('escapes the line when the filter is disabled', () => {
      const f = { ...filter('(\\d+)', 'hide'), enabled: false };
      expect(applyRegexFilter('id=42 <x>', f)).toBe('id=42 &lt;x&gt;');
    });

    it('escapes the line when the pattern did not compile', () => {
      // What the editor holds while the user is mid-typing "(a+"; the
      // filter must show the line, not throw or blank it.
      const f: RegexFilter = {
        enabled: true,
        pattern: '(',
        mode: 'hide',
        compiledRegex: null,
        error: 'Unterminated group',
        applying: false,
      };
      expect(applyRegexFilter('a<b', f)).toBe('a&lt;b');
    });

    it('leaves a non-matching line intact', () => {
      expect(applyRegexFilter('nothing here', filter('(\\d+)', 'hide'))).toBe('nothing here');
    });
  });

  describe('hide mode', () => {
    it('replaces each captured group with a bar and keeps the rest', () => {
      const out = applyRegexFilter('user=alice id=42', filter('id=(\\d+)', 'hide'));
      expect(out).toContain('user=alice id=');
      expect(out).toContain('hidden-bar');
      expect(out).not.toContain('>42<');
    });

    it('carries the hidden text in a title so it stays recoverable', () => {
      const out = applyRegexFilter('token=s3cret', filter('token=(\\w+)', 'hide'));
      expect(out).toContain('title="s3cret"');
    });
  });

  describe('show mode', () => {
    it('keeps the captured group', () => {
      const out = applyRegexFilter('noise id=42 noise', filter('id=(\\d+)', 'show'));
      expect(out).toContain('42');
    });
  });

  describe('highlight mode', () => {
    it('keeps the whole line and marks the group', () => {
      const out = applyRegexFilter('level=ERROR msg=x', filter('level=(\\w+)', 'highlight'));
      expect(out).toContain('msg=x');
      expect(out).toContain('ERROR');
    });
  });

  describe('escaping', () => {
    it.each(['hide', 'show', 'highlight'] as const)(
      'never emits an unescaped angle bracket from the line in %s mode',
      (mode) => {
        const out = applyRegexFilter('<script>alert(1)</script> id=1', filter('id=(\\d+)', mode));
        expect(out).not.toContain('<script>');
      },
    );

    it('escapes the hidden text inside the title attribute', () => {
      const out = applyRegexFilter('v="><img>', filter('v=(.*)', 'hide'));
      expect(out).not.toContain('title=""><img>"');
      expect(out).toContain('&quot;');
    });
  });

  describe('statefulness', () => {
    it('gives the same answer when the same filter is reused', () => {
      const f = filter('(\\d+)', 'highlight');
      const first = applyRegexFilter('a1 b2', f);
      const second = applyRegexFilter('a1 b2', f);
      expect(second).toBe(first);
    });
  });
});

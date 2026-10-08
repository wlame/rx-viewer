import { describe, expect, it } from 'vitest';
import { MONACO_THEMES } from '../types';
import {
  DEFAULT_SETTINGS,
  THEME_SETTINGS,
  editorThemeFor,
  nextThemeSetting,
  parseSettings,
  resolveTheme,
} from './appSettings';

describe('nextThemeSetting', () => {
  it.each([
    ['system', 'light', 'dark'],
    ['dark', 'light', 'system'],
    ['light', 'light', 'dark'],
    ['system', 'dark', 'light'],
    ['light', 'dark', 'system'],
    ['dark', 'dark', 'light'],
  ] as const)('steps from %s on a %s system to %s', (current, systemTheme, expected) => {
    expect(nextThemeSetting(current, systemTheme)).toBe(expected);
  });

  // System and the fixed theme the system shows look the same, so a
  // step between them would change nothing on screen.
  it.each(['light', 'dark'] as const)(
    'changes the look on every click on a %s system',
    (systemTheme) => {
      for (const current of Object.keys(THEME_SETTINGS) as (keyof typeof THEME_SETTINGS)[]) {
        const next = nextThemeSetting(current, systemTheme);
        expect(resolveTheme(next, systemTheme === 'dark')).not.toBe(
          resolveTheme(current, systemTheme === 'dark'),
        );
      }
    },
  );

  it.each(['light', 'dark'] as const)(
    'comes back to system on the second click on a %s system',
    (systemTheme) => {
      expect(nextThemeSetting(nextThemeSetting('system', systemTheme), systemTheme)).toBe('system');
    },
  );
});

describe('resolveTheme', () => {
  it.each([
    ['system', true, 'dark'],
    ['system', false, 'light'],
    ['light', true, 'light'],
    ['dark', false, 'dark'],
  ] as const)('reads %s with a dark preference %s as %s', (setting, prefersDark, expected) => {
    expect(resolveTheme(setting, prefersDark)).toBe(expected);
  });
});

describe('editorThemeFor', () => {
  it('follows the app theme for the theme that says it does', () => {
    expect(editorThemeFor('vs', 'light')).toBe('vs');
    expect(editorThemeFor('vs', 'dark')).toBe('vs-dark');
  });

  it('keeps a fixed theme whatever the app theme', () => {
    expect(editorThemeFor('monokai', 'light')).toBe('monokai');
    expect(editorThemeFor('github-light', 'dark')).toBe('github-light');
  });

  // Two entries of the picker that render the same way in both app
  // themes are one choice listed twice.
  it('lists no two editor themes that look the same in both app themes', () => {
    const looks = MONACO_THEMES.map(
      (t) => `${editorThemeFor(t.id, 'light')}/${editorThemeFor(t.id, 'dark')}`,
    );
    expect(new Set(looks).size).toBe(looks.length);
  });
});

describe('parseSettings', () => {
  it('keeps every known setting with a valid value', () => {
    const stored = { theme: 'dark', sidebarWidth: 320, monacoTheme: 'monokai', chainMode: true };
    expect(parseSettings(stored)).toEqual(stored);
  });

  // "vs-dark" was a picker entry that followed the app theme like "vs".
  it('reads an editor theme the picker no longer lists as the default', () => {
    expect(parseSettings({ monacoTheme: 'vs-dark' }).monacoTheme).toBe(
      DEFAULT_SETTINGS.monacoTheme,
    );
  });

  it('drops keys no control sets and values of the wrong kind', () => {
    const parsed = parseSettings({
      theme: 'sepia',
      sidebarWidth: '280',
      wrapLines: true,
      chainMode: 'on',
    });
    expect(parsed).toEqual(DEFAULT_SETTINGS);
  });

  it.each([null, 'text', 42, []])('falls back to the defaults for %j', (stored) => {
    expect(parseSettings(stored)).toEqual(DEFAULT_SETTINGS);
  });
});

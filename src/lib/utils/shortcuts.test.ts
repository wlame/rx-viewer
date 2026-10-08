import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it, vi } from 'vitest';
import {
  SHORTCUTS,
  handleGlobalKey,
  isShortcut,
  shortcutLabel,
  shortcutsByScope,
  type GlobalShortcutActions,
  type KeyPress,
} from './shortcuts';
import { belongsToInputMethod } from './keyTargets';
import { SEARCH_TOGGLES } from './searchToggles';

/** A key press with no modifier unless one is given. */
function press(key: string, modifiers: Partial<KeyPress> = {}) {
  return {
    key,
    code: modifiers.code ?? '',
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...modifiers,
    preventDefault: vi.fn(),
  };
}

/** Actions that all act, recording which one ran. */
function recordingActions(overrides: Partial<GlobalShortcutActions> = {}) {
  const ran: string[] = [];
  const act = (id: string) => () => {
    ran.push(id);
    return true;
  };
  const actions: GlobalShortcutActions = {
    focusSearch: act('focusSearch'),
    toggleSidebar: act('toggleSidebar'),
    showShortcuts: act('showShortcuts'),
    closeDialog: act('closeDialog'),
    ...overrides,
  };
  return { actions, ran };
}

describe('handleGlobalKey', () => {
  it('runs focus search for Cmd+K and for Ctrl+K and keeps the key from the browser', () => {
    for (const modifier of [{ metaKey: true }, { ctrlKey: true }]) {
      const { actions, ran } = recordingActions();
      const event = press('k', modifier);

      expect(handleGlobalKey(event, actions)).toBe(true);
      expect(ran).toEqual(['focusSearch']);
      expect(event.preventDefault).toHaveBeenCalled();
    }
  });

  it('runs the sidebar toggle for Cmd+B', () => {
    const { actions, ran } = recordingActions();

    handleGlobalKey(press('b', { metaKey: true }), actions);

    expect(ran).toEqual(['toggleSidebar']);
  });

  it('leaves a key to the browser when the action had nothing to do', () => {
    const { actions } = recordingActions({ closeDialog: () => false });
    const event = press('Escape');

    expect(handleGlobalKey(event, actions)).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('leaves keys that are not shortcuts to the browser', () => {
    const { actions, ran } = recordingActions();
    for (const event of [press('k'), press('l', { metaKey: true }), press('k', { altKey: true })]) {
      expect(handleGlobalKey(event, actions)).toBe(false);
      expect(event.preventDefault).not.toHaveBeenCalled();
    }
    expect(ran).toEqual([]);
  });
});

describe('isShortcut', () => {
  it('matches the go-to-line colon, which needs Shift on most layouts', () => {
    expect(isShortcut('gotoLine', press(':', { shiftKey: true }))).toBe(true);
    expect(isShortcut('gotoLine', press(':', { metaKey: true }))).toBe(false);
  });

  // Monaco binds Cmd/Ctrl+G to its own go-to-line, which counts the
  // loaded editor lines; the pane takes the key for the file-line jump.
  it('matches Cmd+G and Ctrl+G as the go-to-line key too', () => {
    expect(isShortcut('gotoLine', press('g', { metaKey: true }))).toBe(true);
    expect(isShortcut('gotoLine', press('G', { ctrlKey: true }))).toBe(true);
    expect(isShortcut('gotoLine', press('g'))).toBe(false);
  });

  it('matches Enter without Shift as the search key', () => {
    expect(isShortcut('runSearch', press('Enter'))).toBe(true);
    expect(isShortcut('runSearch', press('Enter', { shiftKey: true }))).toBe(false);
  });

  it('matches Enter as the filter apply key and Escape as its close key', () => {
    expect(isShortcut('applyFilter', press('Enter'))).toBe(true);
    expect(isShortcut('applyFilter', press('Enter', { metaKey: true }))).toBe(false);
    expect(isShortcut('closeFilter', press('Escape'))).toBe(true);
    expect(isShortcut('closeFilter', press('a', { metaKey: true }))).toBe(false);
  });

  // On a Mac Alt+C types "ç", so the toggles match the key's code.
  it('matches a search toggle by key code with Alt', () => {
    expect(isShortcut('toggle:matchCase', press('ç', { code: 'KeyC', altKey: true }))).toBe(true);
  });

  it('matches Enter as the go-to box jump key and Escape as its close key', () => {
    expect(isShortcut('gotoJump', press('Enter'))).toBe(true);
    expect(isShortcut('gotoJump', press('Enter', { metaKey: true }))).toBe(false);
    expect(isShortcut('gotoClose', press('Escape'))).toBe(true);
    expect(isShortcut('gotoClose', press('Enter'))).toBe(false);
  });

  // While an input method composes, Enter confirms the composition and
  // Escape cancels it. Safari reports the Enter that ends a composition
  // with isComposing false and the key code 229.
  it.each([
    ['runSearch', press('Enter', { isComposing: true })],
    ['runSearch', press('Enter', { keyCode: 229 })],
    ['gotoJump', press('Enter', { isComposing: true })],
    ['gotoClose', press('Escape', { isComposing: true })],
    ['applyFilter', press('Enter', { keyCode: 229 })],
    ['focusSearch', press('k', { metaKey: true, isComposing: true })],
    ['closeHistory', press('Escape', { isComposing: true })],
    ['closeAnalysis', press('Escape', { keyCode: 229 })],
  ] as const)('leaves %s to an input method that composes', (id, event) => {
    expect(isShortcut(id, event)).toBe(false);
  });
});

describe('panel and tree keys', () => {
  it('matches Escape as the key that closes the recent commands, the analysis and a chain part list', () => {
    for (const id of ['closeHistory', 'closeAnalysis', 'closeChainParts'] as const) {
      expect(isShortcut(id, press('Escape'))).toBe(true);
      expect(isShortcut(id, press('Enter'))).toBe(false);
    }
  });

  it('matches Enter and Space on a tree row, without a modifier', () => {
    expect(isShortcut('openTreeItem', press('Enter'))).toBe(true);
    expect(isShortcut('openTreeItem', press(' '))).toBe(true);
    expect(isShortcut('openTreeItem', press('Enter', { metaKey: true }))).toBe(false);
    expect(isShortcut('openTreeItem', press('a'))).toBe(false);
  });
});

describe('belongsToInputMethod', () => {
  it('is true while composing or for the key code 229, false otherwise', () => {
    expect(belongsToInputMethod(press('Enter', { isComposing: true }))).toBe(true);
    expect(belongsToInputMethod(press('Process', { keyCode: 229 }))).toBe(true);
    expect(belongsToInputMethod(press('Enter', { keyCode: 13 }))).toBe(false);
    expect(belongsToInputMethod(press('Enter'))).toBe(false);
  });
});

describe('the shortcut list', () => {
  // The README's table is written by hand; the app's list is built from this table.
  it('has rows in the README table for every place a shortcut works', () => {
    const readme = readFileSync(resolve(__dirname, '../../../README.md'), 'utf-8').split('\n');
    const missing = shortcutsByScope()
      .map((group) => group.title)
      .filter((title) => !readme.some((line) => line.startsWith(`| ${title} `)));

    expect(missing).toEqual([]);
  });

  it('lists every row of the table once, grouped by where it works', () => {
    const listed = shortcutsByScope().flatMap((group) => group.shortcuts);

    expect(listed).toHaveLength(SHORTCUTS.length);
    expect(new Set(listed.map((s) => s.id)).size).toBe(SHORTCUTS.length);
  });

  it('holds the pane, search and chip shortcuts besides the window-wide ones', () => {
    const labels = SHORTCUTS.map(shortcutLabel);

    expect(labels).toEqual(
      expect.arrayContaining([
        '⌘/Ctrl+K',
        '⌘/Ctrl+B',
        '⌘/Ctrl+/',
        'Esc',
        'Enter',
        ': or ⌘/Ctrl+G',
        'Alt+C',
        'Alt+W',
        'Alt+R',
        '⌘/Alt+click',
      ]),
    );
  });

  it('lists the go-to box keys in their own group', () => {
    const group = shortcutsByScope().find((g) => g.scope === 'gotoField');

    expect(group?.title).toBe('In the go-to-line box');
    expect(group?.shortcuts.map((s) => s.id)).toEqual(['gotoJump', 'gotoClose']);
    expect(group?.shortcuts.map(shortcutLabel)).toEqual(['Enter', 'Esc']);
  });

  it.each([
    ['fileTree', 'In the file tree', ['openTreeItem'], ['Enter or Space']],
    [
      'openPanel',
      'While a panel is open',
      ['closeHistory', 'closeAnalysis', 'closeChainParts'],
      ['Esc', 'Esc', 'Esc'],
    ],
    [
      'timeline',
      'On the timeline bar',
      [
        'timelineStep',
        'timelineBigStep',
        'timelineEnds',
        'timelineJump',
        'timelineCancel',
        'timelineScrub',
      ],
      ['← or →', 'Shift+← or Shift+→', 'Home or End', 'Enter', 'Esc', 'Drag or click'],
    ],
    [
      'zonePicker',
      "In the picker of a file's time zone",
      ['zoneMove', 'zoneChoose', 'zoneClose'],
      ['↓ or ↑', 'Enter', 'Esc'],
    ],
  ])('lists the %s keys in their own group', (scope, title, ids, labels) => {
    const group = shortcutsByScope().find((g) => g.scope === scope);

    expect(group?.title).toBe(title);
    expect(group?.shortcuts.map((s) => s.id)).toEqual(ids);
    expect(group?.shortcuts.map(shortcutLabel)).toEqual(labels);
  });

  it('holds one row per search toggle, from the toggle table', () => {
    for (const toggle of SEARCH_TOGGLES) {
      expect(SHORTCUTS.some((s) => s.id === `toggle:${toggle.key}`)).toBe(true);
    }
  });

  it('gives every row a label and a description', () => {
    for (const shortcut of SHORTCUTS) {
      expect(shortcutLabel(shortcut)).not.toBe('');
      expect(shortcut.description).not.toBe('');
    }
  });
});

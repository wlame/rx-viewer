import { readFileSync } from 'fs';
import { resolve } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SHORTCUTS,
  SHORTCUT_SCOPES,
  chordKeys,
  chordLabel,
  detectPlatform,
  handleFileTabsKey,
  handleFilesPanelKey,
  handleRecentTabsKey,
  handleGlobalKey,
  handleSearchPanelKey,
  isShortcut,
  shortcutKeys,
  shortcutLabel,
  shortcutsByScope,
  type GlobalShortcutActions,
  type KeyChord,
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
    showFiles: act('showFiles'),
    showSearch: act('showSearch'),
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

  // A Mac sends the character Option makes ("¡", "™") as the key, so the
  // digit rows match the key's code.
  it.each([
    ['Alt+1 as a Mac sends it', press('¡', { code: 'Digit1', altKey: true }), 'showFiles'],
    ['Alt+1 elsewhere', press('1', { code: 'Digit1', altKey: true }), 'showFiles'],
    ['Cmd+Shift+E', press('E', { code: 'KeyE', metaKey: true, shiftKey: true }), 'showFiles'],
    ['Ctrl+Shift+E', press('E', { code: 'KeyE', ctrlKey: true, shiftKey: true }), 'showFiles'],
    ['Alt+2 as a Mac sends it', press('™', { code: 'Digit2', altKey: true }), 'showSearch'],
    ['Cmd+Shift+F', press('F', { code: 'KeyF', metaKey: true, shiftKey: true }), 'showSearch'],
    ['Ctrl+Shift+F', press('F', { code: 'KeyF', ctrlKey: true, shiftKey: true }), 'showSearch'],
  ])('runs the panel key for %s and keeps the key from the browser', (_name, event, id) => {
    const { actions, ran } = recordingActions();

    expect(handleGlobalKey(event, actions)).toBe(true);
    expect(ran).toEqual([id]);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('takes neither panel key without its modifiers', () => {
    const { actions, ran } = recordingActions();
    for (const event of [
      press('1', { code: 'Digit1' }),
      press('¡', { code: 'Digit1', altKey: true, metaKey: true }),
      press('e', { code: 'KeyE', metaKey: true }),
      press('f', { code: 'KeyF', ctrlKey: true }),
    ]) {
      expect(handleGlobalKey(event, actions)).toBe(false);
    }
    expect(ran).toEqual([]);
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

describe('handleFilesPanelKey', () => {
  /** Actions for the five files panel keys, each acting unless told not to. */
  function filesActions(acting = true) {
    const ran: string[] = [];
    const act = (id: string) => () => {
      ran.push(id);
      return acting;
    };
    return {
      ran,
      actions: {
        toggleChainMode: act('toggleChainMode'),
        toggleLabels: act('toggleLabels'),
        switchValue: act('switchValue'),
        sortByName: act('sortByName'),
        sortByValue: act('sortByValue'),
      },
    };
  }

  // A Mac types the Option symbol as the key; the code names the letter.
  // Option+N is a dead key on a Mac's US layout: its key is "Dead".
  it.each([
    ['toggleChainMode', '©', 'KeyG'],
    ['toggleLabels', '¬', 'KeyL'],
    ['switchValue', '√', 'KeyV'],
    ['sortByName', 'Dead', 'KeyN'],
    ['sortByValue', 'ß', 'KeyS'],
  ])('runs %s for Alt+%s and keeps the key from the browser', (id, key, code) => {
    const { actions, ran } = filesActions();
    const event = press(key, { code, altKey: true });

    expect(handleFilesPanelKey(event, actions)).toBe(true);
    expect(ran).toEqual([id]);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('leaves the key to the browser when the action did nothing', () => {
    const { actions, ran } = filesActions(false);
    const event = press('©', { code: 'KeyG', altKey: true });

    expect(handleFilesPanelKey(event, actions)).toBe(false);
    expect(ran).toEqual(['toggleChainMode']);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('matches only the keys it is given actions for', () => {
    const { actions, ran } = filesActions();
    const event = press('©', { code: 'KeyG', altKey: true });

    expect(handleFilesPanelKey(event, { toggleLabels: actions.toggleLabels })).toBe(false);
    expect(ran).toEqual([]);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it.each([
    ['G without Alt', press('g', { code: 'KeyG' })],
    ['Cmd+Alt+G', press('©', { code: 'KeyG', altKey: true, metaKey: true })],
    ['Alt+G of an input method', press('©', { code: 'KeyG', altKey: true, isComposing: true })],
  ])('leaves %s alone', (_name, event) => {
    const { actions, ran } = filesActions();

    expect(handleFilesPanelKey(event, actions)).toBe(false);
    expect(ran).toEqual([]);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});

describe('handleFileTabsKey', () => {
  /** Actions for the open file tab keys, each acting unless told not to. */
  function tabActions(acting = true) {
    const ran: string[] = [];
    const act = (id: string) => () => {
      ran.push(id);
      return acting;
    };
    return {
      ran,
      actions: {
        nextTab: act('nextTab'),
        previousTab: act('previousTab'),
        closeTab: act('closeTab'),
      },
    };
  }

  // A Mac types the Option symbol as the key: Option+] is "‘", Option+[
  // is "“" and Option+X is "≈". Other systems send the bracket itself.
  it.each([
    ['nextTab', '‘', 'BracketRight'],
    ['previousTab', '“', 'BracketLeft'],
    ['closeTab', '≈', 'KeyX'],
    ['nextTab', ']', 'BracketRight'],
    ['previousTab', '[', 'BracketLeft'],
    ['closeTab', 'x', 'KeyX'],
  ])('runs %s for Alt+%s and keeps the key from the browser', (id, key, code) => {
    const { actions, ran } = tabActions();
    const event = press(key, { code, altKey: true });

    expect(handleFileTabsKey(event, actions)).toBe(true);
    expect(ran).toEqual([id]);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('leaves the key to the browser when the action did nothing', () => {
    const { actions, ran } = tabActions(false);
    const event = press('‘', { code: 'BracketRight', altKey: true });

    expect(handleFileTabsKey(event, actions)).toBe(false);
    expect(ran).toEqual(['nextTab']);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it.each([
    ['] without Alt', press(']', { code: 'BracketRight' })],
    ['Cmd+Alt+]', press('‘', { code: 'BracketRight', altKey: true, metaKey: true })],
    ['Ctrl+Alt+X, which AltGr sends', press('x', { code: 'KeyX', altKey: true, ctrlKey: true })],
  ])('leaves %s alone', (_name, event) => {
    const { actions, ran } = tabActions();

    expect(handleFileTabsKey(event, actions)).toBe(false);
    expect(ran).toEqual([]);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});

describe('handleRecentTabsKey', () => {
  /** Actions for the recent-tab switcher's keys, recording which one ran. */
  function switcherActions() {
    const ran: string[] = [];
    const act = (id: string) => () => {
      ran.push(id);
      return true;
    };
    return {
      ran,
      actions: {
        recentTab: act('recentTab'),
        recentTabBack: act('recentTabBack'),
        closeRecentTabs: act('closeRecentTabs'),
      },
    };
  }

  // A Mac types "œ" for Option+Q and "Œ" for Option+Shift+Q.
  it.each([
    ['recentTab', press('œ', { code: 'KeyQ', altKey: true })],
    ['recentTab', press('q', { code: 'KeyQ', altKey: true })],
    ['recentTabBack', press('Œ', { code: 'KeyQ', altKey: true, shiftKey: true })],
    ['recentTabBack', press('Q', { code: 'KeyQ', altKey: true, shiftKey: true })],
    // Alt is held while the list is open; Esc without it is matched too.
    ['closeRecentTabs', press('Escape', { code: 'Escape', altKey: true })],
    ['closeRecentTabs', press('Escape', { code: 'Escape' })],
  ])('runs %s for %o and keeps the key from the browser', (id, event) => {
    const { actions, ran } = switcherActions();

    expect(handleRecentTabsKey(event, actions)).toBe(true);
    expect(ran).toEqual([id]);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it.each([
    ['Q without Alt', press('q', { code: 'KeyQ' })],
    ['Cmd+Alt+Q', press('œ', { code: 'KeyQ', altKey: true, metaKey: true })],
  ])('leaves %s alone', (_name, event) => {
    const { actions, ran } = switcherActions();

    expect(handleRecentTabsKey(event, actions)).toBe(false);
    expect(ran).toEqual([]);
  });
});

describe('handleSearchPanelKey', () => {
  /** Actions for the search panel keys, each acting unless told not to. */
  function searchActions(acting = true) {
    const ran: string[] = [];
    const act = (id: string) => () => {
      ran.push(id);
      return acting;
    };
    return {
      ran,
      actions: {
        'toggle:matchCase': act('toggle:matchCase'),
        'toggle:wholeWord': act('toggle:wholeWord'),
        'toggle:regex': act('toggle:regex'),
        toggleOnlyOpened: act('toggleOnlyOpened'),
      },
    };
  }

  // A Mac types the Option symbol as the key; the code names the letter.
  it.each([
    ['toggle:matchCase', 'ç', 'KeyC'],
    ['toggle:wholeWord', '∑', 'KeyW'],
    ['toggle:regex', '®', 'KeyR'],
    ['toggleOnlyOpened', 'ø', 'KeyO'],
  ])('runs %s for Alt+%s and keeps the key from the browser', (id, key, code) => {
    const { actions, ran } = searchActions();
    const event = press(key, { code, altKey: true });

    expect(handleSearchPanelKey(event, actions)).toBe(true);
    expect(ran).toEqual([id]);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('leaves the key to the browser when the toggle did not act', () => {
    const { actions, ran } = searchActions(false);
    const event = press('ç', { code: 'KeyC', altKey: true });

    expect(handleSearchPanelKey(event, actions)).toBe(false);
    expect(ran).toEqual(['toggle:matchCase']);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it.each([
    ['C without Alt', press('c', { code: 'KeyC' })],
    ['Cmd+Alt+C', press('ç', { code: 'KeyC', altKey: true, metaKey: true })],
    ['Alt+C of an input method', press('ç', { code: 'KeyC', altKey: true, isComposing: true })],
    ['Alt+G', press('©', { code: 'KeyG', altKey: true })],
  ])('leaves %s alone', (_name, event) => {
    const { actions, ran } = searchActions();

    expect(handleSearchPanelKey(event, actions)).toBe(false);
    expect(ran).toEqual([]);
    expect(event.preventDefault).not.toHaveBeenCalled();
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
    ['showFiles', press('¡', { code: 'Digit1', altKey: true, isComposing: true })],
    ['showSearch', press('F', { metaKey: true, shiftKey: true, keyCode: 229 })],
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

/**
 * The keys of a label or of a README cell, one string each: the README
 * spells the command key out (`Cmd`, where the app draws `⌘`), writes a
 * literal key in backticks, and joins the keys of one action with `or` or
 * a comma, which are no part of a key.
 */
function keysOf(text: string): string[] {
  return text
    .replace(/⌘/g, 'Cmd')
    .replace(/`/g, '')
    .split(/,\s+|\s+or\s+/)
    .map((key) => key.trim())
    .filter((key) => key !== '');
}

/** The README's "Keyboard shortcuts" table: where each row works, and its keys. */
function readmeShortcutRows(): { where: string; keys: string[] }[] {
  const readme = readFileSync(resolve(__dirname, '../../../README.md'), 'utf-8').split('\n');
  const afterHeading = readme.slice(
    readme.findIndex((line) => line.startsWith('### Keyboard shortcuts')) + 1,
  );
  const nextHeading = afterHeading.findIndex((line) => line.startsWith('#'));
  return afterHeading
    .slice(0, nextHeading)
    .filter((line) => line.startsWith('|'))
    .map((line) => line.split('|').map((cell) => cell.trim()))
    .filter(([, where]) => where !== 'Where' && !/^-+$/.test(where))
    .map(([, where, keys]) => ({ where, keys: keysOf(keys) }));
}

describe('the README keyboard shortcut table', () => {
  // The README's table is written by hand; the app's list is built from the table.
  it('holds every key of the shortcut table under the place it works in', () => {
    const rows = readmeShortcutRows();
    const missing = SHORTCUTS.flatMap((shortcut) => {
      const where = SHORTCUT_SCOPES[shortcut.scope];
      const written = rows.filter((row) => row.where === where).flatMap((row) => row.keys);
      return keysOf(shortcutLabel(shortcut))
        .filter((key) => !written.includes(key))
        .map((key) => `${where}: ${key} (${shortcut.id})`);
    });

    expect(missing).toEqual([]);
  });

  it('holds no key the shortcut table lacks under that place', () => {
    const known = SHORTCUTS.map((shortcut) => ({
      where: SHORTCUT_SCOPES[shortcut.scope],
      keys: keysOf(shortcutLabel(shortcut)),
    }));
    const stale = readmeShortcutRows().flatMap((row) =>
      row.keys
        .filter((key) => !known.some((s) => s.where === row.where && s.keys.includes(key)))
        .map((key) => `${row.where}: ${key}`),
    );

    expect(stale).toEqual([]);
  });
});

describe('the shortcut list', () => {
  // The file tree hands each of these keys to its key rules; a key the
  // tree acts on without a row would be missing from the help.
  it.each([
    'ArrowDown',
    'ArrowUp',
    'ArrowRight',
    'ArrowLeft',
    'Home',
    'End',
    'PageDown',
    'PageUp',
    'Enter',
    ' ',
    'Escape',
  ])('has a file tree row for %j, a key the tree acts on', (key) => {
    const rows = SHORTCUTS.filter((s) => s.scope === 'fileTree');

    expect(rows.some((s) => isShortcut(s.id, press(key)))).toBe(true);
    expect(rows.some((s) => isShortcut(s.id, press(key, { metaKey: true })))).toBe(false);
  });

  it('names typing in the file tree as a gesture', () => {
    expect(SHORTCUTS.find((s) => s.id === 'treeTypeName')).toMatchObject({
      scope: 'fileTree',
      gesture: 'Type a name',
    });
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
    [
      'panels',
      'Panels, from anywhere',
      ['showFiles', 'showSearch'],
      ['Alt+1 or ⌘/Ctrl+Shift+E', 'Alt+2 or ⌘/Ctrl+Shift+F'],
    ],
    [
      'fileTabs',
      'Open file tabs, from anywhere',
      ['nextTab', 'previousTab', 'recentTab', 'recentTabBack', 'closeTab'],
      ['Alt+]', 'Alt+[', 'Alt+Q', 'Alt+Shift+Q', 'Alt+X'],
    ],
    ['activityBar', 'In the activity bar', ['activityBarMove'], ['↓ or ↑']],
    [
      'filesPanel',
      'In the files panel, while it is shown',
      ['toggleChainMode', 'toggleLabels', 'switchValue', 'sortByName', 'sortByValue'],
      ['Alt+G', 'Alt+L', 'Alt+V', 'Alt+N', 'Alt+S'],
    ],
    ['valueSwitch', 'On the Size/Date switch', ['valueSwitchMove'], ['← or →']],
    [
      'searchPanel',
      'In the search panel',
      ['toggle:matchCase', 'toggle:wholeWord', 'toggle:regex', 'toggleOnlyOpened'],
      ['Alt+C', 'Alt+W', 'Alt+R', 'Alt+O'],
    ],
    ['searchField', 'In a search pattern field or the max box', ['runSearch'], ['Enter']],
    [
      'tabStrip',
      'On the open-file tabs',
      ['tabStripMove', 'tabStripEnds', 'tabStripClose'],
      ['→ or ←', 'Home or End', 'Delete or Backspace'],
    ],
    [
      'fileTree',
      'In the file tree',
      [
        'treeMove',
        'treeOpenFolder',
        'treeCloseFolder',
        'treeEnds',
        'treePage',
        'openTreeItem',
        'treeTypeName',
        'treeToEditor',
      ],
      [
        '↓ or ↑',
        '→',
        '←',
        'Home or End',
        'PageDown or PageUp',
        'Enter or Space',
        'Type a name',
        'Esc',
      ],
    ],
    [
      'openPanel',
      'While a panel is open',
      ['closeHistory', 'closeAnalysis', 'closeChainParts', 'closeRecentTabs'],
      ['Esc', 'Esc', 'Esc', 'Alt+Esc or Esc'],
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

  it('lists every place a shortcut works, in the order of the places, none empty', () => {
    const groups = shortcutsByScope();

    expect(groups.map((g) => g.scope)).toEqual(Object.keys(SHORTCUT_SCOPES));
    expect(groups.every((g) => g.shortcuts.length > 0)).toBe(true);
  });

  it('lists the panel keys right after the window-wide ones, then the open file tab keys', () => {
    expect(
      shortcutsByScope()
        .map((g) => g.scope)
        .slice(0, 3),
    ).toEqual(['anywhere', 'panels', 'fileTabs']);
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

describe('chordKeys', () => {
  it.each<[KeyChord, string[], string[]]>([
    [{ code: 'KeyG', alt: true }, ['⌥', 'G'], ['Alt', 'G']],
    [{ code: 'Digit1', alt: true }, ['⌥', '1'], ['Alt', '1']],
    [{ code: 'BracketRight', alt: true }, ['⌥', ']'], ['Alt', ']']],
    [{ code: 'BracketLeft', alt: true }, ['⌥', '['], ['Alt', '[']],
    [{ key: 'e', mod: true, shift: true }, ['⌘', '⇧', 'E'], ['Ctrl', 'Shift', 'E']],
    [{ key: 'Escape' }, ['Esc'], ['Esc']],
    [{ key: '/', mod: true }, ['⌘', '/'], ['Ctrl', '/']],
    [{ key: ' ' }, ['Space'], ['Space']],
    [{ key: 'ArrowLeft', shift: true }, ['⇧', '←'], ['Shift', '←']],
  ])('names the keys of %o on a Mac and elsewhere', (chord, mac, other) => {
    expect(chordKeys(chord, 'mac')).toEqual(mac);
    expect(chordKeys(chord, 'other')).toEqual(other);
  });

  // `shift: false` means "without Shift": it is matched, not pressed.
  it('shows no Shift for a chord that must be pressed without it', () => {
    expect(chordKeys({ key: 'Enter', shift: false }, 'mac')).toEqual(['Enter']);
    expect(chordKeys({ key: 'Enter', shift: false }, 'other')).toEqual(['Enter']);
  });
});

describe('shortcutKeys', () => {
  it('gives the keys of every chord of a row, its main chord first', () => {
    expect(shortcutKeys('gotoLine', 'mac')).toEqual([[':'], ['⌘', 'G']]);
    expect(shortcutKeys('gotoLine', 'other')).toEqual([[':'], ['Ctrl', 'G']]);
    expect(shortcutKeys('focusSearch', 'mac')).toEqual([['⌘', 'K']]);
    expect(shortcutKeys('toggle:matchCase', 'other')).toEqual([['Alt', 'C']]);
    expect(shortcutKeys('toggleChainMode', 'mac')).toEqual([['⌥', 'G']]);
  });

  it('gives no keys for a row that is a mouse gesture', () => {
    expect(shortcutKeys('timelineScrub', 'mac')).toEqual([]);
  });
});

describe('detectPlatform', () => {
  const MAC_SAFARI =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
  const WINDOWS_CHROME =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
  const LINUX_FIREFOX = 'Mozilla/5.0 (X11; Linux x86_64; rv:141.0) Gecko/20100101 Firefox/141.0';

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ['a Mac', { platform: 'MacIntel', userAgent: MAC_SAFARI }],
    ['a Mac whose platform is empty', { platform: '', userAgent: MAC_SAFARI }],
    ['a Mac platform alone', { platform: 'MacIntel' }],
    ['an iPad', { platform: 'iPad', userAgent: '' }],
  ])('is mac for %s', (_name, nav) => {
    expect(detectPlatform(nav)).toBe('mac');
  });

  it.each([
    ['Windows', { platform: 'Win32', userAgent: WINDOWS_CHROME }],
    ['Linux', { platform: 'Linux x86_64', userAgent: LINUX_FIREFOX }],
    ['an empty navigator', {}],
  ])('is other for %s', (_name, nav) => {
    expect(detectPlatform(nav)).toBe('other');
  });

  it('reads the browser navigator when given none, and is other without one', () => {
    vi.stubGlobal('navigator', { platform: 'MacIntel', userAgent: MAC_SAFARI });
    expect(detectPlatform()).toBe('mac');

    vi.stubGlobal('navigator', undefined);
    expect(detectPlatform()).toBe('other');
  });
});

describe('chordLabel', () => {
  it('reads a digit code as its digit', () => {
    expect(chordLabel({ code: 'Digit1', alt: true })).toBe('Alt+1');
  });
});

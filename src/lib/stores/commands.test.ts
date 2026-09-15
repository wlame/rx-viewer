import { afterEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { commandLog, lastCommand, RECENT_COMMANDS_LIMIT } from './commands';

/**
 * The viewer shows the `rx` command the backend says gives each answer,
 * so a user learns the command line from the UI. It shows only what the
 * backend sent: an answer without a command adds nothing.
 */
describe('commandLog', () => {
  afterEach(() => commandLog.clear());

  it('holds the newest command first', () => {
    commandLog.record('rx samples /a.log --lines=1-500', 'file');
    commandLog.record('rx trace /logs --regexp=ERROR', 'search');

    expect(get(commandLog).map((entry) => entry.command)).toEqual([
      'rx trace /logs --regexp=ERROR',
      'rx samples /a.log --lines=1-500',
    ]);
    expect(get(lastCommand)?.action).toBe('search');
  });

  it.each([null, undefined, '', '   '])('adds nothing for a command of %o', (command) => {
    commandLog.record(command, 'search');
    expect(get(commandLog)).toEqual([]);
    expect(get(lastCommand)).toBeNull();
  });

  it('moves a repeated command to the top instead of listing it twice', () => {
    commandLog.record('rx trace /logs --regexp=a', 'search');
    commandLog.record('rx trace /logs --regexp=b', 'search');
    commandLog.record('rx trace /logs --regexp=a', 'search');

    expect(get(commandLog).map((entry) => entry.command)).toEqual([
      'rx trace /logs --regexp=a',
      'rx trace /logs --regexp=b',
    ]);
  });

  it(`keeps the ${RECENT_COMMANDS_LIMIT} newest commands`, () => {
    for (let n = 1; n <= RECENT_COMMANDS_LIMIT + 5; n++) {
      commandLog.record(`rx samples /a.log --lines=${n}`, 'file');
    }

    const entries = get(commandLog);
    expect(entries).toHaveLength(RECENT_COMMANDS_LIMIT);
    expect(entries[0].command).toBe(`rx samples /a.log --lines=${RECENT_COMMANDS_LIMIT + 5}`);
  });
});

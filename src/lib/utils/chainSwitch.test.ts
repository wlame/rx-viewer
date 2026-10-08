import { describe, expect, it } from 'vitest';
import { chainDescription, chainPart, chainTabOf } from '../testing/chainDescription';
import type { ChainEntry, FileMatch } from '../types';
import {
  chainHolding,
  chainMatchesOfFile,
  fileMatchesOfPart,
  fileTargetOfChainTab,
  planChainMerges,
} from './chainSwitch';

function entry(name: string, parts: string[], dir = '/l'): ChainEntry {
  return {
    path: `${dir}/${name}`,
    name,
    parts,
    has_active: parts.includes(name),
    missing: [],
    missing_count: 0,
    size: 0,
    compression_formats: [],
    is_indexed: true,
    unreadable: [],
    too_many_parts: false,
  };
}

const APP = entry('app.log', ['app.log.2.gz', 'app.log.1', 'app.log']);
const SYS = entry('syslog', ['syslog.1', 'syslog']);

describe('chainHolding', () => {
  it('finds the chain whose parts name the file, the active file included', () => {
    expect(chainHolding([SYS, APP], 'app.log.1')).toBe(APP);
    expect(chainHolding([SYS, APP], 'app.log')).toBe(APP);
  });

  it('finds none for a file of no chain, such as another encoding of a part', () => {
    expect(chainHolding([SYS, APP], 'app.log.1.gz')).toBeNull();
    expect(chainHolding([], 'app.log')).toBeNull();
  });
});

describe('planChainMerges', () => {
  const listings = new Map([['/l', [APP, SYS]]]);

  it('turns the file tabs of one chain into one tab, at the active tab', () => {
    const tabs = ['/l/app.log.2.gz', '/l/notes.txt', '/l/app.log.1'];

    const merges = planChainMerges(tabs, listings, '/l/app.log.1');

    expect(merges).toEqual([
      {
        handle: '/l/app.log',
        lead: '/l/app.log.1',
        part: 'app.log.1',
        members: ['/l/app.log.2.gz', '/l/app.log.1'],
      },
    ]);
  });

  it('takes the first tab of a chain when the active tab is not one of its parts', () => {
    const tabs = ['/l/syslog', '/l/app.log', '/l/syslog.1'];

    const merges = planChainMerges(tabs, listings, '/l/app.log');

    expect(merges.map((m) => [m.handle, m.lead])).toEqual([
      ['/l/syslog', '/l/syslog'],
      ['/l/app.log', '/l/app.log'],
    ]);
  });

  it('leaves a file whose directory was not listed, and the chain tabs, alone', () => {
    const tabs = ['/other/app.log.1', 'chain:/l/app.log'];

    expect(planChainMerges(tabs, listings, null)).toEqual([]);
  });
});

describe('fileTargetOfChainTab', () => {
  it('is the part that holds the anchor line, at its line in that part', () => {
    const tab = {
      path: 'chain:/l/agent.log',
      chain: chainTabOf(chainDescription(), {
        anchor: { part: 'agent.log.1', line: 2, timeMs: null },
      }),
    };

    expect(fileTargetOfChainTab(tab)).toEqual({ path: '/l/agent.log.1', line: 2 });
  });

  it('is the first part with lines at line 1 for a tab with no anchor yet', () => {
    const description = chainDescription({
      parts: [chainPart('agent.log.2', { size: 0 }), chainPart('agent.log.1')],
    });
    const tab = { path: 'chain:/l/agent.log', chain: chainTabOf(description) };

    expect(fileTargetOfChainTab(tab)).toEqual({ path: '/l/agent.log.1', line: 1 });
  });

  it('is none for a tab that knows no part yet', () => {
    expect(fileTargetOfChainTab({ path: 'chain:/l/agent.log', chain: chainTabOf(null) })).toBe(
      null,
    );
  });
});

describe('the search marks of a converted tab', () => {
  const mark = (lineNumber: number, part?: string): FileMatch => ({
    lineNumber,
    patternId: 'p1',
    pattern: 'x',
    ...(part === undefined ? {} : { part }),
  });

  it("keeps a chain's marks of one part as that file's marks", () => {
    const marks = [mark(5, 'app.log.1'), mark(7, 'app.log'), mark(9, 'app.log.1')];

    expect(fileMatchesOfPart(marks, 'app.log.1')).toEqual([mark(5), mark(9)]);
  });

  it("keeps a file's marks as the chain's marks of that part", () => {
    expect(chainMatchesOfFile([mark(5)], 'app.log.1')).toEqual([mark(5, 'app.log.1')]);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { FakeChain, serveChain, type FakePart } from '../testing/fakeChain';
import type { OpenFile } from '../types';
import { chainKey } from '../utils/tabKey';
import { chainMode } from './chainMode';
import { switchChainMode } from './chainModeSwitch';
import { fileZones } from './fileZones';
import { files } from './files';
import { health } from './health';
import { notifications } from './notifications';
import { tree } from './tree';

/** Four parts: global 1-3000, 3001-5000, 5001-6500 (the third part), 6501-8500 the active file. */
const PARTS: FakePart[] = [
  { name: 'app.log.3.gz', lines: 3000, compression: 'gzip' },
  { name: 'app.log.2.gz', lines: 2000, compression: 'gzip' },
  { name: 'app.log.1', lines: 1500 },
  { name: 'app.log', lines: 2000, isActive: true },
];
const HANDLE = '/l/app.log';
const KEY = chainKey(HANDLE);

async function serve(options: Partial<ConstructorParameters<typeof FakeChain>[0]> = {}) {
  const chain = new FakeChain({ name: 'app.log', parts: PARTS, state: 'ready', ...options });
  serveChain(chain);
  await health.check();
  return chain;
}

function openTab(key: string): OpenFile {
  const found = get(files).openFiles.find((f) => f.path === key);
  if (!found) throw new Error(`${key} is not open`);
  return found;
}

/** The text and the time of the line the tab `key` is anchored on. */
function lineInView(key: string): { text: string | undefined; time: number | null | undefined } {
  const tab = openTab(key);
  const line = tab.lines[tab.anchorLine - tab.startLine];
  return { text: line?.content, time: line?.timestampMs };
}

async function settled(key: string): Promise<void> {
  await vi.waitFor(() => expect(openTab(key).loading).toBe(false));
}

afterEach(async () => {
  for (const file of get(files).openFiles) files.closeFile(file.path);
  for (const shown of get(notifications)) notifications.dismiss(shown.id);
  fileZones.clear(KEY);
  fileZones.clear('/l/app.log.1');
  chainMode.set(false);
  vi.unstubAllGlobals();
});

describe('switching chain mode off and on', () => {
  it('keeps the line in the middle of the third part in view each way, and selects the part', async () => {
    const chain = await serve();
    chainMode.set(true);
    await files.openChain(HANDLE, { position: { kind: 'local', part: 'app.log.1', line: 750 } });
    const before = lineInView(KEY);
    expect(before.text).toBe(chain.partLineText('app.log.1', 750));

    await switchChainMode(false);
    await settled('/l/app.log.1');

    expect(get(chainMode)).toBe(false);
    expect(get(files).openFiles.map((f) => f.path)).toEqual(['/l/app.log.1']);
    expect(openTab('/l/app.log.1').anchorLine).toBe(750);
    expect(lineInView('/l/app.log.1')).toEqual(before);
    await vi.waitFor(() => expect(get(tree).selectedPath).toBe('/l/app.log.1'));

    await switchChainMode(true);
    await settled(KEY);

    expect(get(chainMode)).toBe(true);
    expect(get(files).openFiles.map((f) => f.path)).toEqual([KEY]);
    expect(openTab(KEY).chain?.anchor).toMatchObject({ part: 'app.log.1', line: 750 });
    expect(openTab(KEY).anchorLine).toBe(5750);
    expect(lineInView(KEY)).toEqual(before);
  });

  it('turns a pending chain tab into its part at the same line, and back', async () => {
    const chain = await serve({ state: 'pending' });
    chainMode.set(true);
    await files.openChain(HANDLE, { position: { kind: 'local', part: 'app.log.2.gz', line: 40 } });
    const before = lineInView(KEY);
    expect(before.text).toBe(chain.partLineText('app.log.2.gz', 40));

    await switchChainMode(false);
    await settled('/l/app.log.2.gz');
    expect(lineInView('/l/app.log.2.gz')).toEqual(before);

    await switchChainMode(true);
    await settled(KEY);
    expect(openTab(KEY).chain?.numbering).toBe('local');
    expect(lineInView(KEY)).toEqual(before);
  });

  it("takes the chain tab's zone, highlighting, filter and marks of the part to the file tab", async () => {
    await serve({ features: ['log_chains', 'samples_index_build', 'file_tz'] });
    chainMode.set(true);
    fileZones.set(KEY, '+02:00', () => true);
    await files.openChain(HANDLE, { position: { kind: 'local', part: 'app.log.1', line: 750 } });
    files.setSyntaxHighlighting(KEY, false);
    files.setRegexFilter(KEY, { pattern: 'LINE 57', mode: 'highlight' });
    files.setMatches(KEY, [
      { lineNumber: 750, part: 'app.log.1', patternId: 'p1', pattern: 'x' },
      { lineNumber: 9, part: 'app.log', patternId: 'p1', pattern: 'x' },
    ]);

    await switchChainMode(false);

    const file = openTab('/l/app.log.1');
    expect(fileZones.zoneOf('/l/app.log.1')).toBe('+02:00');
    expect(file.syntaxHighlighting).toBe(false);
    expect(file.regexFilter?.pattern).toBe('LINE 57');
    expect(get(files).matches.get('/l/app.log.1')).toEqual([
      { lineNumber: 750, patternId: 'p1', pattern: 'x' },
    ]);
  });

  it('keeps the place of each tab in the row, and the active tab', async () => {
    await serve();
    chainMode.set(true);
    await files.openFile('/l/notes.txt');
    await files.openChain(HANDLE, { position: { kind: 'local', part: 'app.log.1', line: 750 } });
    await files.openFile('/l/other.txt');
    files.setActiveFile('/l/notes.txt');

    await switchChainMode(false);

    expect(get(files).openFiles.map((f) => f.path)).toEqual([
      '/l/notes.txt',
      '/l/app.log.1',
      '/l/other.txt',
    ]);
    expect(get(files).activeFilePath).toBe('/l/notes.txt');
  });
});

describe('switching chain mode on with file tabs of a chain open', () => {
  it("makes two parts' tabs one chain tab at the active tab's line, in the first one's place", async () => {
    const chain = await serve();
    await files.openFile('/l/app.log.3.gz', { scrollToLine: 10 });
    await files.openFile('/l/notes.txt');
    await files.openFile('/l/app.log.1', { scrollToLine: 20 });
    await settled('/l/app.log.1');
    const before = lineInView('/l/app.log.1');

    await switchChainMode(true);
    await settled(KEY);

    expect(get(files).openFiles.map((f) => f.path)).toEqual([KEY, '/l/notes.txt']);
    expect(get(files).activeFilePath).toBe(KEY);
    expect(openTab(KEY).chain?.anchor).toMatchObject({ part: 'app.log.1', line: 20 });
    expect(lineInView(KEY)).toEqual(before);
    expect(before.text).toBe(chain.partLineText('app.log.1', 20));
  });

  it("opens the chain tab at the first part's line when the active tab is another file", async () => {
    await serve();
    await files.openFile('/l/app.log.3.gz', { scrollToLine: 10 });
    await files.openFile('/l/app.log', { scrollToLine: 30 });
    await files.openFile('/l/notes.txt');

    await switchChainMode(true);
    await settled(KEY);

    expect(openTab(KEY).chain?.anchor).toMatchObject({ part: 'app.log.3.gz', line: 10 });
    expect(get(files).activeFilePath).toBe('/l/notes.txt');
  });

  it('keeps the file tabs of an invalid chain, and says why', async () => {
    const reasons = [
      { code: 'overlap' as const, parts: ['app.log.1', 'app.log'], message: 'x', overlap_ms: 5 },
    ];
    await serve({ state: 'invalid', reasons });
    await files.openFile('/l/app.log.1', { scrollToLine: 20 });

    await switchChainMode(true);

    expect(get(files).openFiles.map((f) => f.path)).toEqual(['/l/app.log.1']);
    expect(get(notifications).some((n) => n.message.includes('not a valid log chain'))).toBe(true);
  });

  it('leaves another encoding of a part, and files of no chain, as they are', async () => {
    await serve();
    await files.openFile('/l/app.log.1.gz');
    await files.openFile('/l/notes.txt');

    await switchChainMode(true);

    expect(get(files).openFiles.map((f) => f.path)).toEqual(['/l/app.log.1.gz', '/l/notes.txt']);
  });
});

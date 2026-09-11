import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { files } from './files';

/**
 * The URL names the open file so a link or a reload restores it. Once
 * the last file is closed the URL has to stop naming one, or a reload
 * reopens the file the user just closed.
 */
function setLocation(search: string) {
  vi.stubGlobal('window', {
    location: { href: `http://localhost:5173/${search}`, search },
    history: {
      replaceState: (_state: unknown, _title: string, next: string) => {
        const parsed = new URL(next);
        (window as unknown as { location: { href: string; search: string } }).location = {
          href: parsed.toString(),
          search: parsed.search,
        };
      },
    },
  });
}

describe('closing files', () => {
  beforeEach(() => {
    // The loads fail, which is enough: only opening and closing matter here.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: async () => '',
      }),
    );
  });

  afterEach(() => {
    for (const file of get(files).openFiles) files.closeFile(file.path);
    vi.unstubAllGlobals();
  });

  it('stops naming a file in the URL when the last one is closed', async () => {
    setLocation('?file=%2Fvar%2Flog%2Fa.log&line=5&highlight=1');
    await files.openFile('/var/log/a.log');

    files.closeFile('/var/log/a.log');

    const params = new URLSearchParams(window.location.search);
    expect(params.has('file')).toBe(false);
    expect(params.has('line')).toBe(false);
    expect(params.has('highlight')).toBe(false);
  });

  it('leaves the URL to the remaining file while one is still open', async () => {
    setLocation('?file=%2Fvar%2Flog%2Fb.log&line=5&highlight=0');
    await files.openFile('/var/log/a.log');
    await files.openFile('/var/log/b.log');

    files.closeFile('/var/log/a.log');

    expect(new URLSearchParams(window.location.search).get('file')).toBe('/var/log/b.log');
  });
});

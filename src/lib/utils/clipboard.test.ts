import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText } from './clipboard';

/**
 * `rx serve` is often reached over plain http on a trusted network,
 * where the browser offers no `navigator.clipboard`. Copying must work
 * there too.
 */
describe('copyText', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('writes through the Clipboard API where the page has it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    await expect(copyText('rx trace /logs --regexp=ERROR')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('rx trace /logs --regexp=ERROR');
  });

  function stubDocument(copied: boolean) {
    const field = { value: '', style: {}, setAttribute: vi.fn(), select: vi.fn(), remove: vi.fn() };
    const execCommand = vi.fn().mockReturnValue(copied);
    vi.stubGlobal('document', {
      createElement: () => field,
      body: { appendChild: vi.fn() },
      execCommand,
    });
    return { field, execCommand };
  }

  it('falls back to a selected text field without the Clipboard API', async () => {
    vi.stubGlobal('navigator', {});
    const { field, execCommand } = stubDocument(true);

    await expect(copyText('rx index /a.log')).resolves.toBe(true);
    expect(field.value).toBe('rx index /a.log');
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(field.remove).toHaveBeenCalled();
  });

  it('falls back when the Clipboard API refuses', async () => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    stubDocument(true);

    await expect(copyText('rx index /a.log')).resolves.toBe(true);
  });

  it('reports a copy neither way could make', async () => {
    vi.stubGlobal('navigator', {});
    stubDocument(false);

    await expect(copyText('rx index /a.log')).resolves.toBe(false);
  });
});

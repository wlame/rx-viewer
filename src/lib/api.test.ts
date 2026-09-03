import { describe, it, expect, vi, afterEach } from 'vitest';
import { api, ApiError } from './api';

/**
 * Every call goes through one fetch wrapper, so error mapping and URL
 * building are worth pinning once here rather than per endpoint. A path
 * that is not encoded is the interesting case: log paths routinely
 * contain spaces, plus signs and non-ASCII, and an unencoded one silently
 * reaches the wrong file.
 */
function stubFetch(response: Partial<Response> & { json?: () => Promise<unknown> }) {
  const spy = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({}),
    text: async () => '',
    ...response,
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

afterEach(() => vi.unstubAllGlobals());

describe('error mapping', () => {
  it('throws ApiError carrying the status and the body', async () => {
    stubFetch({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      text: async () => '{"detail":"Path outside search roots"}',
    });

    await expect(api.getHealth()).rejects.toBeInstanceOf(ApiError);
    await expect(api.getHealth()).rejects.toMatchObject({
      status: 403,
      statusText: 'Forbidden',
      message: '{"detail":"Path outside search roots"}',
    });
  });

  it.each([400, 404, 409, 500, 503])('treats %i as an error', async (status) => {
    stubFetch({ ok: false, status, statusText: 'x', text: async () => 'boom' });
    await expect(api.getHealth()).rejects.toBeInstanceOf(ApiError);
  });

  it('does not swallow a transport failure', async () => {
    const spy = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', spy);
    await expect(api.getHealth()).rejects.toThrow('Failed to fetch');
  });

  it('returns the parsed body on success', async () => {
    stubFetch({ json: async () => ({ status: 'ok' }) });
    await expect(api.getHealth()).resolves.toEqual({ status: 'ok' });
  });
});

describe('request shape', () => {
  it('sends a JSON content type', async () => {
    const spy = stubFetch({});
    await api.getHealth();
    expect(spy.mock.calls[0][1].headers).toMatchObject({
      'Content-Type': 'application/json',
    });
  });

  it('encodes a path that contains a space', async () => {
    const spy = stubFetch({});
    await api.getTree('/var/log/my logs');
    expect(spy.mock.calls[0][0]).toBe('/v1/tree?path=%2Fvar%2Flog%2Fmy%20logs');
  });

  it('encodes a path that contains a plus sign', async () => {
    const spy = stubFetch({});
    await api.getTree('/logs/a+b.log');
    expect(spy.mock.calls[0][0]).toContain('a%2Bb.log');
  });

  it('omits the path parameter entirely when none is given', async () => {
    const spy = stubFetch({});
    await api.getTree();
    expect(spy.mock.calls[0][0]).toBe('/v1/tree');
  });

  it('encodes the client id on the health check', async () => {
    const spy = stubFetch({});
    await api.getHealth('client/with slash');
    expect(spy.mock.calls[0][0]).toBe('/health?client=client%2Fwith%20slash');
  });

  it('calls /health outside the versioned prefix', async () => {
    const spy = stubFetch({});
    await api.getHealth();
    expect(spy.mock.calls[0][0]).toBe('/health');
  });

  it('calls the versioned prefix for everything else', async () => {
    const spy = stubFetch({});
    await api.getDetectors();
    expect(spy.mock.calls[0][0]).toBe('/v1/detectors');
  });

  it('passes a cancellation signal through to fetch', async () => {
    const spy = stubFetch({});
    const controller = new AbortController();
    await api.getSamples('/a.log', ['1-10'], undefined, { signal: controller.signal });
    expect(spy.mock.calls[0][1].signal).toBe(controller.signal);
  });

  it.each([
    ['getTree', (o: object) => api.getTree('/x', o)],
    ['getSamples', (o: object) => api.getSamples('/x', ['1-2'], undefined, o)],
    ['getSamplesByOffset', (o: object) => api.getSamplesByOffset('/x', [10], undefined, o)],
    [
      'trace',
      (o: object) => api.trace(['/x'], ['e'], undefined, undefined, undefined, undefined, o),
    ],
    ['getIndex', (o: object) => api.getIndex('/x', o)],
  ])('%s forwards the signal', async (_name, call) => {
    const spy = stubFetch({});
    const controller = new AbortController();
    await call({ signal: controller.signal });
    expect(spy.mock.calls[0][1].signal).toBe(controller.signal);
  });

  it('sends no signal when none is given', async () => {
    const spy = stubFetch({});
    await api.getSamples('/a.log', ['1-10']);
    expect(spy.mock.calls[0][1].signal).toBeUndefined();
  });

  it('never builds an absolute URL, so the CSP connect-src self holds', async () => {
    const spy = stubFetch({});
    await api.getTree('/x');
    expect(spy.mock.calls[0][0]).toMatch(/^\//);
  });
});

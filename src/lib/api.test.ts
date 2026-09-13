import { describe, it, expect, vi, afterEach } from 'vitest';
import { get } from 'svelte/store';
import { api, ApiError } from './api';
import { clearApiToken, setApiToken, tokenRequired } from './utils/apiToken';

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
      message: 'Path outside search roots',
      body: '{"detail":"Path outside search roots"}',
    });
  });

  // Both backends put the human-readable sentence in `detail` and wrap it
  // in an envelope that also carries `$schema`. Showing the envelope in a
  // toast puts JSON in front of the user instead of the reason.
  it('uses the detail field as the message, not the whole envelope', async () => {
    stubFetch({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      text: async () =>
        '{"$schema":"http://127.0.0.1:7788/schemas/ApiError.json","detail":"File size 510783 bytes is below threshold 52428800 bytes"}',
    });

    await expect(api.getHealth()).rejects.toMatchObject({
      message: 'File size 510783 bytes is below threshold 52428800 bytes',
    });
  });

  // A sandbox refusal puts a machine code in `detail` so clients can
  // branch on it. Showing that code to a person says nothing; the
  // structured fields say which path was refused and what would have
  // been accepted.
  it('turns a sandbox refusal into a sentence naming the path and the roots', async () => {
    stubFetch({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      text: async () =>
        JSON.stringify({
          detail: 'path_outside_search_root',
          error: 'path_outside_search_root',
          message: 'path "/outside/x.log" is not within any configured --search-root',
          path: '/outside/x.log',
          roots: ['/srv/data', '/var/log'],
        }),
    });

    await expect(api.getHealth()).rejects.toMatchObject({
      status: 403,
      message:
        '/outside/x.log is outside the search roots this server was started with. ' +
        'Allowed: /srv/data, /var/log',
    });
  });

  it('falls back to message when detail is absent', async () => {
    stubFetch({ ok: false, status: 500, statusText: 'x', text: async () => '{"message":"boom"}' });
    await expect(api.getHealth()).rejects.toMatchObject({ message: 'boom' });
  });

  it('keeps a non-JSON body verbatim', async () => {
    stubFetch({ ok: false, status: 502, statusText: 'x', text: async () => 'upstream is down' });
    await expect(api.getHealth()).rejects.toMatchObject({ message: 'upstream is down' });
  });

  it('falls back to the status text when the body carries no reason', async () => {
    stubFetch({ ok: false, status: 503, statusText: 'Service Unavailable', text: async () => '' });
    await expect(api.getHealth()).rejects.toMatchObject({ message: 'Service Unavailable' });
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
    ['trace', (o: object) => api.trace(['/x'], ['e'], {}, o)],
    ['getIndex', (o: object) => api.getIndex('/x', o)],
    ['getTaskStatus', (o: object) => api.getTaskStatus('t1', o)],
  ])('%s forwards the signal', async (_name, call) => {
    const spy = stubFetch({});
    const controller = new AbortController();
    await call({ signal: controller.signal });
    expect(spy.mock.calls[0][1].signal).toBe(controller.signal);
  });

  it('sends each matching flag that is on as a trace parameter', async () => {
    const spy = stubFetch({});
    await api.trace(['/a.log'], ['err'], {
      maxResults: 50,
      flags: { ignore_case: true, word_regexp: false, fixed_strings: true },
    });

    const query = new URL(spy.mock.calls[0][0], 'http://x').searchParams;
    expect(query.get('ignore_case')).toBe('true');
    expect(query.get('fixed_strings')).toBe('true');
    expect(query.has('word_regexp')).toBe(false);
    expect(query.get('max_results')).toBe('50');
  });

  // case_sensitive, context_before and context_after are not trace
  // parameters in the contract; a backend ignores them, so sending one
  // only suggests a setting that does nothing.
  it('sends only parameters the trace contract declares', async () => {
    const spy = stubFetch({});
    await api.trace(['/a.log'], ['err']);

    const query = new URL(spy.mock.calls[0][0], 'http://x').searchParams;
    expect([...new Set(query.keys())]).toEqual(['path', 'regexp']);
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

/**
 * A server started with RX_API_TOKEN refuses /v1 requests without
 * `Authorization: Bearer <token>`. The client sends the token the tab
 * holds on every request, and a refusal is what raises the prompt.
 */
describe('the API token', () => {
  afterEach(() => {
    clearApiToken();
    tokenRequired.set(false);
  });

  it('sends the token the tab holds', async () => {
    const spy = stubFetch({ json: async () => ({ detectors: [] }) });
    setApiToken('s3cret');

    await api.getDetectors();

    expect(spy.mock.calls[0][1].headers).toMatchObject({ Authorization: 'Bearer s3cret' });
  });

  it('sends no Authorization header without a token', async () => {
    const spy = stubFetch({ json: async () => ({ detectors: [] }) });

    await api.getDetectors();

    expect(spy.mock.calls[0][1].headers).not.toHaveProperty('Authorization');
  });

  it('raises the prompt when the server asks for a token', async () => {
    stubFetch({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => '{"detail":"an API token is required"}',
    });

    await expect(api.getDetectors()).rejects.toMatchObject({ status: 401 });
    expect(get(tokenRequired)).toBe(true);
  });

  it('leaves the prompt down for any other error', async () => {
    stubFetch({ ok: false, status: 403, statusText: 'Forbidden', text: async () => '' });

    await expect(api.getDetectors()).rejects.toMatchObject({ status: 403 });
    expect(get(tokenRequired)).toBe(false);
  });
});

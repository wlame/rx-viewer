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

describe('samples answers', () => {
  const task = {
    task_id: 't1',
    status: 'running',
    message: 'Building the line index',
    path: '/var/log/app.log',
    started_at: '2026-10-03T00:00:00.000000Z',
  };
  const samples = { path: '/var/log/app.log', samples: { '5': ['LINE 5'] } };

  it.each([
    ['lines', () => api.getSamples('/var/log/app.log', ['5'])],
    ['offsets', () => api.getSamplesByOffset('/var/log/app.log', [40])],
  ])('reads a 202 by %s as the index build it names', async (_mode, call) => {
    stubFetch({ status: 202, statusText: 'Accepted', json: async () => task });
    await expect(call()).resolves.toEqual({ kind: 'building', task });
  });

  it.each([
    [true, 'respond-async'],
    [false, undefined],
  ])('sends Prefer when respondAsync is %s', async (respondAsync, prefer) => {
    const spy = stubFetch({ json: async () => samples });
    await api.getSamples('/var/log/app.log', ['5'], undefined, { respondAsync });
    await api.getSamplesByOffset('/var/log/app.log', [40], undefined, { respondAsync });
    for (const call of spy.mock.calls) expect(call[1].headers.Prefer).toBe(prefer);
  });

  it('reads a 200 as the lines', async () => {
    stubFetch({ json: async () => samples });
    await expect(api.getSamples('/var/log/app.log', ['5'])).resolves.toEqual({
      kind: 'samples',
      samples,
    });
  });
});

/**
 * The log chain routes. A chain request expects three answers besides
 * 200, and each comes back as a value the stores branch on, never as a
 * thrown error: 202 names the index task a samples request waits for,
 * 409 carries the chain's current description (its files changed on
 * disk), and 422 says why a chain cannot be read as one text.
 */
describe('log chain routes', () => {
  const handle = '/var/log/app.log';
  const description = {
    path: handle,
    name: 'app.log',
    state: 'ready',
    reasons: [],
    fingerprint: '0123456789abcdef',
    parts: [],
    missing: [],
    missing_count: 0,
    gaps: [],
    first_ms: null,
    last_ms: null,
    frozen_line_count: null,
    line_count: null,
    index_build: null,
    cli_command: 'rx logs show /var/log/app.log',
  };
  const task = {
    task_id: 't1',
    status: 'running',
    message: 'Indexing 3 parts of the log chain /var/log/app.log',
    path: handle,
    started_at: '2026-10-08T00:00:00.000000Z',
  };
  const samples = { path: handle, name: 'app.log', state: 'ready', samples: {} };

  const queryOf = (spy: ReturnType<typeof stubFetch>) =>
    new URL(spy.mock.calls[0][0], 'http://x').searchParams;

  const conflict = () =>
    stubFetch({
      ok: false,
      status: 409,
      statusText: 'Conflict',
      text: async () => JSON.stringify(description),
    });

  describe('logChains', () => {
    it('lists the chains of a directory', async () => {
      const listing = { path: '/var/log', chains: [] };
      const spy = stubFetch({ json: async () => listing });

      await expect(api.logChains('/var/log')).resolves.toEqual(listing);
      expect(spy.mock.calls[0][0]).toBe('/v1/logs/chains?path=%2Fvar%2Flog');
    });

    it('throws a refusal as an ApiError', async () => {
      stubFetch({ ok: false, status: 403, statusText: 'Forbidden', text: async () => '' });
      await expect(api.logChains('/etc')).rejects.toMatchObject({ status: 403 });
    });
  });

  describe('logChain', () => {
    it('reads a 200 as the description', async () => {
      stubFetch({ json: async () => description });
      await expect(api.logChain(handle)).resolves.toEqual({ kind: 'chain', chain: description });
    });

    it('sends the zone and the fingerprint it is given, and nothing else', async () => {
      const spy = stubFetch({ json: async () => description });

      await api.logChain(handle, { fileTz: 'Europe/Berlin', fingerprint: '0123456789abcdef' });
      await api.logChain(handle);

      const query = queryOf(spy);
      expect(spy.mock.calls[0][0]).toMatch(/^\/v1\/logs\/chain\?/);
      expect(query.get('path')).toBe(handle);
      expect(query.get('file_tz')).toBe('Europe/Berlin');
      expect(query.get('fingerprint')).toBe('0123456789abcdef');
      const bare = new URL(spy.mock.calls[1][0], 'http://x').searchParams;
      expect([...bare.keys()]).toEqual(['path']);
    });

    it('reads a 409 as the changed chain with its current description', async () => {
      conflict();
      await expect(api.logChain(handle, { fingerprint: 'ffffffffffffffff' })).resolves.toEqual({
        kind: 'changed',
        chain: description,
      });
    });

    it('throws a 409 whose body is not a description', async () => {
      stubFetch({ ok: false, status: 409, statusText: 'Conflict', text: async () => 'busy' });
      await expect(api.logChain(handle)).rejects.toBeInstanceOf(ApiError);
    });

    it.each([404, 422, 500])('throws a %i as an ApiError', async (status) => {
      stubFetch({ ok: false, status, statusText: 'x', text: async () => '{"detail":"no"}' });
      await expect(api.logChain(handle)).rejects.toMatchObject({ status, message: 'no' });
    });
  });

  describe('logSamples', () => {
    it('sends global lines with their context', async () => {
      const spy = stubFetch({ json: async () => samples });

      await api.logSamples({ handle, lines: ['123456', '100-200'], context: 10 });

      const query = queryOf(spy);
      expect(spy.mock.calls[0][0]).toMatch(/^\/v1\/logs\/samples\?/);
      expect(query.get('path')).toBe(handle);
      expect(query.get('lines')).toBe('123456,100-200');
      expect(query.get('context')).toBe('10');
      expect(query.has('part')).toBe(false);
      expect(query.has('timestamps')).toBe(false);
    });

    it('sends a part with its own lines and the context on each side', async () => {
      const spy = stubFetch({ json: async () => samples });

      await api.logSamples(
        { handle, part: 'app.log.3.gz', lines: ['500'], beforeContext: 2, afterContext: 7 },
        { fingerprint: '0123456789abcdef' },
      );

      const query = queryOf(spy);
      expect(query.get('part')).toBe('app.log.3.gz');
      expect(query.get('lines')).toBe('500');
      expect(query.get('before_context')).toBe('2');
      expect(query.get('after_context')).toBe('7');
      expect(query.get('fingerprint')).toBe('0123456789abcdef');
      expect(query.has('context')).toBe(false);
    });

    it('repeats timestamps for each time and sends the zone', async () => {
      const spy = stubFetch({ json: async () => samples });

      await api.logSamples(
        { handle, timestamps: ['2026-10-03T14:00:00.000Z', '2026-10-03T14:00..2026-10-03T15:00'] },
        { fileTz: 'UTC' },
      );

      const query = queryOf(spy);
      expect(query.getAll('timestamps')).toEqual([
        '2026-10-03T14:00:00.000Z',
        '2026-10-03T14:00..2026-10-03T15:00',
      ]);
      expect(query.get('file_tz')).toBe('UTC');
      expect(query.has('lines')).toBe(false);
    });

    it.each([
      [true, 'respond-async'],
      [false, undefined],
    ])('sends Prefer when respondAsync is %s', async (respondAsync, prefer) => {
      const spy = stubFetch({ json: async () => samples });
      await api.logSamples({ handle, lines: ['1'] }, { respondAsync });
      expect(spy.mock.calls[0][1].headers.Prefer).toBe(prefer);
    });

    it('reads a 200 as the pieces', async () => {
      stubFetch({ json: async () => samples });
      await expect(api.logSamples({ handle, lines: ['1'] })).resolves.toEqual({
        kind: 'samples',
        samples,
      });
    });

    it('reads a 202 as the index task the request waits for', async () => {
      stubFetch({ status: 202, statusText: 'Accepted', json: async () => task });
      await expect(
        api.logSamples({ handle, lines: ['1'] }, { respondAsync: true }),
      ).resolves.toEqual({ kind: 'building', task });
    });

    it('reads a 409 as the changed chain', async () => {
      conflict();
      await expect(api.logSamples({ handle, lines: ['1'] })).resolves.toEqual({
        kind: 'changed',
        chain: description,
      });
    });

    it('reads a 422 as an invalid chain with its reasons', async () => {
      stubFetch({
        ok: false,
        status: 422,
        statusText: 'Unprocessable Entity',
        text: async () =>
          '{"$schema":"http://x/schemas/ApiError.json","detail":"log chain is invalid: overlap"}',
      });
      await expect(api.logSamples({ handle, lines: ['1'] })).resolves.toEqual({
        kind: 'invalid',
        detail: 'log chain is invalid: overlap',
      });
    });

    it.each([400, 404, 500])('throws a %i as an ApiError', async (status) => {
      stubFetch({ ok: false, status, statusText: 'x', text: async () => '{"detail":"no"}' });
      await expect(api.logSamples({ handle, lines: ['1'] })).rejects.toMatchObject({ status });
    });
  });

  describe('logTrace', () => {
    it('repeats path and regexp and sends the cap and the flags that are on', async () => {
      const spy = stubFetch({ json: async () => ({}) });

      await api.logTrace(['/var/log', handle], ['err', 'warn'], {
        maxResults: 100,
        flags: { ignore_case: true, pcre2: false },
      });

      const query = queryOf(spy);
      expect(spy.mock.calls[0][0]).toMatch(/^\/v1\/logs\/trace\?/);
      expect(query.getAll('path')).toEqual(['/var/log', handle]);
      expect(query.getAll('regexp')).toEqual(['err', 'warn']);
      expect(query.get('max_results')).toBe('100');
      expect(query.get('ignore_case')).toBe('true');
      expect(query.has('pcre2')).toBe(false);
    });

    // A 409 from a search carries no description (one search may reach
    // several chains): the request is sent again, as for any refusal.
    it('throws a 409 as an ApiError', async () => {
      stubFetch({
        ok: false,
        status: 409,
        statusText: 'Conflict',
        text: async () => '{"detail":"a part of a log chain changed while it was read"}',
      });
      await expect(api.logTrace([handle], ['err'])).rejects.toMatchObject({ status: 409 });
    });
  });

  describe('logIndex', () => {
    it('posts the handle in the query, with no body', async () => {
      const spy = stubFetch({ json: async () => task });

      await expect(api.logIndex(handle)).resolves.toEqual({ kind: 'task', task });

      const query = queryOf(spy);
      expect(spy.mock.calls[0][0]).toMatch(/^\/v1\/logs\/index\?/);
      expect(spy.mock.calls[0][1].method).toBe('POST');
      expect(spy.mock.calls[0][1].body).toBeUndefined();
      expect([...query.keys()]).toEqual(['path']);
      expect(query.get('path')).toBe(handle);
    });

    it('sends force and the fingerprint when given', async () => {
      const spy = stubFetch({ json: async () => task });

      await api.logIndex(handle, { force: true, fingerprint: '0123456789abcdef' });

      const query = queryOf(spy);
      expect(query.get('force')).toBe('true');
      expect(query.get('fingerprint')).toBe('0123456789abcdef');
    });

    it('reads a 409 as the changed chain', async () => {
      conflict();
      await expect(api.logIndex(handle, { fingerprint: 'ffffffffffffffff' })).resolves.toEqual({
        kind: 'changed',
        chain: description,
      });
    });
  });

  // Handles and part names are file names: spaces, brackets, `#`, `&`,
  // `%`, `+` and any script reach the backend exactly as written.
  it.each([
    ['/var/log/my app (1).log', 'my app (1).log.2.gz'],
    ['/srv/a#b&c%d+e.log', 'a#b&c%d+e.log.1'],
    ['/var/log/журнал.log', 'журнал.log.3.gz'],
  ])('sends the handle %s and the part %s as written', async (name, part) => {
    const spy = stubFetch({ json: async () => samples });

    await api.logSamples({ handle: name, part, lines: ['1'] });
    await api.logChain(name);
    await api.logIndex(name);
    await api.logChains(name);

    for (const call of spy.mock.calls) {
      const query = new URL(call[0], 'http://x').searchParams;
      expect(query.get('path')).toBe(name);
    }
    expect(queryOf(spy).get('part')).toBe(part);
  });

  it.each([
    ['logChains', (o: object) => api.logChains('/var/log', o)],
    ['logChain', (o: object) => api.logChain(handle, o)],
    ['logSamples', (o: object) => api.logSamples({ handle, lines: ['1'] }, o)],
    ['logTrace', (o: object) => api.logTrace([handle], ['e'], {}, o)],
    ['logIndex', (o: object) => api.logIndex(handle, o)],
  ])('%s forwards the signal', async (_name, call) => {
    const spy = stubFetch({ json: async () => description });
    const controller = new AbortController();
    await call({ signal: controller.signal });
    expect(spy.mock.calls[0][1].signal).toBe(controller.signal);
  });
});

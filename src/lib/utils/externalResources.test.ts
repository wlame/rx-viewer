import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * rx is pointed at private logs. A request to a third party on page load
 * tells that party the user's IP and the fact that they run rx, and a
 * compromised response would execute inside the rx origin. The app is
 * meant to be a standalone artifact, so nothing may be fetched from a
 * host other than the one serving it.
 */
describe('index.html', () => {
  const html = readFileSync(resolve(__dirname, '../../../index.html'), 'utf-8');

  it('loads no script or stylesheet from a remote host', () => {
    const remote = [...html.matchAll(/(?:src|href)\s*=\s*"([^"]+)"/g)]
      .map((m) => m[1])
      .filter((url) => /^(https?:)?\/\//.test(url));
    expect(remote).toEqual([]);
  });

  it('declares a content security policy that forbids remote script', () => {
    const csp = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/);
    expect(csp, 'index.html has no Content-Security-Policy meta tag').not.toBeNull();

    const directives = Object.fromEntries(
      csp![1]
        .split(';')
        .map((d) => d.trim())
        .filter(Boolean)
        .map((d) => {
          const [name, ...values] = d.split(/\s+/);
          return [name, values];
        }),
    );

    expect(directives['default-src']).toEqual(["'self'"]);
    // Monaco builds its own script text at runtime, so script-src cannot
    // be locked to 'self' alone — but it must not name a remote host.
    for (const [name, values] of Object.entries(directives)) {
      const hosts = (values as string[]).filter((v) => /^(https?:)?\/\//.test(v));
      expect(hosts, `${name} names a remote host`).toEqual([]);
    }
  });
});

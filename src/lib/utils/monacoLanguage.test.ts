import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { EXTENSION_LANGUAGES, FILENAME_LANGUAGES, detectMonacoLanguage } from './monacoLanguage';

// The log language registers itself with Monaco, which needs a browser;
// only its ID matters here.
vi.mock('./monacoLogLanguage', () => ({ LOG_LANGUAGE_ID: 'logfile' }));

/** Every language ID the bundled Monaco registers, read from its contribution files. */
function monacoLanguageIds(): Set<string> {
  const root = new URL('../../../node_modules/monaco-editor/esm/vs/', import.meta.url);
  const ids = new Set<string>();
  const contributionFiles = [
    ...readdirSync(new URL('basic-languages/', root)).map(
      (name) => new URL(`basic-languages/${name}/${name}.contribution.js`, root),
    ),
    ...readdirSync(new URL('language/', root)).map(
      (name) => new URL(`language/${name}/monaco.contribution.js`, root),
    ),
  ];
  for (const file of contributionFiles) {
    let source: string;
    try {
      source = readFileSync(file, 'utf8');
    } catch {
      continue; // a directory without a contribution file
    }
    for (const [, id] of source.matchAll(/\bid: "([^"]+)"/g)) ids.add(id);
  }
  return ids;
}

describe('detectMonacoLanguage', () => {
  // An ID Monaco does not know renders the file as plain text, without
  // even the log grammar a file of unknown type gets.
  it('maps only to languages Monaco registers', () => {
    const known = monacoLanguageIds();
    const mapped = new Set([
      ...Object.values(EXTENSION_LANGUAGES),
      ...Object.values(FILENAME_LANGUAGES),
    ]);
    expect([...mapped].filter((id) => !known.has(id))).toEqual([]);
  });

  it.each([
    ['app.py', 'python'],
    ['Dockerfile', 'dockerfile'],
    ['main.c', 'c'],
    ['app.log', 'logfile'],
    ['Makefile', 'logfile'],
  ])('reads %s as %s', (name, expected) => {
    expect(detectMonacoLanguage(name)).toBe(expected);
  });

  // A file name is outside text: a name every object has is no language.
  it.each([
    'constructor',
    '__proto__',
    'toString',
    'app.constructor',
    'app.__proto__',
    'x.valueOf',
  ])('reads %s as a log', (name) => {
    expect(detectMonacoLanguage(name)).toBe('logfile');
  });
});

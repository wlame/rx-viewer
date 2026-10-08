/**
 * Monaco language detection: file extensions and special file names to
 * the language IDs the bundled Monaco registers. A file that maps to no
 * language gets the log grammar.
 */

import { LOG_LANGUAGE_ID } from './monacoLogLanguage';

export const EXTENSION_LANGUAGES: Record<string, string> = {
  // JavaScript/TypeScript
  js: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  mjs: 'javascript',
  cjs: 'javascript',

  // Web
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  less: 'less',
  svg: 'xml',

  // Data formats
  json: 'json',
  jsonc: 'json',
  json5: 'json',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'ini',

  // Shell/Scripts
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  fish: 'shell',
  ps1: 'powershell',
  bat: 'bat',
  cmd: 'bat',

  // Programming languages
  py: 'python',
  python: 'python',
  rb: 'ruby',
  ruby: 'ruby',
  php: 'php',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  scala: 'scala',
  cs: 'csharp',
  fs: 'fsharp',
  vb: 'vb',
  swift: 'swift',
  m: 'objective-c',
  mm: 'objective-c',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  hxx: 'cpp',
  r: 'r',
  R: 'r',
  lua: 'lua',
  pl: 'perl',
  pm: 'perl',
  ex: 'elixir',
  exs: 'elixir',
  clj: 'clojure',
  cljs: 'clojure',
  dart: 'dart',

  // Query languages
  sql: 'sql',
  mysql: 'sql',
  pgsql: 'pgsql',
  graphql: 'graphql',
  gql: 'graphql',

  // Markup/Config
  md: 'markdown',
  markdown: 'markdown',
  rst: 'restructuredtext',
  dockerfile: 'dockerfile',
  ini: 'ini',
  conf: 'ini',
  cfg: 'ini',
  properties: 'ini',
};

// Special filenames that map to languages
export const FILENAME_LANGUAGES: Record<string, string> = {
  dockerfile: 'dockerfile',
  gemfile: 'ruby',
  rakefile: 'ruby',
  '.env': 'ini',
  '.envrc': 'shell',
};

/**
 * Detect Monaco language ID from filename. A file name is outside text,
 * so the tables are asked for their own keys only: a file named
 * `constructor` or `x.__proto__` names no language.
 */
export function detectMonacoLanguage(filename: string): string {
  const lowerName = filename.toLowerCase();

  // Check special filenames first
  const baseName = lowerName.split('/').pop() || lowerName;
  if (Object.hasOwn(FILENAME_LANGUAGES, baseName)) {
    return FILENAME_LANGUAGES[baseName];
  }

  // Check extension
  const ext = baseName.split('.').pop()?.toLowerCase();
  if (ext && Object.hasOwn(EXTENSION_LANGUAGES, ext)) {
    return EXTENSION_LANGUAGES[ext];
  }

  // Use custom log language as fallback for unknown file types
  // This provides useful highlighting for log files, txt files, and files without extensions
  return LOG_LANGUAGE_ID;
}

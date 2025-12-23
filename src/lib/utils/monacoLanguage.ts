/**
 * Monaco language detection utilities
 * Maps file extensions to Monaco language IDs
 */

const extensionToLanguage: Record<string, string> = {
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
  erl: 'erlang',
  hrl: 'erlang',
  clj: 'clojure',
  cljs: 'clojure',
  hs: 'haskell',
  lhs: 'haskell',
  dart: 'dart',
  groovy: 'groovy',
  gradle: 'groovy',

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
  tex: 'latex',
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  cmake: 'cmake',
  ini: 'ini',
  conf: 'ini',
  cfg: 'ini',
  properties: 'ini',

  // Other
  diff: 'diff',
  patch: 'diff',
  log: 'plaintext',
  txt: 'plaintext',
};

// Special filenames that map to languages
const filenameToLanguage: Record<string, string> = {
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  gemfile: 'ruby',
  rakefile: 'ruby',
  cmakelists: 'cmake',
  '.gitignore': 'ignore',
  '.dockerignore': 'ignore',
  '.env': 'dotenv',
  '.envrc': 'shell',
};

/**
 * Detect Monaco language ID from filename
 */
export function detectMonacoLanguage(filename: string): string {
  const lowerName = filename.toLowerCase();

  // Check special filenames first
  const baseName = lowerName.split('/').pop() || lowerName;
  if (filenameToLanguage[baseName]) {
    return filenameToLanguage[baseName];
  }

  // Check extension
  const ext = baseName.split('.').pop()?.toLowerCase();
  if (ext && extensionToLanguage[ext]) {
    return extensionToLanguage[ext];
  }

  return 'plaintext';
}

/**
 * Custom Monaco language definition for log files and unknown file types.
 * Provides syntax highlighting for common patterns found in logs:
 * - Datetimes in various formats
 * - IP addresses (v4, v6, with ports)
 * - Numbers
 * - Email addresses
 * - URLs (clickable)
 * - Text in brackets/parentheses
 * - JSON-like structures
 * - Log levels (ERROR, WARN, INFO, DEBUG, etc.)
 */

import * as monaco from 'monaco-editor';

export const LOG_LANGUAGE_ID = 'logfile';

// Register the language
export function registerLogLanguage() {
  // Check if already registered
  const languages = monaco.languages.getLanguages();
  if (languages.some(lang => lang.id === LOG_LANGUAGE_ID)) {
    return;
  }

  // Register the language
  monaco.languages.register({ id: LOG_LANGUAGE_ID });

  // Define tokenization rules using Monarch
  monaco.languages.setMonarchTokensProvider(LOG_LANGUAGE_ID, {
    defaultToken: '',
    ignoreCase: true,

    // Define token patterns
    tokenizer: {
      root: [
        // Log levels - must come early to catch them
        [/\b(FATAL|CRITICAL)\b/i, 'log-level-fatal'],
        [/\b(ERROR|ERR|SEVERE|FAIL(ED)?|EXCEPTION)\b/i, 'log-level-error'],
        [/\b(WARN(ING)?|ALERT)\b/i, 'log-level-warn'],
        [/\b(INFO(RMATION)?|NOTICE)\b/i, 'log-level-info'],
        [/\b(DEBUG|DBG|TRACE|VERBOSE)\b/i, 'log-level-debug'],

        // ISO 8601 datetime: 2024-01-15T10:30:45.123Z or 2024-01-15T10:30:45+00:00
        [/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:?\d{2})?/, 'datetime'],

        // Common datetime formats
        // 2024-01-15 10:30:45 or 2024/01/15 10:30:45
        [/\d{4}[-/]\d{2}[-/]\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?/, 'datetime'],

        // 15-Jan-2024 10:30:45 or 15/Jan/2024:10:30:45 (Apache format)
        [/\d{1,2}[-/][A-Za-z]{3}[-/]\d{4}[:\s]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?/, 'datetime'],

        // Jan 15 10:30:45 or Jan 15, 2024 10:30:45 (syslog format)
        [/[A-Za-z]{3}\s+\d{1,2}(?:,?\s+\d{4})?\s+\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?/, 'datetime'],

        // Time only: 10:30:45.123 or 10:30:45,123
        [/\b\d{2}:\d{2}:\d{2}(?:[.,]\d{1,6})?\b/, 'datetime'],

        // Unix timestamp (10 or 13 digits)
        [/\b1[4-9]\d{8,11}\b/, 'timestamp'],

        // URLs - must come before other patterns to capture full URLs
        [/https?:\/\/[^\s<>\[\]{}()'"]+/, 'url'],

        // Email addresses
        [/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/, 'email'],

        // IPv6 addresses (simplified pattern)
        [/\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b/, 'ip-address'],
        [/\b(?:[0-9a-fA-F]{1,4}:){1,7}:\b/, 'ip-address'],
        [/\b::(?:[0-9a-fA-F]{1,4}:){0,6}[0-9a-fA-F]{1,4}\b/, 'ip-address'],
        [/\b(?:[0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}\b/, 'ip-address'],

        // IPv4 addresses (with optional port)
        [/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?::\d{1,5})?\b/, 'ip-address'],

        // UUID
        [/\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/, 'uuid'],

        // Hex values (0x prefix or # color codes)
        [/\b0x[0-9a-fA-F]+\b/, 'number-hex'],
        [/#[0-9a-fA-F]{3,8}\b/, 'number-hex'],

        // File paths (Unix and Windows)
        [/(?:\/[\w.-]+)+\/?/, 'path'],
        [/[A-Za-z]:\\(?:[\w.-]+\\)*[\w.-]*/, 'path'],

        // JSON-like key-value structures: {key: value, key2: value2}
        [/\{[^{}]*\}/, 'json-structure'],

        // Quoted strings
        [/"[^"]*"/, 'string'],
        [/'[^']*'/, 'string'],
        [/`[^`]*`/, 'string'],

        // Brackets content - different colors for different bracket types
        [/\[[^\[\]]*\]/, 'bracket-square'],
        [/\([^()]*\)/, 'bracket-round'],
        [/<[^<>]+>/, 'bracket-angle'],

        // Numbers (integers and floats, including negative and scientific notation)
        [/[+-]?\b\d+\.?\d*(?:[eE][+-]?\d+)?\b/, 'number'],

        // Common key=value patterns
        [/\b[a-zA-Z_][a-zA-Z0-9_]*(?==)/, 'key'],
        [/(?<==)[^\s,;\]})]+/, 'value'],

        // HTTP methods
        [/\b(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS|CONNECT|TRACE)\b/, 'http-method'],

        // HTTP status codes
        [/\b[1-5]\d{2}\b/, 'http-status'],

        // Common keywords
        [/\b(true|false|null|nil|none|undefined)\b/i, 'keyword'],
        [/\b(success|ok|done|complete[d]?|pass(ed)?)\b/i, 'keyword-success'],
        [/\b(pending|waiting|queued|processing|running)\b/i, 'keyword-pending'],

        // Catch remaining text
        [/\S+/, ''],
      ],
    },
  });

  // Define theme rules for the custom tokens
  defineLogThemeRules();
}

// Define theme rules for both light and dark themes
function defineLogThemeRules() {
  // We'll define custom CSS classes that work with both themes
  // The actual colors are set via Monaco's theme system
}

// Get the token colors for the log language (used in theme definition)
export function getLogLanguageThemeRules(): monaco.editor.ITokenThemeRule[] {
  return [
    // Log levels
    { token: 'log-level-fatal', foreground: 'dc2626', fontStyle: 'bold' },  // red-600
    { token: 'log-level-error', foreground: 'ef4444', fontStyle: 'bold' },  // red-500
    { token: 'log-level-warn', foreground: 'f59e0b', fontStyle: 'bold' },   // amber-500
    { token: 'log-level-info', foreground: '3b82f6' },                       // blue-500
    { token: 'log-level-debug', foreground: '6b7280' },                      // gray-500

    // Datetime and timestamps
    { token: 'datetime', foreground: '059669' },      // emerald-600
    { token: 'timestamp', foreground: '059669' },     // emerald-600

    // Network-related
    { token: 'url', foreground: '2563eb', fontStyle: 'underline' },  // blue-600
    { token: 'email', foreground: '7c3aed' },         // violet-600
    { token: 'ip-address', foreground: '0891b2' },    // cyan-600

    // Identifiers
    { token: 'uuid', foreground: '9333ea' },          // purple-600
    { token: 'path', foreground: '0d9488' },          // teal-600

    // Numbers
    { token: 'number', foreground: 'd97706' },        // amber-600
    { token: 'number-hex', foreground: 'ea580c' },    // orange-600

    // Strings and structures
    { token: 'string', foreground: '16a34a' },        // green-600
    { token: 'json-structure', foreground: '4f46e5' }, // indigo-600

    // Brackets
    { token: 'bracket-square', foreground: '0284c7' }, // sky-600
    { token: 'bracket-round', foreground: '7c3aed' },  // violet-600
    { token: 'bracket-angle', foreground: 'db2777' },  // pink-600

    // Key-value
    { token: 'key', foreground: '0891b2' },           // cyan-600
    { token: 'value', foreground: '65a30d' },         // lime-600

    // HTTP
    { token: 'http-method', foreground: '9333ea', fontStyle: 'bold' },  // purple-600
    { token: 'http-status', foreground: 'd97706' },   // amber-600

    // Keywords
    { token: 'keyword', foreground: '6366f1' },        // indigo-500
    { token: 'keyword-success', foreground: '22c55e' }, // green-500
    { token: 'keyword-pending', foreground: 'eab308' }, // yellow-500
  ];
}

// Dark theme rules (brighter colors for dark backgrounds)
export function getLogLanguageThemeRulesDark(): monaco.editor.ITokenThemeRule[] {
  return [
    // Log levels
    { token: 'log-level-fatal', foreground: 'fca5a5', fontStyle: 'bold' },  // red-300
    { token: 'log-level-error', foreground: 'f87171', fontStyle: 'bold' },  // red-400
    { token: 'log-level-warn', foreground: 'fbbf24', fontStyle: 'bold' },   // amber-400
    { token: 'log-level-info', foreground: '60a5fa' },                       // blue-400
    { token: 'log-level-debug', foreground: '9ca3af' },                      // gray-400

    // Datetime and timestamps
    { token: 'datetime', foreground: '34d399' },      // emerald-400
    { token: 'timestamp', foreground: '34d399' },     // emerald-400

    // Network-related
    { token: 'url', foreground: '60a5fa', fontStyle: 'underline' },  // blue-400
    { token: 'email', foreground: 'a78bfa' },         // violet-400
    { token: 'ip-address', foreground: '22d3ee' },    // cyan-400

    // Identifiers
    { token: 'uuid', foreground: 'c084fc' },          // purple-400
    { token: 'path', foreground: '2dd4bf' },          // teal-400

    // Numbers
    { token: 'number', foreground: 'fbbf24' },        // amber-400
    { token: 'number-hex', foreground: 'fb923c' },    // orange-400

    // Strings and structures
    { token: 'string', foreground: '4ade80' },        // green-400
    { token: 'json-structure', foreground: '818cf8' }, // indigo-400

    // Brackets
    { token: 'bracket-square', foreground: '38bdf8' }, // sky-400
    { token: 'bracket-round', foreground: 'a78bfa' },  // violet-400
    { token: 'bracket-angle', foreground: 'f472b6' },  // pink-400

    // Key-value
    { token: 'key', foreground: '22d3ee' },           // cyan-400
    { token: 'value', foreground: 'a3e635' },         // lime-400

    // HTTP
    { token: 'http-method', foreground: 'c084fc', fontStyle: 'bold' },  // purple-400
    { token: 'http-status', foreground: 'fbbf24' },   // amber-400

    // Keywords
    { token: 'keyword', foreground: 'a5b4fc' },        // indigo-300
    { token: 'keyword-success', foreground: '4ade80' }, // green-400
    { token: 'keyword-pending', foreground: 'facc15' }, // yellow-400
  ];
}

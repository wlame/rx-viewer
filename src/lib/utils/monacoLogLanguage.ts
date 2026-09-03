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

import { logLanguageTokenizer } from './logGrammar';

// Re-exported so callers keep one import for the language.
export {
  logLanguageTokenizer,
  getLogLanguageThemeRules,
  getLogLanguageThemeRulesDark,
} from './logGrammar';

export const LOG_LANGUAGE_ID = 'logfile';

// Register the language
export function registerLogLanguage() {
  // Check if already registered
  const languages = monaco.languages.getLanguages();
  if (languages.some((lang) => lang.id === LOG_LANGUAGE_ID)) {
    return;
  }

  // Register the language
  monaco.languages.register({ id: LOG_LANGUAGE_ID });

  // Set language configuration for bracket colorization
  monaco.languages.setLanguageConfiguration(LOG_LANGUAGE_ID, {
    brackets: [
      ['[', ']'],
      ['(', ')'],
      ['{', '}'],
      ['<', '>'],
    ],
    colorizedBracketPairs: [
      ['[', ']'],
      ['(', ')'],
      ['{', '}'],
      ['<', '>'],
    ],
    autoClosingPairs: [
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '{', close: '}' },
      { open: '<', close: '>' },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
    ],
  });

  // Define tokenization rules using Monarch
  monaco.languages.setMonarchTokensProvider(LOG_LANGUAGE_ID, logLanguageTokenizer);

  // Define theme rules for the custom tokens
  defineLogThemeRules();
}

// Define theme rules for both light and dark themes
function defineLogThemeRules() {
  // We'll define custom CSS classes that work with both themes
  // The actual colors are set via Monaco's theme system
}

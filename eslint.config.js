// Flat config. Kept deliberately small: svelte-check already covers types,
// so ESLint is here for the correctness rules a type checker does not have.
import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default [
  { ignores: ['dist/**', 'node_modules/**', '*.config.js'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...svelte.configs['flat/recommended'],
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      // The codebase uses `any` in a few places where the wire shape is
      // genuinely dynamic; svelte-check is the gate for types.
      '@typescript-eslint/no-explicit-any': 'off',
      // Unused arguments prefixed with _ are deliberate, and `catch (e)`
      // without using e is idiomatic when the point is only to not throw.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      // These three flag patterns spread through the existing components
      // rather than anything new. They stay visible as warnings until that
      // code is cleaned up, and become errors then.
      'svelte/require-each-key': 'warn',
      'svelte/no-dom-manipulating': 'warn',
      'svelte/infinite-reactive-loop': 'warn',
    },
  },
  {
    files: ['**/*.svelte'],
    languageOptions: {
      parserOptions: { parser: tseslint.parser },
    },
  },
];

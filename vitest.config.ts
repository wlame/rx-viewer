import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'node:path';

export default defineConfig({
  plugins: [svelte({ hot: false })],
  resolve: {
    alias: {
      // Mirrors the $lib alias the app and tsconfig use.
      $lib: path.resolve(__dirname, 'src/lib'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
  },
});

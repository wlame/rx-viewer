import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'path';

export default defineConfig({
  plugins: [
    svelte({
      onwarn: (warning, handler) => {
        // Suppress accessibility warnings during build
        if (warning.code.startsWith('a11y-')) return;
        // Suppress unused export warnings
        if (warning.code === 'unused-export-let') return;
        handler(warning);
      },
    }),
  ],
  resolve: {
    alias: {
      $lib: resolve(__dirname, 'src/lib'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          // Split Monaco into its own chunk
          'monaco-editor': ['monaco-editor'],
        },
      },
    },
  },
  optimizeDeps: {
    include: ['monaco-editor'],
  },
  server: {
    proxy: {
      '/v1': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
});

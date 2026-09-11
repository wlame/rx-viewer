import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'path';

// The release stamps the tag through this env var; a local build says "dev".
const viewerVersion = process.env.RX_VIEWER_VERSION || 'dev';

// Where the dev server sends /v1. Inside a container the backend on the
// host is not localhost, so `just dev` sets this to host.docker.internal.
const devProxyTarget = process.env.RX_DEV_PROXY_TARGET || 'http://localhost:8080';

export default defineConfig({
  define: {
    __RX_VIEWER_VERSION__: JSON.stringify(viewerVersion),
  },
  plugins: [svelte()],
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
        target: devProxyTarget,
        changeOrigin: true,
      },
    },
  },
});

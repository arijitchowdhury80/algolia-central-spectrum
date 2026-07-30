/// <reference types="node" />
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Standalone library build for @algolia-central/chat-central.
 *
 * Emits an ESM bundle of the custom InstantSearch widget plumbing with
 * `react`, `react-dom`, and `instantsearch.js` left external (they are peer
 * dependencies supplied by the consumer). The primary consumption path is as
 * source (the `<algolia-chat>` web component aliases this package to
 * `src/index.ts` and bundles it), so this build exists mainly for standalone
 * publishing / verification.
 */
export default defineConfig({
  plugins: [react()],
  build: {
    lib: {
      entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      name: 'AlgoliaChatCentral',
      formats: ['es'],
      fileName: () => 'index.js',
    },
    rollupOptions: {
      external: ['react', 'react-dom', 'react-dom/client', 'instantsearch.js'],
    },
    outDir: 'dist',
    emptyOutDir: true,
  },
});

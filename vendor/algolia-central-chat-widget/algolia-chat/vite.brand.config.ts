/// <reference types="node" />
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

/**
 * Standalone build for <algolia-central-brand>.
 *
 * Emits dist/algolia-central-brand.js — a self-contained IIFE (no React,
 * no external deps) that registers the custom element when loaded as a plain
 * <script> tag. CSS is inlined into the JS via the `?inline` import in
 * BrandElement.ts, so no separate stylesheet is emitted.
 *
 * `emptyOutDir: false` so running this build after the main widget build
 * (vite build) does not wipe dist/algolia-central-chat.js.
 */
export default defineConfig({
  build: {
    lib: {
      entry: fileURLToPath(new URL('./src/brand-embed.ts', import.meta.url)),
      name: 'AlgoliaBrand',
      formats: ['iife'],
      fileName: () => 'algolia-brand.js',
    },
    cssCodeSplit: false,
    outDir: 'dist',
    emptyOutDir: false,
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
    },
  },
});

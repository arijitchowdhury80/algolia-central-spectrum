/// <reference types="node" />
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

/**
 * Standalone build for <algolia-confidence-badge>.
 *
 * Emits dist/algolia-confidence-badge.js — a self-contained IIFE (no React,
 * no external deps) that registers the custom element when loaded as a plain
 * <script> tag. CSS is inlined into the JS via the `?inline` import in
 * ConfidenceChipElement.ts, so no separate stylesheet is emitted.
 *
 * `emptyOutDir: false` so running this build after the main widget build
 * (vite build) does not wipe dist/algolia-chat.js.
 */
export default defineConfig({
  build: {
    lib: {
      entry: fileURLToPath(new URL('./src/confidence-badge-embed.ts', import.meta.url)),
      name: 'AlgoliaConfidenceBadge',
      formats: ['iife'],
      fileName: () => 'algolia-confidence-badge.js',
    },
    cssCodeSplit: false,
    outDir: 'dist',
    emptyOutDir: false,
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
    },
  },
});

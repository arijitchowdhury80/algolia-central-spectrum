/// <reference types="node" />
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The widget ships as ONE self-contained IIFE bundle that registers the
// <algolia-central-chat> custom element. All CSS is injected into the element's
// Shadow DOM at runtime (imported via `?inline` in embed.tsx), so the library
// build emits no separate stylesheet — everything is in the single JS file.
export default defineConfig(({ command }) => ({
  plugins: [react()],
  resolve: {
    alias: {
      // The full widget engine lives in the sibling chat-central package and is
      // consumed as source so it is bundled (and type-checked) as first-party
      // code here. chat-central's judge/engine files use relative imports
      // internally — no @confidence-engine alias needed here.
      '@algolia-central/chat-central': fileURLToPath(
        new URL('../chat-central/src/index.ts', import.meta.url),
      ),
    },
    // Guarantee a single React copy across this package + chat-central's source.
    dedupe: ['react', 'react-dom'],
  },
  // React reads process.env.NODE_ENV; an IIFE library bundle has no bundler
  // define for it unless we add one.
  ...(command === 'build'
    ? { define: { 'process.env.NODE_ENV': JSON.stringify('production') } }
    : {}),
  build: {
    lib: {
      entry: fileURLToPath(new URL('./src/chat-embed.tsx', import.meta.url)),
      name: 'AlgoliaChat',
      formats: ['iife'],
      fileName: () => 'algolia-chat.js',
    },
    cssCodeSplit: false,
    outDir: 'dist',
    emptyOutDir: true,
  },
}));

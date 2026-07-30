import { defineConfig } from 'vite';

/** Single self-contained IIFE, mirroring how the vendored widget ships its own
 *  bundles — the host page loads it with a plain <script> tag, no modules. */
export default defineConfig({
  build: {
    lib: { entry: 'src/main.ts', name: 'ACSEnhance', formats: ['iife'], fileName: () => 'acs-enhance.js' },
    outDir: 'dist',
    emptyOutDir: true,
    minify: 'esbuild',
  },
});

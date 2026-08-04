import { defineConfig } from 'vite';
import { resolve } from 'path';

// Static site — no source transforms needed.
// The widget is a precompiled IIFE loaded via a plain <script> tag.
export default defineConfig({
  root: 'public',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'public/index.html'),
        demoIndex: resolve(__dirname, 'public/demo/index.html'),
        demoButton: resolve(__dirname, 'public/demo/button.html'),
        demoCombobox: resolve(__dirname, 'public/demo/combobox.html'),
        demoMigration: resolve(__dirname, 'public/demo/migration.html'),
        demoGetStarted: resolve(__dirname, 'public/demo/get-started.html'),
      },
    },
  },
  server: {
    port: 5174,
  },
});

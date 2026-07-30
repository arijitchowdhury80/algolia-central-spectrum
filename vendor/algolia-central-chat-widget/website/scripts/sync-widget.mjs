/**
 * sync-widget.mjs
 *
 * Copies the compiled widget bundles from the @algolia-central/chat-widget
 * package (resolved via node_modules) into public/widget-bundles/ so the
 * static site can load them with a plain <script> tag. Also copies brand
 * SVG assets into public/brand/.
 *
 * Run automatically via the predev / prebuild npm lifecycle scripts.
 * Can also be run manually: node scripts/sync-widget.mjs
 */

import { copyFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Resolve the widget package root through node_modules (avoids require.resolve
// limitations with strict exports maps).
const widgetRoot = fileURLToPath(
  new URL('../node_modules/@algolia-central/chat-widget', import.meta.url),
);
const widgetDist = join(widgetRoot, 'dist');

const websiteRoot = join(__dirname, '..');
const bundlesDir = join(websiteRoot, 'public', 'widget-bundles');
const brandDir = join(websiteRoot, 'public', 'brand');

mkdirSync(bundlesDir, { recursive: true });
mkdirSync(brandDir, { recursive: true });

// --- Copy all *.js bundles from algolia-chat/dist/ into public/widget-bundles/ ---
let copiedBundles = 0;
for (const file of readdirSync(widgetDist)) {
  const src = join(widgetDist, file);
  if (statSync(src).isFile() && file.endsWith('.js')) {
    copyFileSync(src, join(bundlesDir, file));
    console.log(`  [sync] widget-bundles/${file}`);
    copiedBundles++;
  }
}

if (copiedBundles === 0) {
  console.warn(
      '\n[sync-widget] WARNING: No *.js files found in algolia-chat/dist/.\n' +
      '  Build the widget first: cd ../algolia-chat && npm run build\n',
  );
}

// --- Copy brand SVG assets from algolia-chat/public/brand/ into public/brand/ ---
const widgetBrand = join(widgetRoot, 'public', 'brand');
let copiedBrand = 0;
try {
  for (const file of readdirSync(widgetBrand)) {
    const src = join(widgetBrand, file);
    if (statSync(src).isFile()) {
      copyFileSync(src, join(brandDir, file));
      console.log(`  [sync] brand/${file}`);
      copiedBrand++;
    }
  }
} catch {
  // algolia-chat/public/brand may not exist in all configurations — not fatal.
}

console.log(`\n[sync-widget] Done. ${copiedBundles} bundle(s), ${copiedBrand} brand asset(s) synced.\n`);

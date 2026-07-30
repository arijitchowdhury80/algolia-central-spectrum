/**
 * watch.mjs — root dev orchestrator (single command)
 *
 * 1. Runs a full initial build of all three widget bundles (widget + confidence-badge +
 *    brand) so every vendor asset is present before the website starts.
 * 2. Syncs the fresh bundles into website/public/widget-bundles/.
 * 3. Starts Vite in library watch mode for the main widget bundle so any
 *    change to algolia-chat/src/ (or chat-central/src/) triggers a fast
 *    incremental rebuild; each rebuild re-syncs into the website.
 * 4. Starts the website Vite dev server.
 *
 * One command runs the whole loop — edit widget/web-component source and the
 * website picks up the rebuilt bundle:
 *   node watch.mjs      (or: npm run dev)
 *
 * Ctrl-C stops the widget watcher and the website dev server together.
 */

import { spawn, spawnSync } from 'node:child_process';
import { watch } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
// The <algolia-chat> web component package. It bundles the sibling
// chat-central custom-widget package from source, so Vite's watch mode picks
// up chat-central/src changes automatically.
const widgetDir = join(root, 'algolia-chat');
const widgetDist = join(widgetDir, 'dist');
const websiteDir = join(root, 'website');
const syncScript = join(websiteDir, 'scripts', 'sync-widget.mjs');

// npm is invoked as npm.cmd on Windows.
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(msg) {
  const time = new Date().toLocaleTimeString('en-US', { hour12: false });
  console.log(`[${time}] ${msg}`);
}

/** Debounce: wait `ms` after the last call before executing `fn`. */
function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// Shared env for all child processes — never override NODE_ENV so Vite keeps
// its production defaults (prevents the jsxDEV / dev-runtime mismatch).
const childEnv = { ...process.env };
delete childEnv.NODE_ENV;

// ---------------------------------------------------------------------------
// Step 1: full initial build (widget + confidence-badge + brand)
// ---------------------------------------------------------------------------

log('Running full initial build (widget + confidence-badge + brand) …');

const fullBuild = spawnSync(
  'node',
  ['node_modules/.bin/vite', 'build', '--config', 'vite.config.ts'],
  { cwd: widgetDir, stdio: 'inherit', env: childEnv },
);

if (fullBuild.status !== 0) {
  console.error('[watch] Full widget build failed. Aborting.');
  process.exit(fullBuild.status ?? 1);
}

const confidenceBadgeBuild = spawnSync(
  'node',
  ['node_modules/.bin/vite', 'build', '--config', 'vite.confidence-badge.config.ts'],
  { cwd: widgetDir, stdio: 'inherit', env: childEnv },
);

if (confidenceBadgeBuild.status !== 0) {
  console.error('[watch] Confidence badge build failed. Aborting.');
  process.exit(confidenceBadgeBuild.status ?? 1);
}

const brandBuild = spawnSync(
  'node',
  ['node_modules/.bin/vite', 'build', '--config', 'vite.brand.config.ts'],
  { cwd: widgetDir, stdio: 'inherit', env: childEnv },
);

if (brandBuild.status !== 0) {
  console.error('[watch] Brand build failed. Aborting.');
  process.exit(brandBuild.status ?? 1);
}

log('Initial build complete. Syncing to website …');
const initialSync = spawnSync('node', [syncScript], { stdio: 'inherit' });
if (initialSync.status !== 0) {
  console.error('[watch] Initial sync failed. Aborting.');
  process.exit(initialSync.status ?? 1);
}

// ---------------------------------------------------------------------------
// Sync: copy rebuilt bundles into website/public/widget-bundles/
// ---------------------------------------------------------------------------

let syncing = false;

function syncWidget() {
  if (syncing) return;
  syncing = true;
  log('Syncing widget bundles → website/public/widget-bundles/ …');

  const proc = spawn('node', [syncScript], { stdio: 'inherit', env: childEnv });
  proc.on('close', (code) => {
    syncing = false;
    if (code === 0) {
      log('Sync complete. Reload the website to pick up changes.');
    } else {
      log(`Sync exited with code ${code}.`);
    }
  });
}

const debouncedSync = debounce(syncWidget, 300);

// ---------------------------------------------------------------------------
// Watch algolia-chat/dist/ — sync whenever Vite writes a new bundle
// ---------------------------------------------------------------------------

watch(widgetDist, { recursive: true }, (eventType, filename) => {
  if (filename && filename.endsWith('.js')) {
    debouncedSync();
  }
});
log(`Watching ${widgetDist} for bundle changes …`);
log('');

// ---------------------------------------------------------------------------
// Step 2: Vite watch mode for the main widget bundle (fast incremental rebuilds)
// ---------------------------------------------------------------------------

log('Starting Vite widget watch mode …');

const viteWatch = spawn(
  'node',
  ['node_modules/.bin/vite', 'build', '--watch', '--config', 'vite.config.ts'],
  { cwd: widgetDir, stdio: 'inherit', env: childEnv },
);

viteWatch.on('error', (err) => {
  console.error('[watch] Failed to start Vite widget watch:', err.message);
  console.error('        Make sure you ran `npm install` inside algolia-chat/ first.');
  shutdown(1);
});

// ---------------------------------------------------------------------------
// Step 3: website dev server (Vite static site)
// ---------------------------------------------------------------------------

log('Starting website dev server …');

const websiteDev = spawn(npmCmd, ['run', 'dev'], {
  cwd: websiteDir,
  stdio: 'inherit',
  env: childEnv,
});

websiteDev.on('error', (err) => {
  console.error('[watch] Failed to start website dev server:', err.message);
  console.error('        Make sure you ran `npm install` inside website/ first.');
  shutdown(1);
});

// ---------------------------------------------------------------------------
// Lifecycle: when either child exits, tear the other down so one Ctrl-C (or a
// crash) never leaves an orphaned process behind.
// ---------------------------------------------------------------------------

let shuttingDown = false;

/** Kill both children and exit. Safe to call more than once. */
function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  log('Shutting down …');
  viteWatch.kill('SIGTERM');
  websiteDev.kill('SIGTERM');
  process.exit(code ?? 0);
}

viteWatch.on('close', (code) => {
  log(`Vite widget watch exited (code ${code}).`);
  shutdown(code ?? 0);
});

websiteDev.on('close', (code) => {
  log(`Website dev server exited (code ${code}).`);
  shutdown(code ?? 0);
});

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

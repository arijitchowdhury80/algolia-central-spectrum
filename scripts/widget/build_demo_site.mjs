#!/usr/bin/env node
/**
 * build_demo_site — assemble the deployable Adobe demo site from the vendored
 * widget, WITHOUT editing a single vendored file.
 *
 * WHY THIS EXISTS
 * ---------------
 * `vendor/algolia-central-chat-widget` is read-only (see vendor/README.md), but
 * two things must change for it to ship:
 *
 *   1. THEIR STATIC BUILD IS BROKEN FOR DEPLOYMENT. website/vite.config.ts sets
 *      root:'public' with outDir:'../dist', so public/widget-bundles/*.js — the
 *      widget itself — is never copied into dist/. Verified on disk: their dist/
 *      contains only index.html + assets/. A static deploy 404s every widget
 *      script. Their dev server works only because it serves public/ directly.
 *
 *   2. WE NEED HOST-PAGE CONFIG + FIXES THEY HAVEN'T SHIPPED YET (panel size
 *      mode, streaming-scroll jitter). Those belong to the embedding page, not
 *      the library.
 *
 * So this script COPIES their site into a build directory and injects our own
 * enhancement script during the copy. Their tree is never written to. Everything
 * we add lives in `web-widget/` and is ours to maintain.
 *
 * Run `npm run build` in vendor/.../algolia-chat first so the bundles exist.
 *
 *   node scripts/widget/build_demo_site.mjs [--out dist-widget]
 */
import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const VENDOR = join(ROOT, 'vendor/algolia-central-chat-widget');
const SITE_SRC = join(VENDOR, 'website/public');
const BUNDLES_SRC = join(VENDOR, 'algolia-chat/dist');

const outArg = process.argv.indexOf('--out');
const outRaw = outArg !== -1 ? process.argv[outArg + 1] : 'dist-widget';
// `join(ROOT, '/tmp/x')` silently yields `<repo>/tmp/x`, so an absolute --out
// meant for a scratch dir landed inside the repo instead. Respect it when it is
// already absolute; only relative paths are resolved against the repo root.
const OUT = isAbsolute(outRaw) ? outRaw : join(ROOT, outRaw);

const fail = (m) => { console.error(`build_demo_site: ${m}`); process.exit(1); };

if (!existsSync(SITE_SRC)) fail(`vendored site not found at ${SITE_SRC}`);
if (!existsSync(join(BUNDLES_SRC, 'algolia-chat.js'))) {
  fail(`widget bundles missing. Run:\n  cd vendor/algolia-central-chat-widget/algolia-chat && npm run build`);
}

// ---------- 1. copy their site verbatim ----------
//
// Clear the output first. cpSync copies over what is already there but never
// removes anything, so a file deleted from the source survived in every
// subsequent build — a presenter deck removed from the repo was still being
// served in production because the stale copy sat in a reused output dir.
// A build directory that outlives its inputs is not a build directory.
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
cpSync(SITE_SRC, OUT, { recursive: true });
console.log(`copied site      ${SITE_SRC.replace(ROOT + '/', '')} -> ${OUT.replace(ROOT + '/', '')}`);

// ---------- 2. copy the widget bundles their build forgets ----------
const bundleOut = join(OUT, 'widget-bundles');
mkdirSync(bundleOut, { recursive: true });
const bundles = readdirSync(BUNDLES_SRC).filter((f) => f.endsWith('.js'));
for (const f of bundles) cpSync(join(BUNDLES_SRC, f), join(bundleOut, f));
// Their bundles also reference brand assets copied alongside dist/brand.
if (existsSync(join(BUNDLES_SRC, 'brand'))) {
  cpSync(join(BUNDLES_SRC, 'brand'), join(bundleOut, 'brand'), { recursive: true });
}
console.log(`copied bundles   ${bundles.length} file(s) -> widget-bundles/  (fixes their dist gap)`);

// ---------- 3. copy OUR enhancement script ----------
const ENHANCE_SRC = join(ROOT, 'web-widget/dist/acs-enhance.js');
if (!existsSync(ENHANCE_SRC)) {
  fail(`our enhancement bundle missing at ${ENHANCE_SRC.replace(ROOT + '/', '')}. Run:\n  cd web-widget && npm run build`);
}
cpSync(ENHANCE_SRC, join(OUT, 'acs-enhance.js'));
console.log(`copied enhance   web-widget/dist/acs-enhance.js -> acs-enhance.js`);

// ---------- 4. inject our script tag into every widget-hosting page ----------
//
// The vendored site isn't just index.html — a merged upstream feature ships 5
// more pages under demo/ that also host <algolia-chat>/<algolia-chat-confidence>
// (main.ts already does document.querySelectorAll for both elements, so it's
// page-agnostic and needs no change here). Discover pages by walking the
// output tree rather than hardcoding the demo/ list, so a future upstream page
// addition doesn't silently ship unenhanced.
const findHtmlFiles = (dir) => {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findHtmlFiles(p));
    else if (entry.name.endsWith('.html')) out.push(p);
  }
  return out;
};

const TAG = [
  '',
  '    <!-- ACS enhancement layer. NOT part of the vendored widget: injected at',
  '         build time by scripts/widget/build_demo_site.mjs so the vendored',
  '         source stays byte-identical to upstream. Carries our deterministic',
  '         grounding verdict and host-page fixes. -->',
  '    <script src="/acs-enhance.js"></script>',
  '',
].join('\n');

// Inject BEFORE their widget bundles, not at </body>.
//
// This ordering is load-bearing. `default-open-mode` is read by
// <algolia-chat> when the element upgrades, and the element exposes no
// size-mode setter (its imperative API is only open() / ask()). So our script
// must run while the markup exists but the definition has NOT yet loaded —
// i.e. after the <algolia-chat> markup, before algolia-chat.js. Then we set
// attributes and their element picks up our values as it upgrades.
const marker = '<script src="/widget-bundles/algolia-confidence-badge.js"></script>';

// Root-absolute src ('/acs-enhance.js', not './acs-enhance.js') so it resolves
// from nested pages like demo/index.html the same as it does from the top-level
// index.html — the file is always copied to OUT's root in step 3.
const widgetPages = findHtmlFiles(OUT).filter((p) => readFileSync(p, 'utf8').includes('<algolia-chat'));
const injectedPages = [];
for (const pagePath of widgetPages) {
  const rel = pagePath.replace(OUT + '/', '');
  let pageHtml = readFileSync(pagePath, 'utf8');
  // Guard is per-file: a page can be re-run through this script independently
  // of its siblings, and each one needs its own double-inject refusal.
  if (pageHtml.includes('acs-enhance.js')) fail(`${rel} already references acs-enhance.js — refusing to double-inject`);
  // A page that declares <algolia-chat> but lost the marker is exactly the
  // silent-misconfiguration case we guard against — fail loud, don't skip it.
  if (!pageHtml.includes(marker)) {
    fail(`could not find their first widget <script> tag in ${rel} — their HTML changed; re-check the injection point before shipping`);
  }
  pageHtml = pageHtml.replace(marker, `${TAG}    ${marker}`);
  writeFileSync(pagePath, pageHtml);
  injectedPages.push(rel);
}
console.log(`injected         <script src="/acs-enhance.js"> BEFORE their widget bundles in ${injectedPages.length} page(s): ${injectedPages.join(', ')}`);

// ---------- 5. our own web app, as the full-screen variant at /app ----------
//
// The arrangement: the vendored widget site is THE app; our `web/` React
// app is kept as the full-screen chat variant rather than retired. Mounting it
// under /app also means the demo has a second, independent surface — if
// anything is wrong with the widget page during a live demo, the full-screen
// app is one URL away and does not share a line of its rendering code.
//
// Optional on purpose: the widget site must still build when web/dist is absent
// (a widget-only iteration shouldn't fail the build).
const WEB_DIST = join(ROOT, 'web/dist');
if (existsSync(join(WEB_DIST, 'index.html'))) {
  const appOut = join(OUT, 'app');
  mkdirSync(appOut, { recursive: true });
  cpSync(WEB_DIST, appOut, { recursive: true });
  console.log(`copied web app   web/dist -> app/            (full-screen variant)`);
} else {
  console.log(`skipped web app  web/dist not built — /app will 404`);
}


// ---------- 7. report what shipped ----------
const size = (p) => `${(readFileSync(p).length / 1024).toFixed(1)}KB`;
console.log(`\n== built ${OUT.replace(ROOT + '/', '')} ==`);
for (const rel of injectedPages) console.log(`  ${rel.padEnd(35)}${size(join(OUT, rel))}  (enhanced)`);
for (const f of bundles) console.log(`  widget-bundles/${f.padEnd(34)}${size(join(bundleOut, f))}`);
console.log(`  acs-enhance.js                    ${size(join(OUT, 'acs-enhance.js'))}`);
console.log(`\nvendored source untouched — verify with:`);
console.log(`  git status --porcelain vendor/    # expect no output`);

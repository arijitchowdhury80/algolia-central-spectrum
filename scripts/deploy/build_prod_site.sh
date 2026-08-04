#!/usr/bin/env bash
#
# build_prod_site — assemble everything Vercel serves, in one deterministic chain.
#
# WHAT PRODUCTION IS
#   /            the vendored Algolia-engineering widget demo site — the whole app
#
# WHY A SCRIPT AND NOT A vercel.json ONE-LINER
#   Three packages have to build in dependency order (chat-central -> algolia-chat
#   -> our enhancement layer, then assembly), and the vendored widget's own build
#   does not copy its bundles into dist. Encoding that in a shell string inside
#   vercel.json makes it untestable locally; here it is one command I can run and
#   verify before a deploy touches production.
#
# ENVIRONMENT (set in the Vercel project, not in the repo)
#   VITE_JUDGE_URL         e.g. https://judge.contentengagement.info/acs
#   VITE_LAB_API_KEY       shared secret for the judge service
#   VITE_AGENT_PROXY_URL   origin of lab/server's search proxy, e.g. same host as
#                          VITE_JUDGE_URL minus the /acs path — Agent Studio
#                          completions (every chat message) route through here so
#                          the real ALGOLIA_SEARCH_API_KEY never reaches a browser.
#   VITE_SEARCH_PROXY_URL  same origin, used by the InstantSearch lifecycle ping.
#                          Usually identical to VITE_AGENT_PROXY_URL; kept as a
#                          separate var because the two client packages read it
#                          independently (chat-central vs algolia-chat builds).
#
#   The Algolia app-id is NOT read here (non-secret, stays in markup as-is). The
#   search-only key used to be an <algolia-chat>/<algolia-instant-search>
#   markup attribute — as of the 2026-08-04 fix it is retired from markup
#   entirely and lives only in lab/server's own env, forwarded by the proxy.
#
# A missing VITE_JUDGE_URL is a HARD FAILURE here. It has already cost two hours
# of production reading "Grounding · unavailable" — a build that silently points
# the judge at localhost must never reach production again. Missing
# VITE_AGENT_PROXY_URL / VITE_SEARCH_PROXY_URL are HARD FAILURES for the same
# reason: silently falling back would mean the browser calls Algolia directly
# with a placeholder key, i.e. a broken chat, not a security fallback.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

say() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }

if [ -z "${VITE_JUDGE_URL:-}" ]; then
  echo "build_prod_site: VITE_JUDGE_URL is not set — refusing to build a client whose" >&2
  echo "                 judge calls would go to http://localhost:8788 in production." >&2
  exit 1
fi
echo "judge endpoint: $VITE_JUDGE_URL"

if [ -z "${VITE_AGENT_PROXY_URL:-}" ] || [ -z "${VITE_SEARCH_PROXY_URL:-}" ]; then
  echo "build_prod_site: VITE_AGENT_PROXY_URL / VITE_SEARCH_PROXY_URL must both be set —" >&2
  echo "                 refusing to build a client that would call Algolia directly" >&2
  echo "                 with the real search key (2026-08-04 fix)." >&2
  exit 1
fi
echo "search proxy: $VITE_AGENT_PROXY_URL (agent-studio) / $VITE_SEARCH_PROXY_URL (instantsearch)"

# The vendored client reads the judge secret as VITE_JUDGE_API_KEY; this project
# has always called it VITE_LAB_API_KEY. Vite inlines the whole import.meta.env
# object into their bundle, so the URL was found under its own name while the key
# silently was not — production returned 401 on every judge call and the chip read
# "auth required", with the request going out carrying no auth header at all.
# Export both names so either spelling resolves.
export VITE_JUDGE_API_KEY="${VITE_JUDGE_API_KEY:-${VITE_LAB_API_KEY:-}}"
if [ -z "$VITE_JUDGE_API_KEY" ]; then
  echo "build_prod_site: no judge key (VITE_LAB_API_KEY / VITE_JUDGE_API_KEY) — the" >&2
  echo "                 deployed judge requires one and every call would 401." >&2
  exit 1
fi

VENDOR="vendor/algolia-central-chat-widget"

say "1/4  vendored engine (chat-central)"
npm --prefix "$VENDOR/chat-central" install --no-audit --no-fund
npm --prefix "$VENDOR/chat-central" run build

say "2/4  vendored web components (algolia-chat)"
npm --prefix "$VENDOR/algolia-chat" install --no-audit --no-fund
npm --prefix "$VENDOR/algolia-chat" run build

say "3/4  ACS enhancement layer (judge config is baked in here)"
npm --prefix web-widget install --no-audit --no-fund
npm --prefix web-widget run build

say "4/4  assemble"
node scripts/widget/build_demo_site.mjs --out dist-widget

say "verify"
# Fail loudly rather than shipping a site whose judge points at a dev machine.
if ! grep -q "$VITE_JUDGE_URL" dist-widget/acs-enhance.js; then
  echo "build_prod_site: acs-enhance.js does not contain $VITE_JUDGE_URL" >&2
  exit 1
fi
# The 401 above shipped because nothing checked that the KEY made it in. It does now.
if ! grep -q "$VITE_JUDGE_API_KEY" dist-widget/widget-bundles/algolia-chat.js; then
  echo "build_prod_site: the judge key is not in the widget bundle — judge calls would 401." >&2
  exit 1
fi
test -f dist-widget/index.html
test -f dist-widget/widget-bundles/algolia-chat.js

# Positive checks only — the real ALGOLIA_SEARCH_API_KEY value is deliberately
# never referenced in this script, so it can't become a third place the key
# lives in cleartext. Confirming the PROXY URL made it into both bundles is
# the same-shape check as the judge one above, and proves the real key path
# (agentStudio.ts / InstantSearchElement.ts) took effect.
if ! grep -q "$VITE_AGENT_PROXY_URL" dist-widget/widget-bundles/algolia-chat.js; then
  echo "build_prod_site: VITE_AGENT_PROXY_URL is not baked into the widget bundle —" >&2
  echo "                 Agent Studio calls would go straight to Algolia with the real key." >&2
  exit 1
fi
if ! grep -q "$VITE_SEARCH_PROXY_URL" dist-widget/widget-bundles/algolia-chat.js; then
  echo "build_prod_site: VITE_SEARCH_PROXY_URL is not baked into the widget bundle." >&2
  exit 1
fi
if ! grep -q "$VITE_AGENT_PROXY_URL" dist-widget/acs-enhance.js; then
  echo "build_prod_site: VITE_AGENT_PROXY_URL is not baked into acs-enhance.js —" >&2
  echo "                 context-engine.js (the proactive-chat feature) would call" >&2
  echo "                 Algolia directly with no key and fail, or worse, with one." >&2
  exit 1
fi

# Every page that hosts the widget must reach the output WITH our enhancement
# script injected. Expectations are derived from the SOURCE, not a hardcoded list:
# upstream adds pages (the proactive-chat merge added five under demo/), and a
# hardcoded list silently stops covering them the moment that happens, which is
# the same shape as the failure this whole verify block exists to prevent.
#
# A page in the output without acs-enhance.js is not cosmetic: it ships with the
# vendored `mode="algolia"` in-browser judge instead of ours, so the chip would
# show a verdict from an engine that predates our Phase-2 rebuild.
#
# Uses a temp file rather than `done < <(grep …)`: process substitution needs
# /dev/fd, which is absent in Vercel's build container — it failed there with
# "/dev/fd/63: No such file or directory" AFTER a fully successful build.
# Redirecting from a file also keeps the loop out of a subshell, so `missing`
# survives, which a `grep | while` pipeline would not do.
missing=0
pages_list="$(mktemp)"
grep -rl '<algolia-chat' "$VENDOR/website/public" --include='*.html' > "$pages_list" || true
while IFS= read -r src; do
  [ -n "$src" ] || continue
  rel="${src#"$VENDOR/website/public/"}"
  out="dist-widget/$rel"
  if [ ! -f "$out" ]; then
    echo "build_prod_site: $rel hosts <algolia-chat> but is missing from dist-widget" >&2
    missing=1
    continue
  fi
  if ! grep -q 'acs-enhance.js' "$out"; then
    echo "build_prod_site: $rel reached dist-widget without acs-enhance.js — it would ship" >&2
    echo "                 the vendored judge config instead of ours." >&2
    missing=1
  fi
done < "$pages_list"
rm -f "$pages_list"
[ "$missing" -eq 0 ] || exit 1

# The proactive-context engine the demo pages load. Guarded on the source dir so
# this stays honest before the feature is vendored, then strict once it is.
if [ -d "$VENDOR/website/public/context" ]; then
  for f in context-engine.js personas.js agents.generated.json; do
    if [ ! -f "dist-widget/context/$f" ]; then
      echo "build_prod_site: context/$f is in the vendored site but missing from dist-widget —" >&2
      echo "                 the demo pages would load a 404 and track nothing." >&2
      exit 1
    fi
  done
fi

echo "ok — widget site built, judge endpoint baked in"

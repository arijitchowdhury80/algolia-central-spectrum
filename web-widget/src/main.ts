/**
 * acs-enhance — the ACS enhancement layer for the vendored Algolia chat widget.
 *
 * WHAT THIS IS
 * ------------
 * `vendor/algolia-central-chat-widget` is Algolia engineering's code and is
 * READ-ONLY (see vendor/README.md). Everything we need on top of it lives here
 * and is injected into a COPY of their demo page at build time by
 * scripts/widget/build_demo_site.mjs. Their source is never written to.
 *
 * LOAD ORDER MATTERS
 * ------------------
 * This script is injected BEFORE their widget bundles, deliberately. The
 * <algolia-chat> element reads `default-open-mode` when it upgrades and exposes
 * no size-mode setter (its imperative API is only open() / ask()). So the only
 * way to configure it without editing their markup is to set the attribute while
 * the element is still un-upgraded — i.e. after their HTML, before their JS.
 *
 * The same is true of `<algolia-chat-confidence>`, though for a different
 * reason after the upstream merge: `ConfidenceElement` now DOES implement
 * `attributeChangedCallback`, guarded by
 * `if (!this.isConnected || previous === next) return;`. Our writes still
 * land before the element connects, so `isConnected` is false and the guard's
 * early return is what fires — not a live reconfiguration — and
 * `connectedCallback` then reads the values we already set as if they had
 * always been there. Writing after upgrade would instead land past that
 * guard and trigger whatever re-init the callback does, mid-connection, on a
 * live demo. Running synchronously keeps us on the safe side of that guard.
 *
 * THIS FILE THEREFORE RUNS SYNCHRONOUSLY, NOT ON DOMContentLoaded.
 * It used to wait for DOMContentLoaded "to be safe". That was the opposite of
 * safe: while the parser is still working, readyState is `loading`, so the wait
 * pushed our attribute writes PAST the widget bundles that immediately follow
 * this tag. Measured on 2026-07-28: the page showed `mode="hosted"` on the
 * element while the network showed three Agent Studio judge calls — their
 * in-browser judge, because it had already captured `mode="algolia"` at upgrade.
 * The markup we configure sits above this script tag, so it is guaranteed to
 * exist by the time this runs; DOMContentLoaded only remains as a fallback for
 * the case where our tag somehow ends up before the widget markup.
 *
 * WHAT USED TO BE HERE
 * --------------------
 * A global override of Element.prototype.scrollIntoView, to stop the message
 * panel jittering while an answer streamed. It worked, but overriding a DOM
 * prototype for the whole page to route around three lines in one component is
 * not something to ship. The fix now lives where it belongs — in the component —
 * via upstream PR smomin/algolia-central-chat-widget#1, and this file no longer
 * patches anything global.
 */

/**
 * Panel size on open.
 *
 * Their demo page ships `default-open-mode="docked"` — the SMALLEST of their
 * three modes (normal | docked | maximized). A screenshot showed the
 * consequence on the marketing landing page: a cramped panel where a streaming
 * answer plus its source list has no room to breathe. "normal" gives the panel
 * real height while still leaving the marketing page visible behind it; the
 * header's expand control still lets a presenter go to maximized live.
 *
 * A merged upstream feature adds five simulated Adobe Spectrum documentation
 * pages under `/demo/`. There the point of the demo is the opposite: the
 * assistant reacts to what the visitor is reading, so the panel needs to stay
 * out of the way — docked — while the docs stay on screen. Those pages already
 * ship `default-open-mode="docked"` in their own markup, so the cleanest move
 * is to SKIP them rather than write the same value back: fewer attribute
 * writes, and their own markup stays the source of truth for their own pages
 * instead of us silently re-deciding it here.
 */
const OPEN_MODE = 'normal';

function isDemoPath(pathname: string): boolean {
  return pathname.startsWith('/demo/');
}

export function configureOpenMode(root: ParentNode, pathname: string): boolean {
  const els = root.querySelectorAll('algolia-chat');
  if (isDemoPath(pathname)) {
    // Their markup already has the docked default we want here — don't touch it.
    return els.length > 0;
  }
  for (const el of els) {
    // Only override their default; never fight an explicit choice made later.
    el.setAttribute('default-open-mode', OPEN_MODE);
  }
  return els.length > 0;
}

/**
 * Point the confidence panel at OUR judge.
 *
 * Their demo page ships `<algolia-chat-confidence mode="algolia">`, which runs
 * their in-browser judge engine against four Agent Studio agents. That engine is
 * our own `@lab/judge` forked BEFORE our Phase-2 rebuild, so it differs from what
 * we ship today in every way that matters:
 *
 *   - a solo Skeptic flag caps the score (we require 2-of-3 corroboration),
 *   - it parses the v3 four-dimension rubric, while the judge agents were moved
 *     to our v4 single-Usefulness rubric — so their parse no longer matches the
 *     agents at all,
 *   - and it has no deterministic grounding check, which is the only part of the
 *     verdict that is reproducible for the same input.
 *
 * `mode` / `url` / `api-key` are documented attributes on their element, so
 * switching to the hosted path is configuration, not modification — and it is
 * reversible by deleting these three lines. Set before their bundles load, for
 * the same reason as the open mode above: the element reads its attributes when
 * it upgrades.
 *
 * Both values are injected at build time (see web-widget/README + DEPLOYING.md).
 * If the URL is missing we deliberately leave their markup untouched rather than
 * write a half-configured hosted judge that would 401 or hit localhost — a wrong
 * config here shows up as a dark chip, which is exactly the failure mode that
 * cost us two hours of broken production on 2026-07-28.
 */
const JUDGE_URL = import.meta.env?.VITE_JUDGE_URL as string | undefined;
const JUDGE_KEY = import.meta.env?.VITE_LAB_API_KEY as string | undefined;

export function configureHostedJudge(
  root: ParentNode,
  url: string | undefined,
  apiKey: string | undefined,
): boolean {
  const panels = root.querySelectorAll('algolia-chat-confidence');
  if (panels.length === 0) return false;
  if (!url) {
    console.warn(
      '[acs-enhance] no VITE_JUDGE_URL at build time — leaving the vendored judge config in place. ' +
        'The Confidence chip will run their pre-Phase-2 engine, not our grounding check.',
    );
    return false;
  }
  for (const el of panels) {
    el.setAttribute('mode', 'hosted');
    el.setAttribute('url', url);
    if (apiKey) el.setAttribute('api-key', apiKey);
  }
  return true;
}

/** Apply our host-page config. Returns true when the widget markup was found,
 *  so the caller can decide whether a retry is still needed. */
function init(): boolean {
  const sawChat = configureOpenMode(document, window.location.pathname);
  const sawJudgePanel = document.querySelector('algolia-chat-confidence') !== null;
  configureHostedJudge(document, JUDGE_URL, JUDGE_KEY);
  return sawChat || sawJudgePanel;
}

// Run NOW — see LOAD ORDER above. Waiting is what broke this: the widget
// captures its config at upgrade, which happens before DOMContentLoaded.
// The `typeof document` guard keeps this module importable from a plain-node
// test runner, where the side effect would otherwise throw at import time.
if (typeof document !== 'undefined') {
  const applied = init();
  // Fallback only: if the markup was not there yet, our tag is in the wrong
  // place. Retry once so the page is merely mis-ordered, not broken — but note
  // that at that point the element may already have upgraded and ignored us.
  if (!applied && document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => void init(), { once: true });
  }
}

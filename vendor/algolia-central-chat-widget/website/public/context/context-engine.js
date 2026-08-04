/**
 * context-engine.js — proactive, persona-aware context layer
 *
 * Loaded as an ES module on every demo page. Responsibilities:
 *   1. Track visitor behavior in localStorage (profile, session, conversion events).
 *   2. Inject a top-right persona dropdown that switches which agent answers.
 *   3. On page load, call the concierge agent and, when there's enough signal,
 *      proactively open the chat with a tailored greeting.
 *   4. Hand the same tracked context to the chat widget, so the agent answering
 *      the visitor's questions sees who they are, what they've been reading, and
 *      how the active persona wants to be answered (see `personas.js`).
 *
 * Storage keys:
 *   acs_profile  { persona, personaProfile, firstSeen, visits }
 *   acs_session  { pages: [{path,title,enteredAt,dwellMs}], startedAt }
 *   acs_events   [{type, page, meta, ts}]
 */

import { PERSONA_OPTIONS, personaProfileSeed, renderPersonaProfile } from './personas.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const APP_ID = '0EXRPAXB56';
const SEARCH_KEY = 'REDACTED';

// These are loaded from agents.generated.json (written by create-proactive-agents.mjs).
// We fetch the JSON at init so the IDs are always up-to-date without hard-coding.
let PERSONA_AGENTS = {}; // { designer, developer, pm }  → agentId strings
let CONCIERGE_AGENT_ID = null;

// Greeting cache key — stores a pending proactive greeting across navigations so
// that if the concierge API call finishes after the user has already left the page
// the greeting is shown on the next page they land on.
const GREETING_CACHE_KEY = 'acs_pending_greeting';
const GREETING_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// How long init() waits for <algolia-chat> to be defined before giving up, so a
// widget script that never loads cannot deadlock the rest of the page.
const WIDGET_DEFINITION_TIMEOUT_MS = 5000;

/**
 * Whether a greeting has already been surfaced during THIS page load.
 *
 * Deliberately in-memory rather than localStorage: each navigation is a fresh
 * chance to engage, so closing the chat and moving to another page lets the
 * concierge run again. Whether that is wanted at all is the visitor's call —
 * they control it with the auto-suggestions toggle in the chat header, which the
 * widget persists and enforces.
 */
let engagedThisPageLoad = false;

// ── Storage helpers ───────────────────────────────────────────────────────────

function storageGet(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}

function storageSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

// ── Profile ───────────────────────────────────────────────────────────────────

/**
 * `acs_profile` is this demo's profile source: one localStorage record holding
 * who the visitor is and, in `personaProfile`, how they want to be answered.
 *
 * It is the only thing consulted at request time. `personas.js` is a catalog
 * that seeds this record — it is never read on the way to an agent — so what the
 * agent learns about the visitor is exactly what is in storage, and editing the
 * record in devtools changes the next answer. In a real integration a CDP, a
 * session endpoint, or a signed-in user's saved preferences would write it, and
 * the seeding here stands in for that fetch.
 *
 * Shape:
 *   { persona, personaProfile: { key, focus, leadWith, detail, … }, firstSeen, visits }
 */
function loadProfile() {
  return storageGet('acs_profile') ?? { persona: 'auto', firstSeen: Date.now(), visits: 0 };
}

function saveProfile(profile) {
  storageSet('acs_profile', profile);
}

/**
 * Guarantee the stored record carries the profile body for the persona it names,
 * writing it if not. Returns the up-to-date record.
 *
 * Two fields could disagree, so one of them has to win: `persona` names the
 * profile and `personaProfile` holds it, and a mismatch means the name changed
 * and the body is refetched. That is what makes editing `persona` in devtools
 * work — the matching attributes arrive on the next turn instead of the old
 * persona's body being sent under a new name.
 *
 * Everything else in the body is left exactly as stored, so a hand-tuned dial
 * survives. A persona this build no longer has resets to `auto`, which also
 * stops the mismatch recurring on every message.
 */
function ensurePersonaProfile(profile) {
  if (profile.personaProfile?.key === profile.persona) return profile;

  const seed = personaProfileSeed(profile.persona);
  const repaired = {
    ...profile,
    persona: seed ? profile.persona : 'auto',
    personaProfile: seed ?? personaProfileSeed('auto'),
  };
  saveProfile(repaired);
  return repaired;
}

// ── Session ───────────────────────────────────────────────────────────────────

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

function loadSession() {
  const s = storageGet('acs_session');
  // Start a fresh session if none exists or if more than TTL has passed
  if (!s || Date.now() - s.startedAt > SESSION_TTL_MS) {
    return { pages: [], startedAt: Date.now() };
  }
  return s;
}

function saveSession(session) {
  storageSet('acs_session', session);
}

// ── Events ────────────────────────────────────────────────────────────────────

const MAX_EVENTS = 50;

function loadEvents() {
  return storageGet('acs_events') ?? [];
}

function pushEvent(type, meta = {}) {
  const events = loadEvents();
  events.push({ type, page: location.pathname, meta, ts: Date.now() });
  // Trim oldest events to keep storage small
  storageSet('acs_events', events.slice(-MAX_EVENTS));
}

// ── Visitor context ───────────────────────────────────────────────────────────

/** Cap on how many tracked events travel with a request. */
const CONTEXT_EVENT_LIMIT = 20;

/**
 * Everything we know about this visitor, read fresh from localStorage.
 *
 * One builder, two consumers: the concierge agent (deciding whether to greet) and
 * the chat widget's context provider (which sends this with every question the
 * visitor asks). Sharing the shape means a proactive greeting and an answer can
 * never disagree about what the visitor has been doing.
 *
 * Called per request rather than cached, so the current page and accumulated
 * dwell times are always up to date — and so an edit to the stored profile takes
 * effect on the very next message.
 *
 * `personaProfile` is the half of this the visitor does not generate by browsing:
 * the stored attributes that tell the agent how to weight the answer — how much
 * code, how much visual detail, how much migration and strategy. The persona
 * agents have the same attributes compiled into their instructions, so for them
 * this is reinforcement the stored record can retune without republishing. For
 * `auto`, which answers through the widget's declared primary agent, it is the
 * only steer there is.
 */
function buildVisitorContext() {
  const profile = ensurePersonaProfile(loadProfile());
  const session = loadSession();
  const events = loadEvents();
  return {
    persona: profile.persona,
    personaProfile: renderPersonaProfile(profile.personaProfile),
    currentPage: { path: location.pathname, title: document.title },
    pagesViewed: session.pages,
    events: events.slice(-CONTEXT_EVENT_LIMIT),
    visits: profile.visits,
    // Absent from profiles stored before this field existed.
    firstSeen: profile.firstSeen ? new Date(profile.firstSeen).toISOString() : null,
    sessionDurationMs: Date.now() - session.startedAt,
  };
}

// ── Page tracking ─────────────────────────────────────────────────────────────

const pageEnteredAt = Date.now();
let pageReadFired = false;

function trackPageView() {
  pushEvent('page_view', { title: document.title });

  // Dwell-based page_read: fire after 30 seconds of dwell
  setTimeout(() => {
    if (!pageReadFired) {
      pageReadFired = true;
      pushEvent('page_read', { title: document.title, trigger: 'dwell' });
    }
  }, 30_000);
}

function trackScrollDepth() {
  let maxScroll = 0;
  function onScroll() {
    const scrolled = (window.scrollY + window.innerHeight) / document.body.scrollHeight;
    if (scrolled > maxScroll) maxScroll = scrolled;
    if (maxScroll >= 0.6 && !pageReadFired) {
      pageReadFired = true;
      pushEvent('page_read', { title: document.title, trigger: 'scroll' });
    }
  }
  window.addEventListener('scroll', onScroll, { passive: true });
}

function trackCTAClicks() {
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-cta]');
    if (el) {
      pushEvent('cta_click', { cta: el.dataset.cta, label: el.textContent?.trim() });
    }
  });
}

function recordPageDwell() {
  // Record the current page immediately on load (dwell=0) so it counts toward
  // signal checks even before the user leaves the page.
  const session = loadSession();
  const existing = session.pages.findIndex((p) => p.path === location.pathname);
  const entry = {
    path: location.pathname,
    title: document.title,
    enteredAt: pageEnteredAt,
    dwellMs: 0,
  };
  if (existing >= 0) session.pages[existing] = entry;
  else session.pages.push(entry);
  saveSession(session);

  function flush() {
    const dwell = Date.now() - pageEnteredAt;
    const s = loadSession();
    const idx = s.pages.findIndex((p) => p.path === location.pathname);
    const updated = {
      path: location.pathname,
      title: document.title,
      enteredAt: pageEnteredAt,
      dwellMs: dwell,
    };
    if (idx >= 0) s.pages[idx] = updated;
    else s.pages.push(updated);
    saveSession(s);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) flush();
  });
  window.addEventListener('beforeunload', flush);
}

// ── Widget access ─────────────────────────────────────────────────────────────

/**
 * The <algolia-chat> element, or null if it isn't on the page.
 *
 * No readiness polling needed — the element buffers imperative calls made
 * before its React tree has mounted and replays them once the API is live.
 */
function getWidget() {
  return document.querySelector('algolia-chat');
}

/** Toggle the launcher's loading indicator. Safe to call at any time. */
function setWidgetAnalyzing(analyzing) {
  getWidget()?.setAnalyzing(analyzing);
}

/**
 * Let the answering agent see what we know about this visitor.
 *
 * Registered as a provider rather than pushed as a snapshot, because the widget
 * calls it before each message: the agent sees the page the visitor is on *now*
 * and the events they have accumulated since, not whatever was true at page load.
 *
 * The widget never reads these localStorage keys itself — deciding what a visitor
 * has agreed to share is the host's call, so handing the data over is an explicit
 * step here.
 */
function shareVisitorContextWithWidget() {
  const widget = getWidget();
  if (typeof widget?.setContextProvider !== 'function') {
    console.warn(
      '[context-engine] <algolia-chat> has no setContextProvider() — chat answers ' +
        'will not see the visitor profile. Rebuild the widget bundle.',
    );
    return;
  }
  widget.setContextProvider(buildVisitorContext);
}

/**
 * Keep the persona dropdown clear of the docked chat panel.
 *
 * The dropdown is fixed to the top-right, which is exactly where the docked panel
 * renders its header controls, so it would otherwise swallow clicks on them.
 * Uses the widget's `algolia-chat-open-change` event rather than polling.
 */
function watchChatOpenState() {
  const DOCKED_PANEL_WIDTH = 420; // matches the widget's min(420px, 100vw - 32px)
  document.addEventListener('algolia-chat-open-change', (e) => {
    const dropdown = document.getElementById('acs-persona-dropdown');
    if (!dropdown) return;
    dropdown.style.right = e.detail?.open ? `${DOCKED_PANEL_WIDTH + 24}px` : '16px';
  });
}

// ── Agent Studio completions (non-streaming fetch) ────────────────────────────

/**
 * callAgentJson — non-streaming completions call using ai-sdk-5 format.
 *
 * Collects all text-delta events into a single string and returns the full
 * assistant response. Suitable for the concierge and other non-interactive
 * agent calls in the context engine.
 */
/** The text carried by one SSE line, or '' for anything that isn't a delta. */
function textDeltaFrom(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('data:')) return '';
  const payload = trimmed.slice('data:'.length).trim();
  if (!payload) return '';
  try {
    const ev = JSON.parse(payload);
    return ev.type === 'text-delta' && typeof ev.delta === 'string' ? ev.delta : '';
  } catch {
    return ''; // skip malformed lines
  }
}

/** Concatenate every text-delta in an ai-sdk-5 SSE stream. */
async function readTextDeltaStream(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    // The trailing fragment may be half a line; hold it back for the next chunk.
    buffer = lines.pop() ?? '';
    for (const line of lines) text += textDeltaFrom(line);
  }
  return text;
}

async function callAgentJson(agentId, userMessage) {
  const url = `https://${APP_ID}.algolia.net/agent-studio/1/agents/${agentId}/completions?compatibilityMode=ai-sdk-5`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Algolia-Application-Id': APP_ID,
      'X-Algolia-API-Key': SEARCH_KEY,
    },
    body: JSON.stringify({
      messages: [{ role: 'user', parts: [{ type: 'text', text: userMessage }] }],
    }),
  });
  if (!res.ok) throw new Error(`Agent call failed: ${res.status}`);

  return readTextDeltaStream(res.body);
}

// Extract the first JSON object from a text response (the concierge returns JSON)
function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

// ── Proactive analysis ────────────────────────────────────────────────────────

function hasEnoughSignal(profile, session, events) {
  // Any page view is enough to pre-warm the concierge. The concierge itself
  // decides whether to engage based on what it finds in the index.
  const enough = session.pages.length >= 1 || profile.visits >= 1;
  console.log(
    `[context-engine] signal check → ${enough ? 'ENOUGH' : 'not enough'} | visits=${profile.visits} pages=${session.pages.length} events=${events.length}`,
  );
  return enough;
}

/**
 * Show a cached greeting from a previous page's concierge call.
 *
 * This is the fast path — no API call. The element buffers the `engage()` call
 * if its React tree hasn't mounted yet, so the chat opens as early as possible.
 */
function showCachedGreeting() {
  const cached = storageGet(GREETING_CACHE_KEY);
  if (!cached) return false;
  // Expire stale cache entries
  if (Date.now() - cached.ts > GREETING_CACHE_TTL_MS) {
    storageSet(GREETING_CACHE_KEY, null);
    return false;
  }

  const widget = getWidget();
  if (!widget) return false;

  // Clear the cache so it only shows once, and mark this page load as engaged so
  // the concierge is not also called below.
  storageSet(GREETING_CACHE_KEY, null);
  engagedThisPageLoad = true;
  console.log('[context-engine] Showing cached greeting from previous page');

  widget.engage({ greeting: cached.greeting, suggestions: cached.suggestions ?? [] });
  return true;
}

/**
 * Every reason to skip the concierge, cheapest check first. Each one logs why,
 * because "the chat didn't greet me" is otherwise very hard to diagnose.
 */
function shouldCallConcierge(profile, session, events) {
  if (!CONCIERGE_AGENT_ID) {
    console.warn('[context-engine] No CONCIERGE_AGENT_ID — agents.generated.json not loaded yet?');
    return false;
  }

  // Skip if a greeting is already pending or was already shown on this page load
  const existingCache = storageGet(GREETING_CACHE_KEY);
  if (existingCache && Date.now() - existingCache.ts < GREETING_CACHE_TTL_MS) {
    console.log('[context-engine] Cached greeting already pending, skipping concierge call');
    return false;
  }
  if (engagedThisPageLoad) {
    console.log('[context-engine] Already engaged on this page, skipping concierge call');
    return false;
  }

  const widget = getWidget();
  if (!widget) {
    console.warn('[context-engine] No <algolia-chat> element found');
    return false;
  }

  // The visitor can switch auto-suggestions off in the chat header. The widget
  // enforces this itself, but checking here avoids a pointless agent call.
  if (widget.autoEngage === false) {
    console.log('[context-engine] Auto-suggestions are off — skipping concierge call');
    return false;
  }

  return hasEnoughSignal(profile, session, events);
}

/** The greeting the concierge settled on, or '' when it chose not to engage. */
function greetingFrom(decision) {
  if (!decision?.engage) return '';
  return (decision.greeting ?? '').trim();
}

/** Engage now, or cache the greeting for the page the visitor is heading to. */
function applyConciergeDecision(decision) {
  const greeting = greetingFrom(decision);
  if (!greeting) {
    console.log('[context-engine] Concierge decided not to engage');
    setWidgetAnalyzing(false);
    return;
  }

  const suggestions = Array.isArray(decision.suggestions) ? decision.suggestions : [];
  console.log('[context-engine] Engaging! greeting:', greeting);

  if (document.hidden) {
    // Visitor navigated away — cache so the next page shows it instantly
    console.log('[context-engine] Page hidden — caching greeting for next page load');
    storageSet(GREETING_CACHE_KEY, { greeting, suggestions, ts: Date.now() });
    setWidgetAnalyzing(false);
    return;
  }

  // Visitor is still here — engage now. engage() clears the spinner itself,
  // and returns false if they switched auto-suggestions off mid-call.
  engagedThisPageLoad = getWidget()?.engage({ greeting, suggestions }) ?? false;
}

async function runProactiveAnalysis(profile, session, events) {
  console.log('[context-engine] runProactiveAnalysis start', { conciergeId: CONCIERGE_AGENT_ID });

  if (!shouldCallConcierge(profile, session, events)) return;

  const context = buildVisitorContext();

  console.log('[context-engine] Calling concierge with context:', context);
  const prompt = `CONTEXT:\n${JSON.stringify(context, null, 2)}`;

  // Show the launcher spinner for the duration of the concierge call so the
  // visitor knows a suggestion is being prepared.
  setWidgetAnalyzing(true);

  try {
    const rawText = await callAgentJson(CONCIERGE_AGENT_ID, prompt);
    console.log('[context-engine] Concierge raw response:', rawText.slice(0, 500));
    const decision = extractJson(rawText);
    console.log('[context-engine] Parsed decision:', decision);
    applyConciergeDecision(decision);
  } catch (err) {
    console.warn('[context-engine] Proactive analysis failed:', err.message);
    setWidgetAnalyzing(false);
  }
}

// ── Persona dropdown ──────────────────────────────────────────────────────────

function buildPersonaDropdown(currentPersona) {
  const wrapper = document.createElement('div');
  wrapper.id = 'acs-persona-dropdown';
  wrapper.style.cssText = [
    'position:fixed',
    'top:16px',
    'right:16px',
    'z-index:9999',
    // Slides left when the docked chat panel opens (see watchChatOpenState) so it
    // never covers the panel's own header controls.
    'transition:right 180ms ease',
    'display:flex',
    'align-items:center',
    'gap:8px',
    'background:rgba(255,255,255,0.95)',
    'backdrop-filter:blur(8px)',
    '-webkit-backdrop-filter:blur(8px)',
    'border:1px solid rgba(0,61,255,0.18)',
    'border-radius:100px',
    'padding:6px 12px 6px 10px',
    'box-shadow:0 2px 12px rgba(0,0,0,0.10)',
    'font-family:system-ui,-apple-system,sans-serif',
    'font-size:13px',
    'font-weight:500',
    'color:#111',
    'cursor:pointer',
    'user-select:none',
  ].join(';');

  const label = document.createElement('span');
  label.style.cssText =
    'color:#555;font-size:11px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;';
  label.textContent = 'Persona';
  wrapper.appendChild(label);

  const select = document.createElement('select');
  select.style.cssText = [
    'background:transparent',
    'border:none',
    'outline:none',
    'cursor:pointer',
    'font-size:13px',
    'font-weight:600',
    'color:#003DFF',
    'padding:0 2px',
    'appearance:auto',
  ].join(';');

  for (const opt of PERSONA_OPTIONS) {
    const option = document.createElement('option');
    option.value = opt.key;
    option.textContent = `${opt.icon}  ${opt.label}`;
    if (opt.key === currentPersona) option.selected = true;
    select.appendChild(option);
  }

  select.addEventListener('change', () => onPersonaChange(select.value));
  wrapper.appendChild(select);
  document.body.appendChild(wrapper);
  return { wrapper, select };
}

async function onPersonaChange(personaKey) {
  // Reset all session/event/greeting data so the new persona gets a fresh analysis.
  storageSet('acs_session', null);
  storageSet('acs_events', null);
  storageSet(GREETING_CACHE_KEY, null);
  engagedThisPageLoad = false;

  // Keep the profile but update the persona; reset visit count so first-page
  // signal thresholds work cleanly for the new persona.
  //
  // The new persona's attributes are written here rather than looked up later:
  // the record is the profile source, so a switch has to land in storage before
  // anything reads it — including the concierge call at the end of this function.
  // Writing also discards a hand-tuned dial from the previous persona, which is
  // the intent, since the visitor just asked to be treated as someone else.
  const profile = loadProfile();
  profile.persona = personaKey;
  profile.personaProfile = personaProfileSeed(personaKey) ?? personaProfileSeed('auto');
  profile.visits = 0;
  saveProfile(profile);

  const widget = getWidget();
  if (!widget) return;

  // Switch the answering agent. 'auto' clears the override back to the
  // declared primary; setPersona normalises empty ids to null for us.
  if (personaKey === 'auto') {
    widget.setPersona(null);
  } else {
    const opt = PERSONA_OPTIONS.find((o) => o.key === personaKey);
    widget.setPersona(PERSONA_AGENTS[personaKey] ?? null, opt?.label ?? personaKey);
  }

  // Clear any in-flight spinner from the previous persona's analysis
  widget.setAnalyzing(false);

  // Re-seed the session with the current page so the concierge has context
  const freshSession = { pages: [], startedAt: Date.now() };
  const entry = {
    path: location.pathname,
    title: document.title,
    enteredAt: Date.now(),
    dwellMs: 0,
  };
  freshSession.pages.push(entry);
  saveSession(freshSession);

  // Kick off a fresh proactive analysis for the new persona (signal = 1 page,
  // not enough on its own — user needs to navigate to a second page to trigger)
  const events = loadEvents() ?? [];
  await runProactiveAnalysis(profile, freshSession, events);
}

// ── Initialise ────────────────────────────────────────────────────────────────

/** Populate PERSONA_AGENTS / CONCIERGE_AGENT_ID from the generated manifest. */
async function loadAgentConfig() {
  try {
    const configRes = await fetch('/context/agents.generated.json');
    const config = await configRes.json();
    PERSONA_AGENTS = config.personaAgents ?? {};
    CONCIERGE_AGENT_ID = config.conciergeAgentId ?? null;
  } catch (err) {
    console.warn('[context-engine] Could not load agents.generated.json:', err.message);
  }
}

/**
 * Count the visit once per session, then materialise the persona profile now
 * rather than on the first question, so the stored record is complete and
 * inspectable from the moment the page loads.
 */
function initVisitorProfile() {
  const profile = loadProfile();
  const session = loadSession();
  const isNewSession = session.pages.length === 0 && session.startedAt > Date.now() - 5000;
  if (isNewSession) {
    profile.visits = (profile.visits ?? 0) + 1;
    saveProfile(profile);
  }
  return ensurePersonaProfile(profile);
}

function startTracking() {
  trackPageView();
  trackScrollDepth();
  trackCTAClicks();
  recordPageDwell();
}

/**
 * Once the element is defined it buffers calls internally, so there's no need
 * to wait for its React tree to mount. Bounded so a failed widget script can't
 * deadlock init.
 */
function waitForWidgetDefinition() {
  return Promise.race([
    customElements.whenDefined('algolia-chat'),
    new Promise((r) => setTimeout(r, WIDGET_DEFINITION_TIMEOUT_MS)),
  ]);
}

/** Re-apply the persona saved from a previous page. */
function restoreSavedPersona(profile) {
  if (!profile.persona || profile.persona === 'auto') return;
  const opt = PERSONA_OPTIONS.find((o) => o.key === profile.persona);
  getWidget()?.setPersona(PERSONA_AGENTS[profile.persona] ?? null, opt?.label ?? profile.persona);
}

async function init() {
  await loadAgentConfig();

  const profile = initVisitorProfile();

  startTracking();

  // Inject the persona dropdown, and keep it clear of the docked chat panel
  buildPersonaDropdown(profile.persona ?? 'auto');
  watchChatOpenState();

  await waitForWidgetDefinition();

  // Hand the tracked profile / pages / events to the widget, so the agent
  // answering the visitor's questions works from the same context the
  // concierge uses to greet them.
  shareVisitorContextWithWidget();
  restoreSavedPersona(profile);

  // Fast path — if a previous page's concierge call left a greeting in the
  // cache, show it immediately and skip the API call entirely.
  if (showCachedGreeting()) {
    console.log('[context-engine] Engaged from cache — skipping concierge call');
    return;
  }

  // Otherwise run the analysis immediately. The FAB shows a spinner for the
  // duration; if the visitor navigates before it resolves, the greeting is
  // cached and shown instantly on the next page.
  const freshSession = loadSession();
  const freshEvents = loadEvents();
  console.log(
    '[context-engine] Starting proactive analysis. profile:',
    profile,
    'session pages:',
    freshSession.pages.length,
    'events:',
    freshEvents.length,
  );
  void runProactiveAnalysis(profile, freshSession, freshEvents);
}

init();

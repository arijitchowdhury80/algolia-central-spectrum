# SESSION.md — Algolia-Central-Spectrum (ACS)

## ═══ STATUS (2026-07-03): ✅ DONE + DEMO-READY. No blocking work. ═══
**Parts 1–2 built + verified end-to-end in a real browser.** ACS chat (Adobe logo + real Adobe Clean font + Spectrum colors + powered-by-Algolia footer) → grounded source cards → visible Generic→Technical handoff → live @lab/judge verdict (e.g. 9.7/10 GROUNDED). Index `ACS_SPECTRUM_MULTI` = **358 records** (SpectrumDesignDocs 103 / ReactSpectrumS2 111 / **ReactSpectrumV3 144** — V3 topped up 95→144 on 2026-07-03; react-aria removed). Framework artifacts in `Algolia-Central-Artifacts/` (PLAN.md, UI/ template + new-instance.mjs, skill/ crawler, judge/).

### ▷ UX REWORK (2026-07-03) — auto-handoff KILLED → human-gated deep-dive (RC2 alignment)
Arijit flagged the build diverged from RC2: it auto-fired a Generic→Technical two-agent relay on every answer, exposed "Generic/Technical" chips, and put the judge front-and-centre. Dispatched a read of `RAG/AlgoliaRAG-Google/rc2-algolia`+`rc3-phoenix`: RC2 = ONE streaming answer + a **human-gated** specialist deep-dive (user clicks "Proceed to Deep Dive"), NO visible judge, front agent on gemini-2.5-flash-lite. **Fixed in `web/` + browser-verified:**
- `useChat.ts`: no more auto-run. On the handoff sentinel it sets `deepDiveOffered`; new `runDeepDive()`/`declineDeepDive()`. Specialist runs ONLY on user click.
- New `DeepDivePrompt.tsx` consent card (Arijit's copy): "For this topic, our code specialist can go deeper… Want me to bring them in?" [Yes, go deeper]/[No thanks].
- `ChatMessage.tsx`: dropped the `AgentBadge` chips — one assistant answer; `HandoffMarker` relabelled "<specialist> deep dive" for the opted-in leg. Instance labels → `Assistant`/`code specialist`.
- `RightPanel.tsx`: judge `collapsed` defaults **true** (async, on-demand — never blocks/dominates; the answer never awaited the judge anyway).
- **Verified live** (chrome): code Q → one grounded streaming answer → offer card (NO auto-2nd-answer) → click Yes → "code specialist deep dive" divider + real `@react-spectrum/s2/ComboBox` code. Build clean (tsc+vite, 51 modules).
- **DONE since:** (a) front agent `ACS-generic-neural` → **gemini-2.5-flash-lite** (via new `scripts/agents/update_agent_model.mjs`; live, fast, grounds+refuses). (b) **Logo click = reset session** (`useChat.reset()` + `AppHeader` button; verified). (c) **FINAL corrected root cause of the "empty answer" (I was wrong twice — it was ME, not flash-lite):** a node `fetch`+`await res.text()` on the STREAMING completions response intermittently truncated the body to empty. Proof: same fresh queries via **curl+grep** = 0/8 empty on flash-lite; my node harness ~1/8. Those false empties then got **cached** by Agent Studio (identical `messageId` on repeats) and poisoned the browser sample button. **flash-lite is stable — keep it.** Full write-up + testing rules in `AUTONOMOUS-LAUNCH-PLAYBOOK.md` §7 (test completions with curl or a streaming reader, never node `res.text()`; never hammer one query). (d) **Deep-dive sentinel fix:** front agent wasn't emitting `[[HANDOFF:technical]]` on flash-lite (judgment-heavy rule); rewrote `instructions_generic.md` HANDOFF SIGNAL to a hard trigger + pushed → 3/3 fresh impl queries now emit it (offer fires). (e) reworded the ComboBox sample question to escape the poisoned cache entry.
- **Still deferred (Agent Studio prompt edits):** reword front-agent instruction that says "the Technical agent can…"; drop dead `OR "ReactAria"` filter clause; consider strengthening flash-lite's synthesis+sentinel instructions. All in `Algolia-Central-Artifacts/AUTONOMOUS-LAUNCH-PLAYBOOK.md` §7.

### ▷ V3 CORPUS TOPPED UP (2026-07-03 04:16 UTC) — 95→144, the "deepen V3" polish item CLOSED
Completed the pending V3 crawl. **Scout was NOT needed** — react-spectrum.adobe.com/v3/*.html is server-rendered, so plain `curl` gets full `<main>` content. Ran the existing free tool: `node scripts/crawler/crawl_html.mjs --seed https://react-spectrum.adobe.com/v3/index.html --scope /v3/ --source ReactSpectrumV3 --index ACS_SPECTRUM_MULTI --max 300`. BFS reached exactly 144 pages (median 15k ch, 0 empty) — matches the historical full crawl. Added deeper pages: theming, testing, ssr, routing, releases/*.
- **objectID gotcha (why I deleted-then-repushed):** the old 95 V3 records had auto-generated **hash objectIDs** (Scout re-ingest let Algolia assign them), but `crawl_html.mjs` uses **path objectIDs** (`ReactSpectrumV3/v3/X.html`). Same URL, different ID → would DUPLICATE. So: backed up 95 (`scratchpad/v3-old-95-backup.json`, in the throwaway session scratchpad) → `deleteByQuery filters=source:ReactSpectrumV3` → pushed 144 fresh. Verified: 144 records, 144 unique urls, **0 dupes**. Keyword smoke passed (ssr/theming/testing return the new pages top-ranked with real bodies).
- ⚠️ **Neural re-embed:** the ~49 new records are keyword-live NOW but need Algolia to re-embed for neuralSearch — semantic hits on the new deep pages lag ~a bit. Keyword unaffected.

### ▷ SCOUT KEY FIXED (2026-07-03) — root cause was REVOCATION, not credits
SESSION.md previously said "reactivate the Scout tenant to deepen V3." **That diagnosis was wrong.** Real cause: the ACS Scout key (`arijit-internal-apps@chowmes.internal`, "Arijit internal apps key") was **REVOKED** server-side (`hosted_api_keys.status='revoked'` on the VPS), likely swept up in the Jul-3 launch/load-test key rotation — despite **1477 std credits still on it**. That's why Scout returned `403 "API key is not active"` (matches `account_service.py:235-238`). Provisioned a **fresh** hosted key via `Scout/scripts/scout-hosted-admin generate-api-key --email acs-adobe-demo@chowmes.internal --name "ACS Adobe Demo" --key-name "ACS Spectrum crawl key" --plan hosted_beta_pass` → 100 std credits, `/v1/hosted/me` returns 200 active. **ACTION FOR ARIJIT:** the new `scout_live_…` key is NOT yet written to `web/.env.local`/`.env.local` (env-file writes are permission-blocked for me) — paste it as `SCOUT_HOSTED_API_KEY` to replace the revoked one. The 1477 credits stay stranded on the revoked key unless you run one SQL `UPDATE hosted_api_keys SET status='active'` on the VPS.

**RESUME FIRST (next session):** 1) read this file top-to-bottom + `Algolia-Central-Artifacts/BUILD-STATUS.md`. 2) Run app: `cd web && npm run dev` (:5173) + `cd lab/server && npm run judge:serve` (:8788). Search key already in `web/.env.local`. 3) Only OPTIONAL polish remains (below).

**NOT done (explicit — no false completion):** Part 3 operator screen (spec-only, not built); ~~V3 depth~~ ✅ DONE (95→144, 2026-07-03); new Scout key not yet pasted into `.env.local` (see SCOUT KEY FIXED above); Technical agent's live source-filter still has a dead `OR "ReactAria"` clause (cosmetic; needs Agent Studio edit); own Adobe Fonts kit for public deploy (font hotlinks Adobe CDN now); `lab/eval` offline judge scoring-map bug (live path unaffected); nothing git-committed yet (web/, lab/, docs, Artifacts all untracked).

**Sections below = full session history (append-only, newest first).**

_Created 2026-07-01 (session 1). Fork of Algolia-Central2 for Adobe as prospect. Agent namespace `ACS-`._

## WHAT THIS IS
AC2 architecture (strictly-grounded neural agent panel) rebuilt on an **Adobe Spectrum** corpus. See `CLAUDE.md`. Base repo to port from: `~/Dropbox/AI-Development/RAG/Algolia-Central2`.

## STATUS (session 1)
**Corpus INGESTED — Adobe-Spectrum sources in ONE federated index `ACS_SPECTRUM_MULTI`** (app `0EXRPAXB56`). **357 recs**, facet `source`:
- `SpectrumDesignDocs` = 103 — GitHub `adobe/spectrum-design-data/docs/s2-docs` (design guidance; median 4,740ch). `ingest_git_docs.mjs`.
- `ReactSpectrumS2` = 104 — `react-spectrum.adobe.com` S2 (code/API; median 4,866ch) via `llms.txt` + `.md` twins. `ingest_site.mjs`.
- `ReactAria` = 150 — `react-aria.adobe.com` (React Aria headless + internationalized + blog; median 10,025ch) via `llms.txt` + `.md`. `ingest_site.mjs` (body capped 90KB — Algolia 100KB record limit; batch chunk 50).
- **REMAINING (not yet in):** React Spectrum **v3** (~96 pages, `/v3/*.html`) — no `.md` twins → needs an HTML self-fetch path (not built). It's the legacy version; decide if worth adding (overlaps S2).

## KEY LEARNING (drove the whole session)
**Native Algolia Crawler CANNOT crawl a domain you don't own** — `internet.custom.domainAllowed` 400, no API to add a domain (dashboard-only ownership verify). So prospect corpora (adobe.com, github.com) MUST be **self-fetched + pushed via the indexing API** (no domain gate on indexing). This forked the tooling into 3 engines. [[feedback-crawler-domain-allowlist-gate]] · AC2 RUNBOOK #17.

## SKILL BUILT (this session)
`~/.claude/skills/algolia-content-fetch/` — SKILL.md + 3 bundled engines + `crawler-runbook.md`:
- `provision.mjs` — one-click NATIVE crawler for OWNED domains (auto-detects JS-render + sitemap; pre-checks domain allow-list).
- `ingest_git_docs.mjs` — git markdown docs → index.
- `ingest_site.mjs` — un-owned docs site self-fetch (prefers `llms.txt` + `.md` twins).
Tested live on both Spectrum sources. Registered + discoverable.

## AGENTS — GENERIC + TECHNICAL, BUILT + VERIFIED (session 1)
Decision (Arijit): 2 agents = **Generic** (front door, all sources) + **Technical** (React code). NOT designer/developer (that earlier split retired). Live on app `0EXRPAXB56` (gemini-2.5-pro):
- `ACS-generic-neural` — NO source filter (sees all 502). Fronts, synthesizes design+code, routes deep code → Technical.
- `ACS-technical-neural` — `source:"ReactSpectrumS2" OR "ReactSpectrumV3" OR "ReactAria"` (React code, version-aware S2 vs v3).
Smoke PASSED: Generic synthesizes design+availability, routes to Technical; Technical gives real S2 code (controlled ComboBox, `@react-spectrum/s2/ComboBox`). Neural cross-source grounding verified. Artifacts: `scripts/agents/{_shared_grounding_acs,instructions_generic,instructions_technical}.md` + `build_acs_agents.mjs` (clone-base self-hosted = ACS-generic-neural).
**Cleanup:** retired ACS-designer/developer + 4 AC2 leftovers (allsource/bruno/elena/maverick). AC2's live 3-panel (general/developer/marketer3) left intact.

## HTML CRAWLER added
`scripts/crawler/crawl_html.mjs` — BFS HTML self-fetch for un-owned sections with no `.md` twins (used for /v3/ + /releases/). Extracts `<main>`/`<article>`, caps 90KB, chunks 50.

## NEURAL — LIVE ✅
`ACS_SPECTRUM_MULTI` `mode: neuralSearch` (enabled via dashboard Train after `seed_and_enable.mjs` pushed 1,099 events; aggregation took ~1 session to land). NL queries that returned 0 on keyword now work semantically: "let users pick a date"→DatePicker, "show a loading indicator"→Progress bar. Panel auto-upgraded (same index/tool). Verified end-to-end: Developer answers "date range in React"→`DateRangePicker` + real code + `@internationalized/date` (cross-source neural grounding).

## JUDGE HARNESS — PORTED, runs e2e; scoring bug open (session 1)
`lab/judge` (@lab/judge, unchanged from AC2) + `lab/eval` (ACS runner). Uses AC2's Gemini key (`GOOGLE_API_KEY`, copied). Runs end-to-end (askAgent captures retrieved body from tool frames → judge panel → gate → summary). **BUT scores uniformly ~1/10 = a scoring/parse-mapping BUG (not the agents): correct refusal scores 0.00; real-body vs title barely moved mean 1.15→1.04.** Next: debug pass (dump `judgments[].dimensions[].score` + raw judge output; probe must be ESM inside lab/eval w/ absolute env path). P2b calibration gates trust regardless. See `lab/eval/README.md`.

## UI — ALREADY BUILT (prior session, in `web/`, untracked/uncommitted)
Correction to earlier note: the chat UI is NOT a to-do — it EXISTS and is TS-clean + self-reviewed. Full 2-agent chat in `web/` (Vite + React + TS): wire-protocol client `src/lib/agentStudio.ts` (ported from AC2), `lib/agents.ts` config, **handoff via sentinel `[[HANDOFF:technical]]`** that Generic appends → UI fires Technical (Generic agent redeployed w/ sentinel, live-verified). Components: Thread/Composer/Message/SourcePills/HandoffDivider/AgentChip/ToolTrace/EmptyState/ErrorCard + `useChat`. tokens.css (CSS vars, light+dark), aesthetic = theme-dashboard (dark-first). Its own workspace: `web/docs/workspace/acs-chat-ui/`.
Still blocked (both sessions): browser smoke test needs the search-only key (below).

## ✅✅ BROWSER SMOKE PASSED (2026-07-02) — Phase 1.6 done, full pipeline verified live
Search key found in `.env.local` (`ALGOLIA_SEARCH_API_KEY=b5807cba…`, search-only confirmed: search 200 / write 403). Wrote `web/.env.local` (VITE_ALGOLIA_APP_ID/SEARCH_API_KEY/JUDGE_URL). Started judge service (`lab/server` :8788) + dev server (`web` :5173); drove the real app via chrome. Query "controlled ComboBox in React Spectrum" → **Generic answered + grounded V3/S2 source cards → sentinel handoff to Technical → Technical returned real `@react-spectrum/s2/ComboBox` code → live judge: Confidence 9.7/10 GROUNDED (Grounding 10 / Coverage 10 / Depth 9 / Relevance 10, 3-judge + rationale).** Everything works: streaming, grounding-from-`a:`-frames, handoff, live judge, Adobe skin, powered-by-Algolia footer. THE BUILD IS DONE. (Dev server + judge service may still be running in background — app at localhost:5173.)

## ✅ VISUALS FIXED (2026-07-02): real Adobe logo + real Adobe font
- Logo: `web/public/brand/adobe-logo.svg` = the Adobe red-A mark (Arijit's reference). Earlier "broken" = a `--` double-hyphen inside the placeholder's XML comment broke SVG parsing (naturalWidth 0). [[feedback-svg-xml-comment-double-hyphen]]
- Font: **real Adobe Clean Spectrum** now loads. Adobe uses `adobe-clean-spectrum-vf` (variable 100–900) from the Adobe Fonts CDN (`use.typekit.net`) on react-spectrum.adobe.com. Mirrored those exact `@font-face` rules into `web/src/themes/spectrum.css` + put it first in `--ac-font-sans`. Loads cross-origin onto localhost. ⚠️ hotlinks Adobe's licensed kit CDN — fine for internal demo; production needs own Adobe Fonts web project. Falls back to Source Sans 3 if referrer-locked.

## ⚠️ CORPUS RE-INGESTED via SCOUT (2026-07-02) — index changed 502→309
Arijit corrected the sources: the old index had WRONG sources (react-aria, v3-from-old-crawl). Re-ingested `ACS_SPECTRUM_MULTI` **natively via hosted Scout** from the 2 authoritative roots. Now **309 records**, facet `source`:
- `SpectrumDesignDocs` 103 — GitHub `adobe/spectrum-design-data/docs/s2-docs` (recursive `.md`, scraped via Scout).
- `ReactSpectrumS2` 111 — react-spectrum.adobe.com (llms.txt list).
- `ReactSpectrumV3` 95 — react-spectrum.adobe.com/v3 (nav-link discovery; ~48 deep sub-pages NOT captured, old had 144; 1 page `workflow-icons` failed).
- **react-aria (150) + releases (1) REMOVED.**
Push method: backup→clear(keeps settings: neural+facet)→batch 309→verify. **No dupes** (309 = source sum). Old 502 backed up: `scratchpad/index-backup-502.json`.
**Scout hosted:** `https://scout.chowmes.com`, `Authorization: Bearer $SCOUT_HOSTED_API_KEY` (in `.env.local`), endpoints `/v1/hosted/{scrape,crawl,me}`; scrape 1 std-credit/page, `use_js:false` works. ⚠️ **Scout key went INACTIVE mid-run** (403 "API key is not active") — reactivate the Scout tenant to deepen V3 / re-scrape. Neural may need a moment to re-embed the new records.
Re-ingest driver = `scratchpad/push_corrected.py` (needs `ssl._create_unverified_context()` — proxy self-signed cert blocks Python's default verify; curl tolerates it).

## ✅ BUILD DONE (2026-07-02) — Parts 1–2 built + verified; one hold
Status record: `Algolia-Central-Artifacts/BUILD-STATUS.md`. Built via /goal from PLAN.md.
- Part 1: chat (`web/`, Adobe-Spectrum skin, ported client + sentinel handoff) + live judge (service `lab/server/`, UI RightPanel/JudgePanel). Build clean; judge live-tested end-to-end (minus browser).
- Part 2: `Algolia-Central-Artifacts/` = `UI/` template + `new-instance.mjs` (swap proven via throwaway Acme build), `skill/` crawler (extended), `judge/` artifact (package+service).
- **HOLD = browser smoke (1.6):** needs a search-only key for `ACS_SPECTRUM_MULTI` → `web/.env.local` `VITE_ALGOLIA_SEARCH_API_KEY`. Can't read AC2 env (perm); ACS admin key can't mint. Arijit pastes a key, then run dev + `lab/server` judge:serve.
- Old plain-CSS chat archived at `web/_legacy_plaincss/`.

## ▶ AUTHORITATIVE BUILD PLAN (2026-07-02)
`~/Dropbox/AI-Development/RAG/Algolia-Central-Artifacts/PLAN.md` — the `/goal`-ready plan for the whole framework (Part 1 ACS screen chat+judge Algolia-skinned · Part 2 template + crawler skill in `Algolia-Central-Artifacts/` · Part 3 operator launcher, future). Grounded on 3 parallel readers (RC3 screen map, Algolia design-token extraction, crawler skill audit). Key facts: RC3 = `RAG/AlgoliaRAG-Google/rc3-phoenix` (two-column chat + resizable right panel; **NO live judge — we build it**); Algolia tokens = ready CSS-var file in the design-system zip (Sora, `#003DFF`); stack = Vite+React+TS+Tailwind+shadcn. Execute Parts 1–2 via `/goal` against that PLAN.

## ▶ RESUME ACTION — REFACTOR the working app into a DESIGN SYSTEM (Arijit, 2026-07-02)
New direction: ACS UX = **templatizable Algolia-Central framework**. TWO-LAYER: structure (ours, fixed) + skin (client's design system, swappable). Every future `Algolia-Central-[company]` re-applies the same structure with a new skin. Plan (see `docs/workspace/ac-chat-ux/`):
1. Generalize `tokens.css` → frozen `--ac-*` token contract (= the API to any client skin).
2. `src/themes/` — `framework.css` (house default) + `spectrum.css` (Adobe skin: overrides token VALUES only). Load skin per instance.
3. `src/config/` — extract every Spectrum string (title, source-facets, sample Qs, agent labels) into a typed `InstanceConfig`. New company = new config + theme.css, zero structural edits.
4. Components read `var(--ac-*)` + `useInstance()` only.
5. `themes/theme.template.css` + README = the "apply Adobe Spectrum (zip)" contract.
6. Consolidate the two workspaces (`ac-chat-ux` root ↔ `web/.../acs-chat-ui`).

## OPEN DECISIONS (asked Arijit; he stepped away — re-ask)
1. **Search-only key source** (blocks browser test only): (a) mint in dashboard + paste [recommended], (b) give true admin key w/ key-mgmt ACL (the `ALGOLIA_ADMIN_API_KEY` in `.env.local` reads fine but CANNOT create keys — 403), (c) reuse AC2's existing browser key. Add result as `VITE_ALGOLIA_SEARCH_API_KEY` in `web/.env.local`.
2. **Spectrum skin look:** (a) authentic Adobe light — Adobe Clean font, Spectrum blue `#1473E6`, tight radii [recommended, best proves the client-skin thesis], (b) keep dark dashboard, (c) both — dark = framework default, light Adobe = the skin.

Agent IDs: Generic `13809d4b-6b6d-4297-b95c-a934bceef0b4` · Technical `63ab0c86-3493-416b-a771-a820ab25d83d`.
Also open (non-blocking): judge scoring-bug debug pass; snapshot refresh cadence; app/index isolation.

## PROTOCOL READ-RECEIPT (Agent Studio streaming) — locked
`docs/workspace/ac-chat-ux/00-protocol-read-receipt.md`. Endpoint `POST https://{APP}.algolia.net/agent-studio/1/agents/{AGENT_ID}/completions?compatibilityMode=ai-sdk-4`; browser cred = search-only key; SSE frames `0:`text `9:`toolcall `a:`hits(=grounding) `3:`error. Source cards render ONLY from `a:` frames.

## CONCERNS (logged)
- Design-docs = point-in-time offline archive (drifts); citation URL = GitHub blob not a live doc page.
- react-spectrum overlaps design-docs on component names → argues for the 2-persona split.
- Third-party ToS: internal demo/eval only, don't republish.

## FILES
- `scripts/crawler/{provision,ingest_git_docs,ingest_site}.mjs` · `.env.local` (4 creds from AC2, gitignored) · `data/` (cloned repo, gitignored)
- Vault: `Projects/algolia-central-spectrum/` (index, overview, open-questions, log)

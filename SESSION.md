# SESSION.md — Algolia-Central-Spectrum (ACS)

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

## ▶ RESUME ACTION (next session) — UI (the one remaining ask)
Build via `frontend-builder` (design-thinking first, per CLAUDE.md). Shape = **fresh minimal chat** (Arijit): 2-agent (Generic + Technical), streaming, grounded source cards, Generic→Technical handoff made visible.
**BLOCKERS to clear first:**
1. **Mint a browser-safe SEARCH-ONLY Algolia key** for `ACS_SPECTRUM_MULTI` — the browser must NEVER get the admin key currently in `.env.local`. Add as `ALGOLIA_SEARCH_API_KEY` (browser-shippable).
2. Agent IDs: Generic `13809d4b-6b6d-4297-b95c-a934bceef0b4` · Technical `63ab0c86-3493-416b-a771-a820ab25d83d`.
3. Reference: AC2 `web/` (Vite chat+judge app) for the Agent Studio streaming client pattern.
Also open (non-blocking): judge scoring-bug debug pass; snapshot refresh cadence; app/index isolation.

## CONCERNS (logged)
- Design-docs = point-in-time offline archive (drifts); citation URL = GitHub blob not a live doc page.
- react-spectrum overlaps design-docs on component names → argues for the 2-persona split.
- Third-party ToS: internal demo/eval only, don't republish.

## FILES
- `scripts/crawler/{provision,ingest_git_docs,ingest_site}.mjs` · `.env.local` (4 creds from AC2, gitignored) · `data/` (cloned repo, gitignored)
- Vault: `Projects/algolia-central-spectrum/` (index, overview, open-questions, log)

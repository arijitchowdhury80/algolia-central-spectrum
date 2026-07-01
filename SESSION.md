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

## ▶ RESUME ACTION (next session) — JUDGE PORT + UI
1. **Judge eval harness port** (scoped, ready to build). AC2's `@lab/judge` is self-contained (one seam: injected `LlmComplete`). Port plan: copy `lab/judge` + `lab/server/src/{gemini,openai,agentRunner,streamParser}.ts` → ACS `lab/`; write an ACS eval runner (question set → `makeAgentStudioRunner(ACS agent)` → `judgeArtifact` w/ Gemini `LlmComplete`). **NEEDS: a judge LLM key in ACS `.env.local` (`GEMINI_API_KEY`)** — none present yet. **Judge output is INDICATIVE until P2b calibration** (the standing trust gate, carries from AC2).
2. **UI** — routes through `frontend-builder` (per CLAUDE.md). AC2's `web/` is a full chat+judge Vite app; decide: adapt it (repoint to ACS agents/index) vs fresh minimal 2-agent chat demo. Needs aesthetic/shape direction.
3. Refresh cadence for both snapshots (design docs = Feb-2026 archive; react-spectrum live).
4. Decide app/index isolation (currently shares CENTRAL `0EXRPAXB56`; open-q #1).

## CONCERNS (logged)
- Design-docs = point-in-time offline archive (drifts); citation URL = GitHub blob not a live doc page.
- react-spectrum overlaps design-docs on component names → argues for the 2-persona split.
- Third-party ToS: internal demo/eval only, don't republish.

## FILES
- `scripts/crawler/{provision,ingest_git_docs,ingest_site}.mjs` · `.env.local` (4 creds from AC2, gitignored) · `data/` (cloned repo, gitignored)
- Vault: `Projects/algolia-central-spectrum/` (index, overview, open-questions, log)

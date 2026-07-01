# SESSION.md — Algolia-Central-Spectrum (ACS)

_Created 2026-07-01 (session 1). Fork of Algolia-Central2 for Adobe as prospect. Agent namespace `ACS-`._

## WHAT THIS IS
AC2 architecture (strictly-grounded neural agent panel) rebuilt on an **Adobe Spectrum** corpus. See `CLAUDE.md`. Base repo to port from: `~/Dropbox/AI-Development/RAG/Algolia-Central2`.

## STATUS (session 1)
**Corpus INGESTED — both Adobe-Spectrum sources live in ONE federated index `ACS_SPECTRUM_MULTI`** (app `0EXRPAXB56`, keyword mode):
- `SpectrumDesignDocs` = 103 recs — GitHub `adobe/spectrum-design-data/docs/s2-docs` (design guidance; median body 4,740ch). Cloned to `data/` (gitignored), ingested via `ingest_git_docs.mjs`.
- `ReactSpectrumS2` = 104 recs — `react-spectrum.adobe.com` (code/API docs; median 4,866ch), self-fetched via `ingest_site.mjs` using the site's `llms.txt` + clean `.md` twins.
- Total 207 recs. Cross-source keyword search works ("color swatch" → both sources). Facet `source`.

## KEY LEARNING (drove the whole session)
**Native Algolia Crawler CANNOT crawl a domain you don't own** — `internet.custom.domainAllowed` 400, no API to add a domain (dashboard-only ownership verify). So prospect corpora (adobe.com, github.com) MUST be **self-fetched + pushed via the indexing API** (no domain gate on indexing). This forked the tooling into 3 engines. [[feedback-crawler-domain-allowlist-gate]] · AC2 RUNBOOK #17.

## SKILL BUILT (this session)
`~/.claude/skills/algolia-content-fetch/` — SKILL.md + 3 bundled engines + `crawler-runbook.md`:
- `provision.mjs` — one-click NATIVE crawler for OWNED domains (auto-detects JS-render + sitemap; pre-checks domain allow-list).
- `ingest_git_docs.mjs` — git markdown docs → index.
- `ingest_site.mjs` — un-owned docs site self-fetch (prefers `llms.txt` + `.md` twins).
Tested live on both Spectrum sources. Registered + discoverable.

## 2-PERSONA PANEL — BUILT + VERIFIED (session 1)
Live on app `0EXRPAXB56` (gemini-2.5-pro), scoped via `searchParameters.filters` on `source`:
- `ACS-designer-neural` — `source:"SpectrumDesignDocs"` (design guidance).
- `ACS-developer-neural` — `source:"ReactSpectrumS2"` (React code/API).
Smoke-test PASSED: Designer gives grounded design guidance; routes code Qs → Developer ("hand you over"); Developer answers with real `onPress`/`@react-spectrum/s2/Button` code. Handoff = prompt doctrine (no native handoff tool). Artifacts: `scripts/agents/{_shared_grounding_acs,instructions_designer,instructions_developer}.md` + `build_acs_agents.mjs`. Clone-base = `ac2-developer-neural`.

## NEURAL — seeded, flip PENDING
`scripts/neural/seed_and_enable.mjs`: pushed **1,099 relevance-faithful events** (650/660 Spectrum queries hit). `PUT mode:neuralSearch` still returns **412 "SemanticSearch: no events"** — aggregation is async + slow. Two ways to finish (either works): (a) re-run `node scripts/neural/seed_and_enable.mjs enable` later once aggregation lands; (b) **dashboard Train NeuralSearch** (event source=`ACS_SPECTRUM_MULTI`, title attr, Blended, More Recall) — same manual flow AC2 used. Panel runs keyword until it flips, then auto-upgrades (same index/tool).

## ▶ RESUME ACTION (next session)
1. **Finish neural** — re-run `enable` (or dashboard Train). Verify `mode:neuralSearch`, then re-smoke the panel on NL queries ("how do I…") that currently fail on keyword.
2. **Judge/eval** — port AC2's harness to score the ACS panel (P2b calibration gate carries over).
3. Refresh cadence for both snapshots (design docs = Feb-2026 archive; react-spectrum live).
4. Decide app/index isolation (currently shares CENTRAL `0EXRPAXB56`; open-q #1).

## CONCERNS (logged)
- Design-docs = point-in-time offline archive (drifts); citation URL = GitHub blob not a live doc page.
- react-spectrum overlaps design-docs on component names → argues for the 2-persona split.
- Third-party ToS: internal demo/eval only, don't republish.

## FILES
- `scripts/crawler/{provision,ingest_git_docs,ingest_site}.mjs` · `.env.local` (4 creds from AC2, gitignored) · `data/` (cloned repo, gitignored)
- Vault: `Projects/algolia-central-spectrum/` (index, overview, open-questions, log)

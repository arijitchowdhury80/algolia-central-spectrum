# CLAUDE.md — Algolia-Central-Spectrum (ACS)
# Read at session start. Identity, rules, pointers. Detail lives in SESSION.md, memory, and the docs below.
# Global ~/.claude/CLAUDE.md still applies. Keep this thin — a pointer, not a manual. A stale CLAUDE.md is a bug.

## WHAT THIS IS
A **fork of Algolia-Central2 (AC2)** — the same strictly-grounded, neural conversational agent architecture — but rebuilt for **Adobe as the prospect**. Corpus = Adobe / Spectrum content instead of Algolia's own. Purpose: a demo/sales instance that shows the AC2 grounded-agent panel running on a prospect's own docs.
- **This repo:** `~/Dropbox/AI-Development/RAG/ALgolia-Central-Spectrum` (note dir has a capital-L typo `ALgolia`). Remote: TBD.
- **Base repo it forks (read for architecture):** Algolia-Central2 at `~/Dropbox/AI-Development/RAG/Algolia-Central2`. Do not re-derive the AC2 patterns — port them.
- **Corpus source (to confirm):** `https://algolia-central.vercel.app/docs` (Spectrum repos, per Arijit 2026-07-01) + Adobe/Spectrum documentation. Exact ingest target is an OPEN question — see SESSION.md.

## AGENT NAMESPACE (hard)
- **All agents in THIS project are prefixed `ACS-`** (Algolia-Central-Spectrum). Keeps them disjoint from AC2's `ac2-*` set in Agent Studio.
- Mirror the AC2 3-agent panel: `ACS-general-neural` / `ACS-developer-neural` / `ACS-marketer-neural` (persona + disjoint source clubbing), unless the Adobe corpus dictates a different split.

## WHO ARIJIT IS (how to partner)
Equal partner, never a yes-man. Challenge before agreeing; debate to the right answer.
Full contract: vault `Projects/ArijitOS/Operating-Principles.md` + `About-Arijit.md`.

## CROSS-PROJECT AWARENESS
Portfolio index: vault `Projects/ArijitOS/My-Projects.md` (read on demand for other projects).
This project's wiki: vault `Projects/algolia-central-spectrum/`. Sibling: `Projects/algolia-central2/` (the base).
Vault base: `~/Dropbox/AI-Development/Obsidian/Arijit-Second-Brain/`.

## STANDING RULES (hard — inherited from AC2)
- **110% grounded.** Every factual claim traceable to the index, or it doesn't ship. No training-data facts. No answer in index → strict refuse + route. Grounding enforced by the agent's own hardened instructions + verified via the bait-query harness — NOT custom client code.
- **Never hardcode keys** — read `.env.local`. Browser ships a search-only key; admin/inference keys are server/script-only.
- **Verify grounding via stream frames** (`9:`/`a:` tool frames), not cited-looking prose — a cited URL ≠ a search happened.
- Judge stays uncalibrated until P2b passes (inherited gate) → running any loop in *trust* mode = Goodhart. Score only after calibration.
- Never claim done without running verification and showing output. Evidence on every data point. Write decisions to disk.

## OPEN QUESTIONS (decide before building agents — see SESSION.md)
- **Algolia app/index:** reuse CENTRAL app `0EXRPAXB56` with an Adobe index + `ACS-` agents, or a fresh app? (namespace vs. isolation)
- **Ingest path:** hand-built crawler-army (as AC2) over `algolia-central.vercel.app/docs`, OR **Algolia DocSearch MCP** (`mcp.algolia.com/1/docsearch/mcp`, NeuralSearch, curated DocSet) as the retrieval layer. DocSearch offloads crawl+index+retrieval; it does NOT replace the grounded-agent + judge layer. Pilot before committing.
- Source clubbing / persona split for the Adobe corpus (may differ from AC2's 9 sources).

## VERIFICATION (fork of AC2 — confirm once ported)
- Agent grounding: bait-query harness must show no leak (port AC2's `agent_admin.mjs bait` pattern to `ACS-` agents).
- Any judge/eval suites ported from AC2 (`lab/server`, `web`).

## KEY POINTERS
- **`SESSION.md`** — this-session state, ▶ RESUME, exact stop point. Read first every session.
- Memory: `~/.claude/projects/<this-slug>/memory/` (MEMORY.md index) once initialized.
- **AC2 as reference:** `~/Dropbox/AI-Development/RAG/Algolia-Central2/` — its `CLAUDE.md`, `scripts/setup/honed/` (3-agent build: `build_three_agents.mjs`, `instructions_{general,developer,marketer3}.md`, `_shared_grounding.md`), and `docs/experiment/2026-07-01-adr-three-agent-rationalization.md`. Port, don't reinvent.
- **THE NEXT STEP:** decide the OPEN QUESTIONS above (app/index, ingest path, persona split), then port the AC2 3-agent build with `ACS-` prefix onto the Adobe corpus.

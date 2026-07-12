# CLAUDE.md — Algolia-Central-Spectrum (ACS)
# Read at session start. Identity, rules, pointers. Detail lives in SESSION.md, memory, and the docs below.
# Global ~/.claude/CLAUDE.md still applies. Keep this thin — a pointer, not a manual. A stale CLAUDE.md is a bug.

## WORKING ROOT
This folder is the working root: `~/Dropbox/AI-Development/RAG/Algolia-Central-Spectrum`. Launch `claude` from here so this file + this project's memory are authoritative every session (even after `/clear`). Remote: TBD.

## WHAT THIS IS
A **fork of Algolia-Central2 (AC2)** — the same strictly-grounded, neural conversational agent architecture — rebuilt with **Adobe (Spectrum) as the prospect**. Corpus = Adobe/Spectrum content instead of Algolia's own. Purpose: a demo/sales instance that shows the AC2 grounded-agent panel running on a prospect's own docs.
- **Corpus is LIVE:** federated index `ACS_SPECTRUM_MULTI` on app `0EXRPAXB56`, **neural search on**, ~502 recs (SpectrumDesignDocs + ReactSpectrumS2 + ReactSpectrumV3 + ReactAria). Ingested by self-fetch (Algolia Crawler can't crawl un-owned domains — see SESSION.md KEY LEARNING).
- **Base repo it forks (read for architecture, don't re-derive):** AC2 at `~/Dropbox/AI-Development/RAG/Algolia-Central2`. Port its patterns.

## DESIGN-SYSTEM MISSION (Arijit, 2026-07-02)
ACS is the **reference build for a reusable "Algolia-Central" design system** — a framework, not a one-off. Build the UX so the **layout / components / tokens are the templatized part** and the **company corpus + agents are the swappable inputs**. Every future `Algolia-Central-[company]` re-applies the same layout. Design for this from the first component; do not hardcode Adobe/Spectrum branding into the shell.

## AGENT NAMESPACE (hard)
- **All agents in THIS project are prefixed `ACS-`** (keeps them disjoint from AC2's `ac2-*`/`*-neural` set in Agent Studio).
- **Live panel = 3 agents** (added the classifier 2026-07-10; general/developer/marketer split is retired):
  - `ACS-generic-neural` — front door, NO source filter (sees all), synthesizes design+code, routes deep code → Technical. ID `95826da6-d1b6-4b81-b061-bfb52b881356` (PATCH-in-place keeps this stable across rebuilds).
  - `ACS-technical-neural` — `source:"ReactSpectrumS2" OR "ReactSpectrumV3" OR "ReactAria"` (version-aware React code). ID `ae127977-c728-4b7c-bc15-6502a77873d1`.
  - `ACS-classifier-neural` — internal-only, never shown to the user, no search tool. Decides the `SPECIALIST:` deep-dive offer, called synchronously by the client right after Generic answers. ID `dbb4faa9-e917-4be9-b8ee-6dfd9a81daef` (created 2026-07-10, replaces the old native `config.suggestions` mechanism — see STATE below for why).

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

## STATE (detail in SESSION.md)
DONE + verified: corpus ingested & neural-live; 3 agents built, smoke-passed, cross-source grounding verified; `algolia-content-fetch` skill built; judge harness ported (runs e2e). Production handoff mechanism (2026-07-10) = a dedicated `ACS-classifier-neural` agent, called synchronously by the client — REPLACES the old native `config.suggestions` mechanism, which could race Agent Studio's own per-query cache and silently drop the deep-dive offer. Live, stable, browser-verified.
SHELVED, NOT BUILT: a pure-orchestrator design (3rd agent, 2 client-side tools) passed a real E2E test on real data (10/10 both metrics) but was deliberately killed for ACS — once the classifier existed, the orchestrator's routing decision became provably redundant, adding 2 network hops for zero behavior change. Fully specced at `.development-loop/run-2026-07-09-002/04-spec-track-b.md` for Algolia-Central2's port if that project's use case genuinely needs real multi-agent routing.
OPEN: (a) **judge scoring bug** — scores uniformly ~1/10, a parse/mapping bug not the agents; P2b calibration gated regardless. (b) React Spectrum v3 legacy pages — decide if worth the overlap. (c) snapshot refresh cadence. (d) `mandate-guard.sh` vs. auto-mode classifier conflict — CONFIRMED WORSE 2026-07-10: the classifier blocks the hook's own sanctioned self-unlock file write too, no assistant-side workaround exists, every push/deploy needs Arijit to run manually.

## VERIFICATION (fork of AC2 — confirm once ported)
- Agent grounding: bait-query harness must show no leak (port AC2's `agent_admin.mjs bait` pattern to `ACS-` agents).
- Judge/eval suites ported from AC2 (`lab/judge` unchanged, `lab/eval` = ACS runner) — fix scoring bug before trusting scores.

## ▶ STATUS (2026-07-08): real tool-call handoff shipped + live-tested, engagement redesigned. NEXT = react-instantsearch <Chat> swap. — see SESSION.md top block
`[[HANDOFF:technical]]` text sentinel replaced with a real, live-tested Agent Studio `client_side` tool call (`docs/spikes/2026-07-08-agent-to-agent-tool-VERDICT.md`). **The entire chat client is still hand-built** (`web/src/lib/agentStudio.ts` = manual SSE parsing) — zero `react-instantsearch`/`algoliasearch` usage until this session installed the packages (not yet wired). This is the top open item — Arijit's explicit standing instruction: use native Algolia frontend tech, not custom equivalents. On branch `spike/agent-to-agent-tool` (NOT merged to main). Older 2026-07-03 judge-in-chat status below, still accurate for the judge feature itself.

## ▶ (historical) build the UX (design-system framework)
Build via `frontend-builder` (design-thinking first, per global CLAUDE.md). Shape = **fresh minimal chat**: 2-agent (Generic + Technical), streaming, grounded source cards, Generic→Technical handoff made visible. Build it as the **templatizable Algolia-Central layout** (see DESIGN-SYSTEM MISSION).
**Blockers to clear first:**
1. Mint a browser-safe **SEARCH-ONLY** Algolia key for `ACS_SPECTRUM_MULTI` → add as `ALGOLIA_SEARCH_API_KEY`. Browser must NEVER get the admin key in `.env.local`.
2. Reference: AC2 `web/` (Vite chat+judge app) for the Agent Studio streaming client pattern.

## KEY POINTERS
- **`SESSION.md`** — this-session state, ▶ RESUME, exact stop point. Read first every session.
- Memory: `~/.claude/projects/<slug>/memory/` (MEMORY.md index).
- **AC2 reference:** `~/Dropbox/AI-Development/RAG/Algolia-Central2/` — its `CLAUDE.md`, `scripts/setup/honed/`, `web/`. Port, don't reinvent.

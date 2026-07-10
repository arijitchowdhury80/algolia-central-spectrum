# Build document: Generic→Technical handoff architecture — as shipped, and what's next

Status: Phase 0 (fix the offer-caching-race bug) is DONE, shipped, deployed,
live-verified. This document replaces an earlier version that proposed two
tracks (A: inline client-side classification call; B: full pure-orchestrator
with tool-call plumbing) and asked for a decision between them. Neither was
built as specced. What actually shipped is a third design, described below.
This doc now also carries the still-open Phase 1 item: the AC2 port.

---

## 0. What actually shipped (2026-07-10) — for reference, not a to-do

**The bug:** Agent Studio's native `config.suggestions` generates the
`SPECIALIST:` deep-dive offer as a separate, platform-internal async job that
races the platform's own per-query response cache. On some implementation
questions, the cached response wins the race and the offer never appears —
silently, no error, no client-visible signal anything is missing.

**The fix:** a dedicated third agent, `ACS-classifier-neural` (ID
`dbb4faa9-e917-4be9-b8ee-6dfd9a81daef`). It is internal-only — never shown to
the user, no search tool, no memory of prior turns. After Generic answers,
the client calls this agent **synchronously** with one message: the real
question, Generic's real answer text, and the real retrieved hits (JSON).
The classifier returns exactly one line — either `SPECIALIST: <resolved
deep-dive question>` or an ordinary follow-up with no prefix — and the client
derives `deepDiveOffered`/`deepDiveQuery` from that response instead of the
racy `config.suggestions` frame. Full decision logic:
`scripts/agents/instructions_classifier.md`.

This is closer in spirit to the old doc's "Track A" (client-driven, awaited,
no tool-call plumbing) than "Track B" (orchestrator), but implemented as its
own Agent Studio agent rather than an inline classification call inside
`runTurn`. Track B (the pure-orchestrator) was separately built and tested
(10/10 on real data) then deliberately killed once the classifier existed —
full verdict at `.development-loop/run-2026-07-09-002/04-spec-track-b.md`.

**Verified:** live browser click-through, repeated-query acceptance re-test
(the exact condition that used to trigger the caching race), deployed bundle
grep. See `SESSION.md` top block for the full evidence trail.

---

## 1. What's still open — Algolia-Central2 (AC2) port

AC2 currently has three dead/half-built multi-agent generations (Gen 1
Maverick+specialists, Gen 2 Maverick+baton, Gen 3 General/Developer/Marketer)
and a 2×2 comparison-lab UI (`Matrix`/`PanelCell`) that needs to become a
single chat page. The port should carry over **the classifier architecture
above**, not the tool-call/orchestrator design the old doc described — that
design was killed for a reason (redundant once a classifier exists), and
porting a killed design forward would just reproduce the same dead end on a
second project.

### Decisions needed before Build (real product/architecture calls, not
mine to resolve silently — carried over from the old doc, still open):

1. **Agent roster.** Gen 3 already has 3 personas (General/Developer/
   Marketer) live on Agent Studio but wired to nothing in code. ACS's
   pattern is 2 answering agents + 1 invisible classifier. Collapse Gen 3 to
   2 personas, keep 3, or something else — real product decision.
2. **Browser-direct vs. backend-mediated.** ACS calls Agent Studio directly
   from the browser with a search-only key. AC2 currently proxies through a
   Dockerized backend (`lab/server`). Keep AC2's backend-mediation (more
   consistent with its existing posture, more porting work) or go
   browser-direct like ACS (simpler, straight file-port, loses the
   mediation layer)?
3. **What to do with dead code first** (`ChatMessage.tsx` — actually
   resurrect, it's the right shape; `columns.ts`, the 2×2 UI, Gen 1/Gen 2
   code — archive via git tag, don't just delete, per the old doc's own
   recommendation, still sound).

### Task list (unblocked once the 3 decisions above are made)

- **P1.1:** Resolve decisions above with Arijit.
- **P1.2:** Archive dead code (Gen 1/Gen 2, `columns.ts`, 2×2 UI) via a git
  tag (`pre-single-chat-migration`), not deletion — keeps it recoverable.
- **P1.3:** Port the classifier-agent architecture (agent config, the
  synchronous classification call in whatever `runTurn`-equivalent AC2 ends
  up with) per decision #2's chosen topology. Reuse `instructions_classifier.md`
  as the starting prompt, adapted to AC2's actual agent roster from decision #1.
- **P1.4:** Wire `ChatMessage.tsx` + `GroupedSources.tsx` into a new single-chat
  page, replacing `App.tsx`'s panel grid.
- **P1.5:** Fix `build_three_agents.mjs`'s delete+recreate-by-name bug (same
  bug ACS hit and fixed) using ACS's `build_acs_agents.mjs` PATCH-in-place
  pattern, regardless of which agents ship.
- **P1.6:** Port ACS's UI fixes as they apply (list-markdown run-grouping,
  source-badge click-to-fold) into whatever renders alongside `GroupedSources.tsx`.
- **P1.7:** Seed test coverage using REAL captured frames from AC2's own live
  agents, matching ACS's own no-synthesized-fixtures rule.
- **P1.8:** Live browser verification + deploy, bundle-grep verification
  (same method used for every ACS deploy).

### Explicitly not carrying forward from the old doc

- The tool-call/orchestrator plumbing (Track B mechanics: `9:` frame
  handling, resume-call body builder, `call_generalist`/`call_specialist`
  tools) — killed design, do not resurrect for AC2 without a genuine new
  reason (e.g. AC2 needs real multi-agent routing across >2 personas that a
  classifier-style yes/no can't express).
- Phase 0.5 (real follow-up/engagement questions as a separate feature) —
  still unscoped, still deferred, not part of this port.

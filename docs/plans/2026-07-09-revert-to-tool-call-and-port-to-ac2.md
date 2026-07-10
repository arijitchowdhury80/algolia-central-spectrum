# Plan: Revert ACS to tool-call A2A handoff, then port to Algolia-Central2

Status: PLAN ONLY — nothing in this document has been executed. Written per Arijit's explicit decision (2026-07-09 evening): revert ACS's handoff mechanism to the real client-side tool call (built 2026-07-08, retired 2026-07-09), then use the corrected architecture as the template for a from-scratch single-chat build on Algolia-Central2, replacing that project's three dead/half-built multi-agent generations.

Also locked: real follow-up/engagement questions (the agent asking the user something, to keep them engaged) is a SEPARATE feature from the handoff, and must not reuse Agent Studio's `suggestions` config — that config's native purpose is single-turn "you might also ask" chips, and overloading it to smuggle a handoff signal (the `SPECIALIST:` prefix hack) was itself part of what's being reverted.

---

## Phase 0 — ACS: revert the handoff mechanism

### 0.0 Top risk — must be resolved BEFORE this is called done, not assumed

The commit that retired the tool call (`111c8fd`) gives its own reason: *"a tool call preempts an agent's own answer text in the same turn."* The original spike's own evidence (`docs/spikes/2026-07-08-agent-to-agent-tool-VERDICT.md`) backs this up — in 5/5 live test calls, when the model decided to invoke the tool, the stream produced **zero answer text**, just an immediate pause (`9:` tool-call frame only).

This directly conflicts with the requirement: *"the generalist, as it's answering, finishes the answer and then shows the technical expert may benefit."* That exact sequence — full answer first, THEN an offer — was never actually proven in the original spike. The opposite behavior was observed. Reverting to the old code alone will NOT deliver the UX you want; it will reproduce the same "answer text disappears when the tool fires" problem the retirement commit was reacting to.

**This has to be solved as its own task, not skipped:**
- **Option A — two-step completion.** Call 1: ask Generic for its answer with NO tools available at all (forces full text). Call 2: a short, cheap, separate classification call (a Gemini Flash / gemini-flash-lite call, similar cost/shape to what suggestions already does) decides, given the question + the answer just produced, whether a specialist would help — if yes, THIS call is the one that "calls the tool" in a controlled, client-orchestrated way (you already have the specialist's ID and the context; you don't need Agent Studio's own tool-calling machinery to decide this, you can decide it yourself, exactly like Gen 2's original `client_side` tool was going to do, but decoupled from the main answer stream).
- **Option B — prompt-only forcing.** Instruct Generic explicitly: "always write your complete answer as text FIRST; only call `consult_technical_specialist` as the very last thing, after your text is done" — then empirically re-run the same 5-call live spike test the original spike ran, and check whether newer models / explicit ordering instructions change the observed behavior. This is the cheaper option to try first, but is not guaranteed — the original spike didn't test this framing, it just discovered the tool call preempts text and moved on.
- **Do Option B first (fast, cheap, empirical).** If it doesn't hold reliably across a real spot-check (aim for the same 5/5 rigor the original spike used), fall back to Option A.

**Task 0.1:** Re-run a live probe against a disposable `-dev` copy of `ACS-generic-neural`, with the tool registered and an explicit "answer fully in text first, call the tool last" instruction, and confirm whether the same-turn text-then-tool-call ordering actually holds now. Capture raw frames exactly like the original spike did (`docs/spikes/2026-07-08-*` is the format to match). This is empirical, not a documentation lookup — same standard as the original spike.

### 0.1 Recover the known-working code as a starting point

The pre-retirement implementation is real, committed history — not something to rebuild from scratch:
- `5dbdf1e` — the original ship commit (client-side tool, `useChat.ts` tool-call interception, `agentStudio.ts` tool-call frame parsing, `agentConfig.mjs`/`build_acs_agents.mjs` tool schema).
- `docs/spikes/2026-07-08-agent-to-agent-tool-VERDICT.md` + `-findings.md` — the exact API shapes (tool registration, publish step, resume shape) that were reverse-engineered against Agent Studio's real (undocumented) behavior. These are still accurate — Agent Studio's API hasn't changed; re-derive nothing, just re-apply.

Command to inspect the old code directly without checking it out: `git show 5dbdf1e:web/src/hooks/useChat.ts` etc.

**Task 0.2:** Diff `5dbdf1e`'s version of each touched file against the CURRENT version of the same file (which has since absorbed unrelated fixes: bullet-list markdown rendering, source-badge click-to-fold, the brevity-constraint restore, the recap-bug fix, the model swap from `flash-lite`→`flash`, the cache-poisoned sample-question reword). A raw `git revert 111c8fd` will conflict with all of those later commits — this needs a surgical re-apply of the tool-call logic into the CURRENT files, not a blind revert.

### 0.2 Re-implement, informed by 0.0's resolution

**Task 0.3:** Re-add the `client_side` tool (`consult_technical_specialist`) to `ACS-generic-neural`'s config in `agentConfig.mjs`, using the exact flat shape the spike found works (`{name, type:"client_side", description ≤200 chars, inputSchema}` — NOT the OpenAI-nested shape the docs show, which 422s).
**Task 0.4:** Re-add the publish step if needed (`POST /agents/{id}/publish` — `status:"published"` in the create/PATCH body is silently ignored).
**Task 0.5:** Re-add tool-call frame handling in `agentStudio.ts` (the `9:` frame → `ToolInvocation`) and the resume-call logic in `useChat.ts`, using the proven resume shape: an assistant message with `parts:[{type:"tool-invocation", toolInvocation:{state:"result", toolCallId, toolName, args, result}}]`.
**Task 0.6:** Remove the `SPECIALIST:`-prefix hack from `suggestions_generic.md` and `useChat.ts`'s `extractDeepDiveOffer`/`deriveOfferState` — the offer signal is now the real tool-call frame, not a suggestion string.
**Task 0.7:** Decide what happens to Agent Studio's native `suggestions` config now that it's not carrying the handoff signal — either turn it off entirely for now, or scope it strictly to its native purpose (a single "you might also ask" chip) if you still want that feature; do NOT re-derive Phase-0.5's real follow-up-engagement feature by just repurposing this config again.
**Task 0.8:** Keep everything unrelated that shipped after the retirement — bullet-list markdown, badge click-to-fold, brevity constraint, recap fix, `gemini-2.5-flash` model pin, the reworded sample question, `build_acs_agents.mjs`'s PATCH-in-place pattern. None of that is being undone.
**Task 0.9:** Port AC2's judge `parse.ts` dimension-resolver fix into ACS's `lab/judge/src/parse.ts` (see the corrected playbook note — this is a known, already-solved fix on AC2's side, not new investigation).

### 0.3 Test + verify

**Task 0.10:** Write/restore the test coverage the original tool-call build had (`useChat.test.ts` tool-call detection cases) plus a NEW test asserting the answer-text-before-tool-call ordering from Task 0.1's resolution, so this can't silently regress again.
**Task 0.11:** Live browser verification exactly like today's UI-fix verification — real question, real click, network tab, confirm the specialist genuinely gets invoked via a tool call (not text/not suggestion) and the generalist's answer text is visibly present before the offer appears.
**Task 0.12:** Deploy, verify live in the served bundle (same method used today — grep the built JS for a literal string unique to the change).

---

## Phase 0.5 — ACS: real follow-up/engagement questions (separate feature)

**Task 0.5.1:** Design what "engaging the user with follow-up questions" actually means in the answer flow — e.g., the agent's own answer can end with a genuine clarifying question when the user's request was ambiguous, or a scoped multi-turn dialogue pattern, distinct from a static suggestion chip. This needs its own brief spec before implementation — do not start coding from a one-line description.
**Task 0.5.2:** Decide whether this reuses any Agent Studio native feature at all, or is pure prompt-instruction + normal conversational turn-taking (my recommendation, given the lesson from the mechanism being reverted: don't smuggle a second job into a feature built for a different one).
**Task 0.5.3:** Build + test, same TDD pattern as everything else in this repo.

This phase is explicitly scoped as follow-on work — do not block Phase 0's revert on it, but do not port Phase 0 to AC2 without this being at least designed, since AC2's port should get the corrected architecture, not another interim hack.

---

## Phase 1 — Algolia-Central2: build the single chat page, ported from corrected ACS

### 1.0 What's being thrown away (confirmed with Arijit, 2026-07-09)

No 2×2 comparison lab. One straight single-agent-pair chat page, replacing `web/src/App.tsx`'s `Matrix`/`PanelCell` UI entirely. Per the AC2 audit, this repo currently has THREE non-functional or dead multi-agent generations to retire:
- **Gen 1** (Maverick + 4 specialists, `lab/server/src/multiAgent.ts`) — code present, already not invoked. Delete or archive.
- **Gen 2** (Maverick + baton to elena/bruno, `lab/server/src/baton.ts`+`orchestrate.ts`) — this is the ONLY one currently live (answers the P4 panel). Retire once the new single-chat page replaces the panel it powers.
- **Gen 3** (General/Developer/Marketer agents, `scripts/setup/honed/build_three_agents.mjs`) — live on Agent Studio but wired to nothing in code. These are the closest match to ACS's persona split (generalist + scoped specialists) — **candidate to reuse the AGENTS themselves** (they already exist, already have DATA REALITY prompt sections for real Algolia content) rather than provisioning brand-new ones. Needs an audit of whether the existing `instructions_general.md`/`instructions_developer.md` content is salvageable or needs a full rewrite once real query-analytics data is in hand (per Arijit's own scoping — analytics review happens before finalizing prompts).

**Task 1.1:** Confirm with Arijit whether Gen 3's existing 2 (or 3) agents are the ones to build on, or whether fresh agents should be provisioned. (Gen 3 has 3 personas — General/Developer/Marketer3 — ACS's pattern is 2. Decide: collapse to 2, keep 3, or something else — this is a real product decision, not just an engineering one, and affects Task 1.4/1.5 below.)

### 1.1 Retire dead/legacy code first (this is the "detailed code review" ask — findings below, from direct file reads)

- `web/src/components/ChatMessage.tsx` — dead code (confirmed via `grep -rn "ChatMessage"` — referenced nowhere except itself and a stale compile-comment in `types/chat.ts:202`). **Resurrect this, don't rebuild it** — it's already the right shape (user/assistant bubbles, streaming caret, refusal/error cards) and already renders `GroupedSources`.
- `web/src/components/GroupedSources.tsx` — this already IS the grouped-pills-with-count-badge pattern ACS has. Confirmed structurally equivalent. Port ACS's two 2026-07-09 UI fixes (bullet-list markdown rendering wherever this project's markdown renderer lives, and count-badge-always-clickable-to-fold) into whatever renders alongside this component — check if the fold/unfold behavior even exists here yet; audit didn't confirm either way.
- `web/src/config/columns.ts` — drifted from the real backend (`panels.ts` only supports P3/P4; this file still describes a stale 4th-generation "Technical/Marketer/Academy/Support" pipeline in a comment that matches none of the 3 real generations). Delete along with the 2×2 UI.
- `web/src/lib/followup.ts` — a regex "does the last sentence end in `?`" parser for same-agent clarifying-question chips. Unrelated to A2A handoff. Evaluate whether this is a rough draft of the Phase-0.5 engagement-question feature already, or should be replaced by it.
- `web/src/lib/agentStudioClient.ts` — single-agent-only browser-direct Agent Studio client, header comment says it's the ancestor ACS's `agentStudio.ts` was ported FROM. This means porting ACS's (corrected, tool-call-capable) version back into AC2 is a straight upgrade of this file's descendant, not a foreign import.
- `eval-loop/packages/judge/` — stale synced snapshot of `lab/judge/`; re-run `sync-packages.sh` before relying on it, or just point everything at canonical `lab/judge/`.
- `scripts/setup/honed/build_three_agents.mjs` — has the EXACT delete+recreate-by-name bug ACS hit and fixed (lines ~151-152: `DELETE` then `POST` on every run). Fix this the same way ACS did (`build_acs_agents.mjs`'s PATCH-in-place pattern) before this script is used again for anything.
- `scripts/setup/honed/_shared_grounding.md` — contains leftover "WARM CONTEXT BATON" language written for the OLD Maverick-coordinator generation, never updated when personas became General/Developer/Marketer. Needs a real rewrite pass regardless of which agents get kept.

**Task 1.2:** Decide and execute: delete outright vs. archive under a `legacy/` or git-tag reference point, for Gen 1/Gen 2 code and the 2×2 UI. Recommend archiving via a git tag (`pre-single-chat-migration`) rather than deleting, so the benchmarking work isn't unrecoverable if ever needed again — but the live `main` branch should not carry dead code forward.

### 1.2 Architecture decision needed: browser-direct vs. backend-mediated

ACS calls Agent Studio directly from the browser with a search-only key. AC2 currently proxies everything through a real Dockerized backend (`lab/server`, serving `/api/answer`/`/api/judge`, deployed separately from the Vercel frontend). This is a genuine architecture fork, not a detail:

**Task 1.3:** Decide — does the ported single-chat page call Agent Studio browser-direct (simpler, matches ACS exactly, loses the backend-mediation AC2 currently has) or keep going through `lab/server` (more consistent with this repo's existing security/observability posture, but means porting ACS's client-side orchestration logic into server-side code instead of a straight file copy)? This changes how much of ACS's `useChat.ts`/`agentStudio.ts` is a literal copy vs. a server-side reimplementation.

### 1.3 Build

**Task 1.4:** Finalize the agent roster for AC2 (per Task 1.1's decision) and, if new prompts are needed, hold off finalizing them until the analytics/real-query review (Arijit's own scoping — this is Algolia-Central2-specific, no ACS equivalent).
**Task 1.5:** Port the corrected (post-Phase-0) tool-call handoff mechanism — agent config (`client_side` tool, publish step), frame parsing, resume logic, per the architecture decision in Task 1.3.
**Task 1.6:** Wire `ChatMessage.tsx` + `GroupedSources.tsx` into a new single-chat page, replacing `App.tsx`'s panel grid.
**Task 1.7:** Port Phase 0.5's engagement-question feature once it exists on ACS (don't build it twice independently — port it, same as everything else).
**Task 1.8:** Fix `build_three_agents.mjs`'s delete+recreate bug regardless of which agents ship, using ACS's `build_acs_agents.mjs` PATCH-in-place pattern.
**Task 1.9:** Seed the equivalent test coverage (agent-config tests, instruction-file lint tests, frame-parsing tests using REAL captured frames from AC2's own live agents — not synthesized, matching ACS's own rule for this).
**Task 1.10:** Deploy, verify live (bundle-grep method), confirm `vercel.json`/Docker deploy topology is still correct for the new single page (the split Vercel-frontend + Dockerized-backend topology may or may not still be needed depending on Task 1.3's outcome).

---

## Open questions carried into execution (do not silently resolve these — ask)

1. Does Task 0.0's Option B (prompt-only ordering fix) actually hold empirically? This gates whether Phase 0 needs the simpler fix or the more involved two-step completion.
2. Gen 3's existing agent roster (3 personas) vs. ACS's 2-persona pattern — collapse, keep, or redesign?
3. Browser-direct vs. backend-mediated for the new AC2 chat page — a real security/architecture tradeoff, not a style choice.
4. What does "real follow-up engagement question" mean concretely enough to build (Phase 0.5) — needs a short spec, not assumed from this plan alone.

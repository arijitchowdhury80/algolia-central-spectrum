# 01 — Intake

## 8-dimension interview

**1. Problem / goal.** Two distinct problems, one run: (a) Generic's `SPECIALIST:` deep-dive offer sometimes silently never appears — root cause is an async `config.suggestions` platform job racing Agent Studio's own per-query response cache (Track A). (b) Build the validated pure-orchestrator architecture as a real 3-agent router with auto-chained specialist calls, for its own sake / future AC2 port value, explicitly NOT as a fix for (a) — the E2E validation proved chaining mechanics work but the orchestrator sits downstream of the same racy signal (Track B). Full analysis: `docs/plans/2026-07-10-reconciled-handoff-architecture-build.md`.

**2. Users affected.** Every live visitor to `algolia-central-spectrum.vercel.app` asking an implementation-flavored React Spectrum question. Track A fixes a real, currently-shipping defect. Track B changes user-facing behavior materially (removes the manual "yes, go deeper" click — Technical now auto-runs).

**3. Success criteria.**
- Track A: a query repeated on purpose (the exact condition that triggers the caching race) still surfaces the `SPECIALIST:` offer deterministically, live, in a real browser. Test-suite-green alone does not count (Cardinal Rule).
- Track B: real E2E chain (already proven, tonight) plus a real browser click-through (T6, never run for either track) plus confirmation the auto-chain UX doesn't fire on pure design questions (false-positive auto-run is a worse failure than a missed offer).

**4. Constraints.** Live agent IDs are hardcoded in `web/src/config/instances/spectrum.ts` and the deployed app depends on them — any agent config change must go through the `ACS_AGENT_SUFFIX` dry-run mechanism (`-dev` copies) before touching the unsuffixed live names, per this repo's own standing discipline (previously violated once, `4a66cad` incident). Track B adds a THIRD live agent, which is new state the deployed app doesn't currently reference — needs a new hardcoded ID slot, and a rollback path that doesn't leave an orphaned agent behind if aborted mid-build.

**5. Compliance / data sensitivity.** None new. No PII, no payment data, no new data store. Same posture as every prior ACS change.

**6. Rollback.** Track A: revert `useChat.ts`'s `runTurn` change (single-file diff) + re-enable `config.suggestions` in `agentConfig.mjs` if it was disabled — redeploy previous Vercel build if a live issue surfaces. Track B: delete the orchestrator agent (dry-run suffix mechanism makes this trivial pre-flip; post-flip, `spectrum.ts`'s hardcoded orchestrator ID would need reverting alongside a redeploy). Both tracks: prior git commit is always a clean redeploy target — same rollback shape every ACS change has used.

**7. Dependencies.** Track A: none new — reuses existing `callCompletions`, existing prompt content. Track B: one new live Agent Studio agent (new external-service state, not a code dependency) + real tool-call/resume wire mechanics already proven but never yet run in production code (only in disposable spike scripts).

**8. Scope classification.**
- **Touches external API surface:** yes, both tracks (Agent Studio completions/agent-config API).
- **New dependency (new external state):** yes for Track B (third live agent).
- **Security-sensitive:** touches production-hardcoded agent IDs the live, publicly-reachable app depends on (Intake precedent from the original suggestions-migration run: "must not touch the live-linked agent IDs without explicit redeploy sign-off").
- **Classification: FULL PATH (16 stages).** Both criteria for FULL are independently met (external API + production ID surface); light path is not applicable here regardless of how small either code diff looks.

## Scope note
**Revised 2026-07-10: Track B killed for ACS.** Once Architecture Review specced Track A's Classifier agent (required — Generic's own agentId can't absorb the classification call, see `04-architecture-review.md` C3), Arijit caught that Track B's orchestrator hop becomes provably redundant: the client computes `offerSpecialist` from the Classifier's real answer and hands that exact boolean to the orchestrator, which only relays the decision, never makes an independent one. Track B would add 2 more real network round-trips per implementation turn for zero behavioral difference from Track A alone. Full Track B spec (`04-spec-track-b.md`) is preserved, marked shelved-for-AC2, not discarded.

**This run now covers Track A only: 3 agents (Generic, Technical, new Classifier), no orchestrator, no auto-chain.**

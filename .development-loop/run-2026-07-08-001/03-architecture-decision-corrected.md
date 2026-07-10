# 03 — Architecture Decision (corrects the tool-call/pause-resume design from Discovery/Intake)

**Superseded:** the "real client-side tool call, pause Generic, resume with Technical's result" design (Architecture B, per `docs/spikes/2026-07-08-agent-to-agent-tool-VERDICT.md`). That spike proved the platform CAN do agent-to-agent tool calling — real finding, still true — but it answers a question this product doesn't have. The frontend is already the orchestrator; it doesn't need Generic to autonomously invoke Technical via a tool. Importing that mechanism here was the wrong move, caught by Arijit mid-design (2026-07-09).

## Corrected flow (approved, 2026-07-09)

1. User asks → frontend calls Generic.completions.
2. Generic streams its full answer — unchanged from today, no tool call, no pause.
3. Immediately after, Agent Studio's native `suggestions` feature (Job B — `config.suggestions`, real platform mechanism, confirmed via docs: streams a `suggestions-chunk` AFTER the main response) fires.
4. Frontend reads the suggestions. One is configured (via `suggestions.system_prompt`) to be a "go deeper with the specialist?" offer, surfaced only when the topic warrants it.
5. Offer card shown to user.
6. User clicks yes.
7. Frontend calls Technical.completions DIRECTLY — same shape as today — passing the original question + Generic's answer as context.
8. Technical streams its own answer using that context to go deeper.
9. Shown to user as the specialist's answer.

**No tool call anywhere in this flow. No pause. No second call back to Generic. Generic and Technical never call each other — the frontend calls each in sequence and passes context itself.**

## What this changes vs. the original Job A/Job B split
- Job A (tool-call handoff) is CANCELLED as originally scoped. Its only surviving piece: replace the `[[HANDOFF:technical]]` prose-sentinel detection with reading the native `suggestions` array (which is Job B's mechanism). **Job A and Job B collapse into one mechanism.**
- The `docs/spikes/2026-07-08-agent-to-agent-tool-*` findings remain valid, correct, and useful — just not applicable to ACS's Generic↔Technical handoff. Filed as a reusable capability fact (agent-to-agent tool calling works on this platform) for a future case that actually needs a model-driven cross-agent decision, not this one.

## New open item: multi-turn continuity
Question: once the specialist deep-dive has happened, can the user keep asking follow-ups with full memory of everything so far (both Generic's and Technical's turns)?

**Answer: yes, and it requires no new platform capability** — Agent Studio's `/completions` is stateless (client resends the full message history every call, per `docs/00-protocol-read-receipt.md`). Continuity is purely a frontend bookkeeping question: which messages get included in the history sent to whichever agent handles the NEXT turn.

**Design decision needed (not yet made):** maintain two accumulating histories client-side — `genericHistory[]` and `technicalHistory[]`. Every new question still goes to Generic first (front-door pattern, unchanged). Open question: does `genericHistory` include past Technical deep-dive answers (so Generic "knows" what was already covered in depth), or only its own turns? Recommend: yes, fold Technical's answers into `genericHistory` too, so Generic doesn't re-suggest a deep dive on something already answered and can reference it. When a new deep dive fires, `technicalHistory` should carry the FULL running context (not just the latest Q+A), so specialist answers compound in depth rather than resetting each time.

**Decided (Arijit, 2026-07-09):** on the 2nd+ deep dive, send Technical all past questions in full (verbatim) + a SUMMARY of each past answer (not the full answer text). Applies to both `genericHistory` and `technicalHistory`. Deferred to Build: where the summarization happens (client-side truncation, or the agent itself emits a short summary alongside its full answer).

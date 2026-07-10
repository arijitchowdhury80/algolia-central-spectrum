# 04 — Spec: Track B (pure-orchestrator, validated architecture) — KILLED FOR ACS, 2026-07-10

**Not being built.** Once Track A's Classifier agent exists, the orchestrator's tool-call decision is provably redundant: the client computes `offerSpecialist` from the Classifier's real answer and hands that exact boolean to the orchestrator, which is instructed to chain iff true — it never makes an independent decision, it relays one the client already has. That means Track B adds 2 more real network round-trips per implementation-flavored turn (orchestrator call + orchestrator-resume) for zero behavioral difference from Track A alone. Arijit caught this on review and killed it for ACS (2026-07-10) rather than build validated-but-pointless latency.

**Not discarded — shelved for AC2.** The architecture is real, tested (tonight's E2E: 10/10 on real data), and fully specced below including the two Critical fixes Architecture Review found (query-provenance, `scopeTools` escape hatch). If Algolia-Central2's port genuinely needs a model-driven router deciding across more than 2 personas — a case where the client CAN'T just precompute the routing decision the way Track A's Classifier lets it here — this spec is the starting point, not a redo. Do not rebuild the wire mechanics from scratch; do re-litigate whether AC2's actual use case still needs it before assuming this spec transfers unchanged.

---

*(Original spec preserved below for reference/reuse — not an active Build target for this run.)*

NEW — written as part of Architecture Review (`04-architecture-review.md`), incorporating the query-provenance correction Risk required (Go/No-Go item 1) and the `scopeTools` design (Go/No-Go item 2). Not yet human-approved for Build.

**B0 correction (post-review):** the Architecture Review agent flagged B0 (auto-chain vs. human-gate) as unresolved because it only reads this run's on-disk artifacts, not the live session — Arijit answered it explicitly in-session: **auto-run Technical on chain (no manual click gate)**. This was recorded in `01-intake.md` §1 ("Technical now auto-runs") but not labeled as "B0's answer" there, which is why the review missed it. Recorded explicitly here now so it's unambiguous for Build. §3 below is written against this answer, not left blocked.

## Contract

**Before (current production):** `runTurn` calls Generic directly, reads the offer signal, gates Technical on human click (`runDeepDive`). Two agents, no tool-call machinery.

**After (Track B, once B0 is answered):** `runTurn` calls a new third agent (orchestrator) which never answers itself and carries exactly 2 `client_side` tools (`call_generalist`, `call_specialist`). The client intercepts each tool-call frame, calls the REAL target agent directly (Generic or Technical), streams its real answer to the UI, and resumes the orchestrator with the result so it can decide the next hop. The orchestrator's own tool-call `args` are LLM output — they identify *which* tool fired and nothing else.

**Invariant this spec adds (Risk Go/No-Go item 1, HIGH):** every live call to Generic or Technical triggered by this flow uses the client's own trusted `turn.query` / `turn.deepDiveQuery` value — **never** the orchestrator's tool-call `args.query`, even though the orchestrator will include a `query` argument in its tool call (Agent Studio's tool schema requires it be present; the client must read past it, not through it).

## 1. Agent creation (`agentConfig.mjs` / `build_acs_agents.mjs`) — no dependency on B0

```js
export const PERSONAS = [
  { name: 'ACS-generic-neural', ... },      // unchanged
  { name: 'ACS-technical-neural', ... },    // unchanged
  {
    name: 'ACS-orchestrator-neural',
    prompt: 'instructions_orchestrator.md',   // new file — "never answer, only route" system prompt
    filters: null,
    desc: 'ACS_SPECTRUM_MULTI orchestrator — routes to call_generalist/call_specialist, never searches or answers directly.',
    extraTools: [CALL_GENERALIST_TOOL, CALL_SPECIALIST_TOOL],  // flat client_side shape, proven live
    noSearchTool: true,          // scopeTools escape hatch — see 04-architecture-review.md §2
    expectSuggestions: false,    // orchestrator never emits a suggestion of its own; same off-path as Track A's classifier
  },
];
```
`noSearchTool: true` is load-bearing, not cosmetic: without it, `scopeTools` (pre-fix) unconditionally clones the clone-base's `algolia_search_index` tool onto every persona, silently handing the orchestrator search capability it was never supposed to have — undermining the "never answers, never searches, only routes" design the spike actually validated (round 1/3 of `probe-orchestrator.mjs` only proved zero-prose behavior with search tools *absent*).

**Publish step:** already handled by existing code. `build_acs_agents.mjs:83-87` unconditionally calls `POST /agents/{id}/publish` on the create-new-agent branch. Adding the third `PERSONAS` entry gets this for free — no new code needed here (corrects `build.md:76`, which describes this as work still to do).

**Dry-run discipline (Risk Go/No-Go item 4, restated as a checkable requirement):** the orchestrator MUST be added via this `PERSONAS`/`buildAgentName`+`ACS_AGENT_SUFFIX` mechanism, never via adaptation of the spike scripts' raw admin-key `fetch` pattern (`create-probe-agent.mjs`, `probe-orchestrator.mjs`, `e2e-orchestrator-validation.mjs` all write agents with hardcoded `SPIKE-*` names outside `buildAgentName` — safe today only because none of them ever reference an `ACS-*` name in a write call). `build.md:87`'s "not copy-pasted" line is a security control, not a code-quality note — code review must verify it, not just read the prose.

**RED test (B1):** tool schema shape assertions — assert the flat `{name, type:"client_side", description, inputSchema}` shape (mirrors the docs' rejected nested shape being explicitly excluded), matching Track A's discipline of asserting exact shapes, not just presence.

## 2. Frame handling + resume (`agentStudio.ts`) — no dependency on B0

`ParsedCompletion.toolInvocations` already exists (scaffolded, unread today) — no interface change needed. New: the resume-body builder, using the proven shape from tonight's spike:
```
{ role: 'assistant', parts: [{ type: 'tool-invocation', toolInvocation: { state: 'result', toolCallId, toolName, args, result } }] }
```
**RED test (B2):** feed a captured REAL tool-call frame (`docs/spikes/2026-07-10-e2e-orchestrator-results.json`) and assert `ParsedCompletion.toolInvocations` populates correctly. No synthesized frames — same discipline as every other test in this repo.

## 3. `runTurn` rewrite (`useChat.ts`) — B0 answered (auto-chain), query-provenance contract pinned

Per B0's answer (auto-run Technical on chain, no manual click), the following call-site contract applies:

```
1. call orchestrator with { history: priorHistory, query: turn.query }
2. intercept the first tool-call frame:
     - if toolName === 'call_generalist': call REAL Generic with
         { history: priorHistory, query: turn.query }        // NEVER tc.args.query
     - stream Generic's real answer to the UI segment (unchanged pattern from today's runTurn)
     - offerSpecialist := deriveOfferState(classifyOffer(...), turn.query).deepDiveOffered
         // sourced from TRACK A's post-fix signal, not the pre-Track-A genericResult.suggestions
         // field (build.md:78's "STILL sourced from Generic's real suggestion" describes the
         // PRE-Track-A codebase; by the time B3 is built, Track A has already shipped and
         // replaced that field per Intake's sequencing — this spec corrects that stale premise)
     - resume orchestrator with { answer: genericText, offerSpecialist }
3. if the orchestrator chains to call_specialist:
     - call REAL Technical with { history: technicalHistory, query: turn.deepDiveQuery ?? turn.query }
         // NEVER the resumed tool call's args.query
     - stream Technical's real answer to the UI segment (unchanged pattern from runTechnicalLeg)
```

**The tool call's `args` are read ONLY to identify which tool fired (`toolName`).** `args.query`, if present, is discarded — never passed to `callCompletions`, never folded into `buildTechnicalHistory` or `turnToHistory`. This is the direct fix for Risk's HIGH finding (pre-mortem row 1 / Go/No-Go item 1): the plan doc's literal wording ("call REAL Generic directly with the tool call's `query` arg", `build.md:78`) is superseded by this contract.

**Required RED test (this is the actual acceptance bar for this section, not optional):**
> Feed a tool-call frame whose `args.query` differs from `turn.query` (e.g. a crafted/reformulated string). Assert the real call to Generic/Technical still uses `turn.query`/`turn.deepDiveQuery` verbatim — never `args.query`. This must fail against a naive implementation that reads `tc.args.query` (i.e. against `build.md:78`'s literal text) and pass only once the fix above is implemented.

**B0 = (a), auto-run.** `ChatTurn` (`types.ts`) needs a real change to reflect this — `deepDiveOffered`/`handoff`'s current semantics assume a human decision point exists between them (`deepDiveOffered=true, handoff=false` = "awaiting user"). Under auto-chain, that intermediate state never has a live user-facing moment — the UI needs a way to show "Technical is running because the orchestrator decided to" distinct from today's "click to find out." Minimal change: add `autoChained: boolean` (true when Track B triggered the specialist call, vs. `handoff: true` alone which today only ever meant "user clicked"). `declineDeepDive`'s current button/action has no meaning once there's no offer to decline — the UI layer (`DiscoveryCard.tsx`, `ChatMessage.tsx`) needs updating in the SAME build task, not left dangling with dead props referencing a consent flow that no longer exists for Track-B-routed turns. Flag this as a real UI task inside B3, not an afterthought — this project has already been burned twice (HANDOFF section, `[[FOLLOWUP:]]` sentinel) by leaving stale-mechanism traces in place after a mechanism changes.

## 4. Live verification (B4/B5) — dev/live override, per `04-architecture-review.md` §4

Uses the same `VITE_ACS_DEV_AGENT_IDS` mechanism as Track A's A4, extended with an `orchestrator` key once the agent exists. B4 (≥5 real turns, mixing design/impl + ≥2 repeated-wording questions) explicitly re-confirms the caching race is STILL present on this path if Track A's fix hasn't also been layered into the orchestrator's `offerSpecialist` sourcing (§3 above) — if it shows up here, that's confirmation the §3 wiring is wrong, not a new bug to scope separately.

## Rollback

Delete the orchestrator agent (dry-run suffix mechanism makes this trivial pre-flip). Post-flip: `spectrum.ts`'s hardcoded `orchestrator` ID would need reverting alongside a redeploy — same shape as Generic/Technical/classifier rollback. `useChat.ts`'s `runTurn` reverts to Track A's post-fix 2-agent version (single-file revert), which remains fully live and correct on its own regardless of whether Track B ships.

## Tasks (revised from `build.md`, cross-referencing this spec's sections)

- **B0:** Resolve auto-chain-vs-human-gate with Arijit before B3. **Not resolved as of this review.**
- **B1:** Add orchestrator persona + tools to `agentConfig.mjs` (§1 above). Publish step already handled — no new code there. RED test: tool schema shape.
- **B2:** `agentStudio.ts` resume-body builder (§2 above). RED test: real captured tool-call frame.
- **B3:** `useChat.ts` `runTurn` rewrite per §3's fixed query-provenance contract + B0's auto-chain UX, including the `ChatTurn`/`DiscoveryCard.tsx`/`ChatMessage.tsx` updates §3 names (the dead-consent-affordance cleanup). RED tests: the query-provenance regression test (mandatory, §3) + the 3-hop auto-chain flow tests.
- **B4:** Live spot-check ≥5 real turns via `-dev` override (§4), including repeated-wording cases.
- **B5:** Live browser verification (never run for this design at all yet).
- **B6:** Human-gated production flip — unchanged from `build.md`, still the final go/no-go for touching live-hardcoded IDs.

## Verdict carried from Architecture Review, corrected

B0 is answered (auto-chain) — the review's "not ready for B3" hold is lifted. Track B's full spec (B1–B6) is ready for Plan, gated only on Track A shipping + live verification first, per Intake's sequencing — no further UX decision pending.

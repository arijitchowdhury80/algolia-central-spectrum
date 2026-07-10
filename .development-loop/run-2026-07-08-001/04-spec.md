# 04 — Spec

## Builder + reasoning
**module-builder.** No new UI page/component/route — this rewires existing mechanism files (`web/src/hooks/useChat.ts`, `web/src/lib/agentStudio.ts`, `scripts/agents/build_acs_agents.mjs`) plus a data-source swap on an existing component (`DiscoveryCard.tsx` reads a different field, same rendering). frontend-builder is for new UI surfaces; feature-builder is for new backend+frontend pairs — neither applies.

## Real-code finding that changes this spec's framing (not just the plan docs)

Reading the actual current code (not just the architecture-decision doc) surfaced something the risk assessment also flagged: **the tool-call handoff design is not hypothetical — it's already live in production.** `useChat.ts`'s own comment: *"Generic sometimes calls the tool with no acknowledgment first"* — confirming the spike's finding (a tool call preempts answer text) is causing a REAL, already-shipping defect: Generic's answer bubble can render empty text with just a deep-dive offer, right now, in production, today. This spec is not preventing a hypothetical UX regression — it's fixing one that already exists.

**Corollary requirement this adds (not previously stated as R12):** removing the prose-sentinel parsing alone is NOT sufficient to fix this. `CONSULT_TECHNICAL_TOOL` must be REMOVED from Generic's tool registration in `build_acs_agents.mjs` — as long as the tool stays registered, Generic can still autonomously call it and pause with empty text, regardless of what signal the frontend reads afterward. **R12: exact edit site is line 49 — `PERSONAS[0].extraTools: [CONSULT_TECHNICAL_TOOL]` → `extraTools: []`.** (Architecture-review Important #6: this is NOT a change to the PATCH-body construction — `tools` at that call site is already computed upstream from this array.)

## API / data contracts

### `scripts/agents/build_acs_agents.mjs` — PATCH body (line ~92)
```js
// BEFORE
const body = { instructions, model: base.model, providerId: ..., tools };
// AFTER
const body = {
  instructions, model: base.model, providerId: ...,
  tools,                    // computed upstream from PERSONAS[0].extraTools (line 49) — see R12 note below, NOT edited at this call site
  config: {
    suggestions: {
      enabled: true,
      model: 'gemini-2.5-flash-lite',
      system_prompt: SUGGESTIONS_PROMPT[personaName],  // per-persona, see below
      generation: { max_count: 1 },  // CORRECTED 2026-07-09, see note below
      context: { include_tool_outputs: true },
    },
  },
};
```
**Correction (2026-07-09, Build-stage empirical finding — overrides this spec's original "locked" `max_words: 20`):** live-tested against a real completions call — `generation.max_words` (and camelCase `maxWords`) causes the completions endpoint to return **HTTP 500 on every call**, while the agent's own PATCH/GET write-path happily accepts and round-trips the malformed config (write-acceptance ≠ runtime-correctness — the same trap the 2026-07-08 tool-call spike hit with the docs' wrong schema). Field removed; enforce suggestion brevity via `system_prompt` wording instead. Empirical reality overriding a value marked "not open to Build's discretion" is recorded here explicitly, not silently patched.

Post-PATCH verification (existing `GET` + console line, ~line 105) must additionally assert `v.json.config?.suggestions?.enabled === true` before printing success — mirrors the exact incident class already fixed once this session (a field silently absent from what gets pushed). This is Risk finding #1, now a spec requirement, not a suggestion.

Two distinct `system_prompt` values needed:
- **Generic's:** must be able to produce a "go deeper with the specialist?" offer, selectively, only for code/implementation-heavy questions — this is Open Question #6 in the vault (`Projects/Algolia-Central/spectrum/wiki/open-questions.md`), not yet written. Placeholder until Build: instruct the model to emit a suggestion literally prefixed `SPECIALIST:` when the topic warrants a deep dive, so the frontend can distinguish it from ordinary follow-up suggestions by a fixed, parseable marker (a real structured convention, not a coincidence-based heuristic).
- **Technical's:** preserves the existing hard-won grounding rule from `instructions_technical.md`'s current `[[FOLLOWUP:...]]` section (name a real, specific prop/component from the actual retrieved hits, vary phrasing, no generic templates) — ported into `system_prompt` wording, not re-invented.

### `web/src/lib/agentStudio.ts` — new frame type (UNVERIFIED WIRE SHAPE — Build-stage discovery task, not an assumption)
`ParsedCompletion` gains `suggestions: string[]`. **The real SSE frame prefix/shape for a `suggestions-chunk` under this app's `compatibilityMode=ai-sdk-4` is NOT YET KNOWN** — the docs describe `{type:"suggestions-chunk", suggestions:[...]}` in the abstract AI-SDK sense, not the raw wire prefix this project's hand-rolled parser needs (same category of gap the 2026-07-08 spike had to close empirically for the tool-call frame, per `docs/spikes/2026-07-08-agent-to-agent-tool-findings.md` Task 2's documented-shape-was-wrong lesson). **Build must empirically capture a real completions response with `suggestions.enabled: true` and read the actual frame prefix before writing the parser branch** — do not guess a prefix and assume it's right. Currently `IGNORED_PREFIXES = new Set(['b','e','d','f','2','c'])` plus a catch-all — whatever prefix suggestions arrive on must be added explicitly, not left to fall through the silent-ignore branch (Risk finding #3).

### `web/src/hooks/useChat.ts` — detection contract swap
```ts
// REMOVE
const FOLLOWUP_RE = /\[\[FOLLOWUP:\s*([^\]]+?)\]\]/i;
function parseAgentText(text) { ... }               // regex-based
function pendingToolCallFrom(result) { ... }         // tool-call-based
import { HANDOFF_TOOL_NAME } from '../lib/agents';

// ADD
function extractDeepDiveOffer(suggestions: string[]): { offer?: string; rest: string[] } {
  const idx = suggestions.findIndex((s) => s.startsWith('SPECIALIST:'));
  if (idx === -1) return { rest: suggestions };
  return { offer: suggestions[idx].slice('SPECIALIST:'.length).trim(), rest: suggestions.filter((_, i) => i !== idx) };
}
```
`ChatTurn.pendingToolCall` field (`types.ts` line 79) is removed — replaced by `ChatTurn.deepDiveQuery?: string`.

**`deepDiveQuery` value, pinned (architecture-review Critical #1):** `deepDiveQuery = turn.query` — the user's original turn text, verbatim, exactly matching today's existing fallback at `useChat.ts:316` (`turn.pendingToolCall?.query || turn.query`, minus the now-removed first branch). It is NOT a concatenation of the question and Generic's answer — Generic's answer text stays exactly where it already lives today, as the separate `genericText` parameter passed into `runTechnicalLeg`. Reason this needs to be explicit: `runTechnicalLeg`'s `query` param is used twice (folded into `technicalHistory` as a `user` turn at `useChat.ts:236`, AND passed as `req.query` to `callCompletions`, which appends another `user` turn at `agentStudio.ts:183`) — if `deepDiveQuery` ever became question+answer combined, Technical's final "user" turn would literally contain Generic's answer framed as something the user said.

**Exact rewiring of the state update at `useChat.ts:206–210` (architecture-review Critical #2), replacing today's tool-call-sourced version:**
```ts
// CURRENT (tool-call-sourced)
setTurns((prev) =>
  prev.map((t) =>
    t.id === turnId ? { ...t, deepDiveOffered: handoff, followUp, pendingToolCall } : t,
  ),
);

// SPEC (suggestions-sourced)
const { offer, rest } = extractDeepDiveOffer(genericResult.suggestions);
setTurns((prev) =>
  prev.map((t) =>
    t.id === turnId
      ? { ...t, deepDiveOffered: !!offer, followUp: rest[0], deepDiveQuery: offer ? turn.query : undefined }
      : t,
  ),
);
```
`deepDiveOffered` and `deepDiveQuery` are derived from the SAME `offer` value in the same statement — they can never disagree (offer present ⇒ both set; offer absent ⇒ both unset). This closes the exact "silent mismatch" seam the risk assessment warned about.

### Multi-turn history (R11, `runTechnicalLeg`, lines ~234-238)
```ts
// CURRENT (single-round only)
const technicalHistory = [...priorHistory, { role: 'user', content: query }, { role: 'assistant', content: genericText }];

// SPEC (R11: verbatim questions + summarized answers on round 2+)
const technicalHistory = [
  ...priorHistory,                        // already-summarized from earlier rounds, see below
  { role: 'user', content: query },       // ALWAYS verbatim, every round
  { role: 'assistant', content: genericText },  // round 1 only: full text (nothing to summarize yet)
];
// On completion, before folding THIS round into future priorHistory:
// replace this round's assistant content with a summary, per R11 — mechanism
// (client truncation vs. agent-emitted) is an explicit Build-stage decision,
// not decided here. Must read `segment.text` (already-parsed display text),
// NEVER `segment.rawHits` (types.ts lines 42-48, judge-only field) — Risk
// finding, component 4, Information Disclosure row.
```

## Dry-run mechanism (Go-condition #4 — architecture-review Critical #3: previously gestured at, no real mechanism existed)
`build_acs_agents.mjs`'s `PERSONAS` array hardcodes agent names, and `listAgents()` resolves those names straight to live IDs before every PATCH — there is no way to target anything but the live agents today. Add:
```js
const SUFFIX = process.env.ACS_AGENT_SUFFIX ?? '';
// applied when constructing each persona's `name`:
const name = `${p.name}${SUFFIX}`;  // e.g. ACS_AGENT_SUFFIX=-dev → "ACS-generic-neural-dev"
```
Dry-run flow: `ACS_AGENT_SUFFIX=-dev node build_acs_agents.mjs` creates/patches disposable `*-dev` copies (first run POSTs+publishes since they don't exist yet, exactly like a first-time persona today); verify `config.suggestions` and the frame-parsing change against those IDs manually before running the script with no suffix against the real live-linked IDs in `spectrum.ts`. This replaces "hand-edit `PERSONAS` and hand-edit it back" (the exact manual-discipline gap that produced this session's earlier incident) with a real, reusable env-var contract.

## Test plan (Go-condition #3 — architecture-review Important #4: previously had zero named cases)
`useChat.ts`/`agentStudio.ts` have zero existing tests; this change is not permitted to ship without covering at minimum:
- `extractDeepDiveOffer`: isolates a `SPECIALIST:`-prefixed suggestion correctly; returns `{ rest: suggestions }` unchanged (no `offer`) when no suggestion has the prefix; strips the matched entry out of `rest` so it never also renders as an ordinary follow-up.
- `agentStudio.ts` frame parsing: given a captured real completions response containing a suggestions frame (captured per the "empirically discover the real prefix" step above), `parseCompletionStream` yields `ParsedCompletion.suggestions` as a non-empty array — not silently dropped into the ignore-catch-all.
- `useChat.ts` state wiring: the `setTurns` update from the spec's pinned rewiring above — given a `genericResult.suggestions` containing a `SPECIALIST:` entry, asserts `deepDiveOffered === true` AND `deepDiveQuery === turn.query` in the same assertion (never independently true/false — this is the exact seam Critical #2 flagged).
- `deepDiveQuery` regression case: asserts the value sent to Technical's history (`technicalHistory[...].content` for the `user` role) is `turn.query` alone, never `turn.query` concatenated with `genericText`.
- R12 regression: a test asserting Generic's PATCH body (or a snapshot of `PERSONAS[0].extraTools`) no longer contains `consult_technical_specialist`, so this can't silently regress back in on a future edit.

## Observability
No metrics/logging infra exists in this app today (internal demo tool, confirmed by the risk assessment's own code read) — accepted, not a gap to build here. Sole observability surface: `build_acs_agents.mjs`'s existing per-persona console print, extended per the PATCH-body contract above.

## Rollback strategy
Because `build_acs_agents.mjs` now PATCHes in place (this session's earlier fix), rollback is simple and does NOT involve agent-ID churn: re-run the script from the previous git commit (reverts `PERSONAS`/`system_prompt`/`config.suggestions` to prior values) or manually `PATCH /agents/{id}` with `config.suggestions.enabled: false` to instantly disable without reverting code. Frontend rollback: `git revert` the `useChat.ts`/`agentStudio.ts` commit — no data migration, no schema, nothing stateful to unwind (confirmed: conversations live only in browser React state, never persisted, per the risk assessment's compliance section).

**Residual assumption, named explicitly (architecture-review Important #5):** this rollback plan assumes a rejected PATCH (4xx) leaves the agent's prior config fully unchanged, not partially applied — the risk assessment flagged this atomicity property as unverified against the live API. "Re-run the script with reverted values" only cleanly undoes a bad state if the *next* PATCH can unconditionally overwrite whatever the failed one left behind, which is true for a full-object PATCH but unconfirmed whether this endpoint does full-object replace or partial merge. Mitigated in practice by the dry-run mechanism above (any partial-apply behavior surfaces against the `-dev` copies first, not live) — but the rollback plan itself doesn't depend on ever resolving this, since re-running with the old body is a clean overwrite either way once the dry-run has validated the shape.

## Feature flag strategy
No separate flag system needed or built — `config.suggestions.enabled` on the live agent IS the flag (a real platform toggle, not a frontend conditional). Default: `false` until this ships; flip to `true` per the PATCH contract above when ready. Cleanup criterion: N/A, this isn't a temporary flag, it's the permanent config surface.

## Migration plan
None — no schema, no database, no persisted state anywhere in this app.

## Open items carried into Plan (not resolved here, by design)
- Exact `system_prompt` wording for Generic's selective deep-dive offer (vault Open Question #6).
- Real wire prefix for the suggestions frame (Build-stage empirical discovery, like the tool-call spike).
- Summarization mechanism for R11 (client truncation vs. agent-emitted summary).

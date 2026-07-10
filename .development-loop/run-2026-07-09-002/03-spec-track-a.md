# 03 — Spec: Track A (offer-signal caching-race fix)

Updated post-Architecture-Review (`04-architecture-review.md`, findings C2/C3/C4/I1/I2) — both Open Questions below are now pinned with grounded reasoning, not inference. Not yet human-approved for Build.

## Contract

**Before:** `runTurn` calls Generic, reads `genericResult.suggestions` (populated by Agent Studio's async `config.suggestions` job — races the platform's per-query cache, can silently arrive empty on a repeated/cached query).

**After:** `runTurn` calls Generic (unchanged), then makes a second, awaited `callCompletions` call — targeting a **new dedicated agent**, `ACS-classifier-neural` (pinned below) — a classification request built from `scripts/agents/suggestions_generic.md`'s existing prompt content, given the real question + Generic's real answer + Generic's real hits — and derives `deepDiveOffered`/`followUp`/`deepDiveQuery` from THAT response's content via the existing, unchanged `deriveOfferState`/`extractDeepDiveOffer`.

**Invariant preserved:** `deriveOfferState`'s inputs/outputs are byte-identical in shape to today. Only the producer of the `suggestions: string[]` argument changes. Every existing test for `extractDeepDiveOffer`/`deriveOfferState`/`buildTechnicalHistory` stays valid with zero edits.

## Pinned decision: classifier is a new dedicated agent, not Generic's own agentId

Architecture Review (C3) ruled out reusing `ACS-generic-neural`'s existing `agentId` for the classification call, on two grounded points:

1. **No per-request instructions override exists.** `CompletionsRequest` (`web/src/lib/agentStudio.ts:198-203`) has exactly `history` + `query` — there is no field to swap out an existing agent's baked system prompt for a one-off classification prompt. Sending the classification ask to Generic's real `agentId` would sit the classification prompt UNDER Generic's own full grounding/answering instructions, which still has its `algolia_search_index` tool attached — risking a second, uncontrolled search per turn and an attempt to *answer* the classification request as a real user question instead of emitting a clean signal.
2. **The classification response must arrive as ordinary content, never through `.suggestions`.** `ParsedCompletion.suggestions[]` is populated only by the overloaded `2:` frame tied to `config.suggestions` — the exact platform-async mechanism this track exists to stop depending on. If the classifier agent itself had `config.suggestions.enabled: true`, the classification signal would be produced by a second instance of the same race, one hop downstream, while looking fixed. The classifier must answer as plain streamed text (`0:` frames) that `classifyOffer` parses directly.

**Decision:** add a third live agent, `ACS-classifier-neural`, through the same `agentConfig.mjs` `PERSONAS` array / `buildAgentName`+`ACS_AGENT_SUFFIX` dry-run mechanism the two existing agents already use. This revises Intake #7's "Track A: none new [dependencies]" line and Intake #4/#13's "only Track B adds new external state" framing — both need a one-line correction; neither changes the FULL PATH scope classification, which was already met independently by the external-API + production-ID-surface criteria.

### Required changes this decision drives (all before A3)

**a. `agentConfig.mjs` — add the classifier persona, with `noSearchTool: true` and suggestions OFF:**
```js
export const PERSONAS = [
  { name: 'ACS-generic-neural', prompt: 'instructions_generic.md', filters: null, desc: '...', extraTools: [] },
  { name: 'ACS-technical-neural', prompt: 'instructions_technical.md', filters: '...', desc: '...', extraTools: [] },
  {
    name: 'ACS-classifier-neural',
    prompt: 'suggestions_generic.md',   // full system prompt, not a suggestions-config snippet
    filters: null,
    desc: 'ACS_SPECTRUM_MULTI classifier — no independent search, classifies from supplied context only.',
    extraTools: [],
    noSearchTool: true,                  // uses the scopeTools escape hatch from 04-architecture-review.md §2
    expectSuggestions: false,            // see (b) below — must NOT reproduce the racy mechanism
  },
];
```

**b. `agentConfig.mjs`'s `buildSuggestionsConfig` and `build_acs_agents.mjs`'s hard gate must both accept "expected off," not just "expected on":**

Today, `buildSuggestionsConfig` hardcodes `enabled: true` and `build_acs_agents.mjs`'s loop `process.exit(1)`s if `config.suggestions.enabled !== true` comes back — for every persona, unconditionally. The classifier persona needs suggestions OFF from creation. Minimal fix:

```js
// agentConfig.mjs
export function buildSuggestionsConfig(systemPrompt, enabled = true) {
  return {
    enabled,
    model: 'gemini-2.5-flash',
    system_prompt: systemPrompt,
    generation: { max_count: 1 },
    context: { include_tool_outputs: true },
  };
}
```

```js
// build_acs_agents.mjs — inside the PERSONAS loop
const wantSuggestions = expectSuggestions ?? true;   // default true — Generic/Technical unaffected
const suggestionsConfig = buildSuggestionsConfig(SUGGESTIONS_PROMPT[name] ?? '', wantSuggestions);
...
const enabledOk = assertSuggestionsEnabled(v.json);
console.log(`      ... suggestions=${enabledOk ? 'on' : 'off'} (expected ${wantSuggestions ? 'on' : 'off'})`);
if (wantSuggestions && !enabledOk) {
  console.error(`  ${agentName}: config.suggestions did not round-trip enabled — hard gate failed.`);
  process.exit(1);
}
if (!wantSuggestions && enabledOk) {
  console.error(`  ${agentName}: expected suggestions OFF but server reports ON — hard gate failed (would silently reintroduce the caching-race signal path this track exists to remove).`);
  process.exit(1);
}
```
This is additive and backward-compatible: Generic/Technical have no `expectSuggestions` key, default to `true`, and keep today's exact hard-gate behavior. Only the new classifier persona exercises the new branch.

**c. `InstanceConfig.agents` (`web/src/config/instance.ts:57-60`) gains a `classifier` key:**
```ts
agents: {
  generic: AgentDescriptor;
  technical: AgentDescriptor;
  classifier: AgentDescriptor;
};
```
`spectrum.ts` adds the corresponding entry once `build_acs_agents.mjs --list` prints the new agent's live ID (same pattern as the existing two).

**d. Dev/live ID verification for A4 uses the override mechanism designed in `04-architecture-review.md` §4** (`VITE_ACS_DEV_AGENT_IDS`, read in `web/src/config/active.ts`) — A4's repeated-query probe now needs THREE agents' `-dev` copies (Generic, Technical, classifier), not the two the original draft assumed. Without this, the path of least resistance is hand-editing `spectrum.ts` three times and reverting — exactly the failure shape this project has already been burned by once (`4a66cad`).

## `classifyOffer` (updated signature — targets the classifier agent, parses content not `.suggestions`)

```ts
export async function classifyOffer(
  config: CompletionsConfig,   // getAgentConfig(activeInstance.agents.classifier.id)
  query: string,
  genericAnswer: string,
  hits: Record<string, unknown>[],
): Promise<string[]>
```
Builds a single composite `query` string embedding the real question + Generic's real answer + Generic's real hits (serialized inline — `suggestions_generic.md`'s prompt content already assumes this shape of context, per `build.md:40`'s note that it needs a small edit to accept hits explicitly). Calls `callCompletions` against the classifier's own `agentId` with empty `history` (each classification call is independent, no cross-turn state). Parses the classifier's plain `content` response into a `suggestions`-shaped `string[]` (exact line/delimiter format is an implementation detail for Build, but must be asserted by a test against real captured classifier output — not assumed). Returns that array so it slots into the existing `deriveOfferState` contract unchanged.

## Feature flag / rollout

No feature flag — this is a direct swap of the signal source behind an already-shipped, already-live feature. Rollout is the `ACS_AGENT_SUFFIX` dry-run discipline, now covering three agents instead of two: build + test against `-dev` copies of Generic, Technical, and the new classifier (using `VITE_ACS_DEV_AGENT_IDS` client-side, per (d) above), live-verify (including the repeated-query regression case), only then touch the unsuffixed live path for all three.

## Rollback

Single-file revert (`useChat.ts`) + delete the classifier agent (dry-run suffix makes this trivial pre-flip; post-flip, `spectrum.ts`'s hardcoded `classifier` ID would need reverting alongside a redeploy, same shape as Generic/Technical rollback) + re-enable `config.suggestions` on Generic if it was disabled. Vercel redeploy of the previous commit is the standing fallback, same as every prior ACS change.

## Open questions — RESOLVED (previously open, pinned by 04-architecture-review.md)

1. ~~Which agent does the classification call target?~~ **Resolved: a new dedicated agent, `ACS-classifier-neural`.** See "Pinned decision" above for the grounded reasoning (wire-level, not inference).
2. ~~New agent or per-request instructions override?~~ **Resolved: new agent.** No per-request override field exists in `CompletionsRequest`/`callCompletions` today, and none was found in any spike/wire capture in this repo — building on an unverified capability would contradict this project's own "needs a live check, not assumed" discipline.

## Test plan (RED-first, real fixtures)
- `classifyOffer` given a real captured implementation-question answer+hits (from tonight's E2E run or a fresh live probe against the classifier) → returns an array containing a `SPECIALIST:`-prefixed entry.
- `classifyOffer` given a real captured design-question answer+hits → returns no `SPECIALIST:`-prefixed entry.
- `classifyOffer` calls the classifier's own `agentId` (`activeInstance.agents.classifier.id`), never Generic's — asserted on the request, not just the response (guards against a future refactor silently repointing it, per Risk's Go/No-Go item 2).
- Integration: `runTurn` derives `deepDiveOffered`/`deepDiveQuery` correctly from `classifyOffer`'s result via the unchanged `deriveOfferState` — no new logic duplicated.
- `build_acs_agents.mjs`: the classifier persona round-trips `config.suggestions.enabled === false`; the hard gate fails loudly if it ever comes back `true` (C4's regression guard).
- **Acceptance gate (not the test suite):** live probe repeating an exact query twice in a row against `-dev` copies of all three agents — offer must appear both times. This is Task A4 from the build doc and is the actual regression test for the bug, since unit tests with fixtures can't exercise Agent Studio's real cache.

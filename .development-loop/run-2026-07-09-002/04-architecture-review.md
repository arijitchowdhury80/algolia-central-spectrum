# 04 — Architecture Review

**Note on reviewer substitution:** the `code-review` subagent this stage normally dispatches is unavailable in this environment. Per the pipeline's own fallback rule, `gsd-code-reviewer` ran this stage directly. This is architecture review, not code review — no implementation code exists yet for either track. Scope: verify `03-spec-track-a.md` (drafted) and `docs/plans/2026-07-10-reconciled-handoff-architecture-build.md` §2 (Track B, no spec file existed before this review) actually close out `02-risk-assessment.md`'s Go/No-Go conditions, and pin the items Risk explicitly left open.

Reviewed against the actual current code, not just the plan docs' prose: `web/src/hooks/useChat.ts`, `web/src/lib/agentStudio.ts`, `web/src/lib/agents.ts`, `web/src/types.ts`, `web/src/config/instance.ts`, `web/src/config/active.ts`, `web/src/config/instances/spectrum.ts`, `scripts/agents/agentConfig.mjs`, `scripts/agents/build_acs_agents.mjs`.

---

## Findings

### Critical

**C1 — Track B's plan text still literally says to source the live agent call from the orchestrator's own tool-call `args`, contradicting the Risk stage's own HIGH finding.**
`docs/plans/...build.md:78`: *"call REAL Generic directly with the tool call's `query` arg"*. `02-risk-assessment.md`'s pre-mortem (row 1) and Go/No-Go item 1 both require this be corrected to always use `turn.query`/`turn.deepDiveQuery` — the tool call's `args` may be read only to identify WHICH tool fired, never as the literal text forwarded to a live agent. No spec file previously translated this correction into an actual contract; `04-spec-track-b.md` (new, written as part of this review) pins it with the exact `runTurn` call sites and a required RED test. Until this lands as a spec (not just a risk-assessment sentence), Build has no written contract to implement against or be reviewed against.

**C2 — `scopeTools` has no way to express "zero search tools," and this is not a Track-B-only gap — Track A's own resolved design (see C3/C4 below) now needs it too.**
`build_acs_agents.mjs:35-40` unconditionally clones whatever `algolia_search_index` tool the clone-base agent has onto every persona. Risk's Go/No-Go item 2 required a `noSearchTool` escape hatch before B1. This review specifies the minimal concrete change (below) and applies it to BOTH the orchestrator persona (Track B) and the new classifier persona this review pins for Track A (see C3) — the classifier must not be able to search independently either, or it stops being a controlled, context-bounded classification call and starts being a second uncontrolled retrieval per turn.

**C3 — Track A's Open Question 1/2 (which agent absorbs classification) cannot be answered "reuse Generic's own agentId" the way Risk's pre-mortem inferred — the wire mechanics rule it out. A new dedicated agent is required, which revises Intake #7's "no new dependency" framing for Track A.**
Grounded in `web/src/lib/agentStudio.ts` and `scripts/agents/agentConfig.mjs`:
- `callCompletions`'s `CompletionsRequest` (`agentStudio.ts:198-203`) has exactly two fields — `history` and `query`. There is no per-request instructions/system-prompt override. Calling Generic's existing `agentId` for classification means the classification prompt can only be smuggled into the `query` string, sitting underneath Generic's own baked `instructions_generic.md` system prompt (its full grounding/answering/search-tool-use instructions) — not replacing it. Generic still has its own `algolia_search_index` tool attached and no reason not to use it: a "classify this Q&A pair" message sent to Generic's real agentId can trigger a **second, independent, uncontrolled search** against the corpus and an attempt to *answer* the classification prompt as if it were a real user question, rather than emit a clean signal. The spec draft's own reasoning already flagged this directionally ("(b)... lowest risk of surprising interaction with Generic's main-answer prompt") — this review confirms it's not just lower risk, it's the only wire-mechanically sound option, because there is no override field to make (a) behave differently.
- Separately: `config.suggestions` (the mechanism that populates `ParsedCompletion.suggestions[]` via the overloaded `2:` frame) is itself the platform-async job Track A exists to stop depending on. If the classification call is just another Agent Studio agent with `config.suggestions.enabled: true`, the classification signal is *itself* produced by a second instance of the exact racy async mechanism — reproducing the bug one hop downstream while looking fixed. The classification agent's answer must arrive as ordinary streamed **content** (`0:` frames), parsed as plain text/lines, never through `.suggestions`.
- **Pinned decision:** Track A needs a **third live agent** (`ACS-classifier-neural`), added through the same `buildAgentName`+`ACS_AGENT_SUFFIX` dry-run mechanism Track B was already required to use, with `noSearchTool: true` (per C2) and `config.suggestions` explicitly OFF (see C4). This revises Intake #7's "Track A: none new" dependency line and Intake #4/#13's implicit "only Track B adds new external state" framing — both need a one-line correction, not a re-litigation of scope classification (still FULL PATH regardless; this doesn't change that).

**C4 — Even with C3's classifier agent decided, `build_acs_agents.mjs`'s own hard gate (`assertSuggestionsEnabled`) will block the exact configuration Track A needs, and this is not the deferred/optional case the Risk assessment described.**
`agentConfig.mjs:58-66`'s `buildSuggestionsConfig` hardcodes `enabled: true` with no parameter to turn it off, and `build_acs_agents.mjs`'s loop (line 93) unconditionally `process.exit(1)`s if `config.suggestions.enabled !== true` comes back from the server, for every persona in `PERSONAS`. Risk's assessment (component 2 note) flagged this only as a future breakage IF optional A5 (turning suggestions off on Generic/Technical) is taken — but C3's classifier persona needs suggestions **OFF from the moment it's created**, which means the very first `build_acs_agents.mjs` run that includes it fails the hard gate as written, blocking Track A entirely, not just deferring A5. This needs a script-level fix before B1/A3, specified concretely below.

### Important

**I1 — `InstanceConfig.agents`'s fixed 2-key shape (`generic`/`technical`) has no room for the new classifier or orchestrator agents; this was flagged for Track B only (Risk STRIDE §5) but Track A now needs the same type change first.**
`web/src/config/instance.ts:57-60`. Both tracks need a new key. Track A ships first (Intake's sequencing), so the type change lands with Track A's `classifier` key, and Track B adds `orchestrator` on top of the same already-widened shape later — cleaner than each track inventing its own ad hoc extension.

**I2 — No client-side dev/live agent-ID override exists, and it is now a blocker for BOTH tracks' live verification, not just Track B's B4/B5.**
Risk flagged this as MEDIUM for Track B's `-dev` verification. Once C3 adds a classifier agent, Track A's own A4 (repeated-query live probe) also needs to run against `-dev` copies of THREE agents (Generic, Technical, and the new classifier) without hand-editing `spectrum.ts`. Design below is written once, used by both tracks.

**I3 — Track B's `build.md:76` overstates the work needed for the orchestrator's publish step; the code already does it.**
`build.md:76` says a publish step "needs" to be added: `POST /agents/{id}/publish`. Reading `build_acs_agents.mjs:83-87`, this call already exists unconditionally on the create-new-agent branch (`if (![200, 201].includes(c.status))... id = c.json.id...; await call('POST', /agents/${id}/publish, {})`). Adding a third `PERSONAS` entry for the orchestrator gets this for free — B1's task list should say "confirmed already handled by the existing create path," not describe it as new work. Small, but exactly the kind of stale premise that causes wasted Build time.

**I4 — Track B's `runTurn` rewrite, once B0/B3 land, will be feeding the orchestrator's resume call an `offerSpecialist` value that Track A will have already changed the source of by the time Track B builds.**
`build.md:78` describes `offerSpecialist` as "STILL sourced from Generic's real suggestion" (i.e., `genericResult.suggestions`, the pre-Track-A mechanism). Per Intake's own sequencing (Track A ships and is verified live before Track B's Build starts), by the time B3 is written, `useChat.ts`'s offer signal will already be `deriveOfferState(classifyOffer(...), ...)`, not `genericResult.suggestions` — that field may not even exist as a populated value anymore if A5 is taken. `04-spec-track-b.md` (new) pins this: B3 must source `offerSpecialist` from the post-Track-A `deriveOfferState` result, not re-introduce a read of the old field.

### Minor / correct as-is

**M1 — Risk's STRIDE analysis of the classification call's tamper/info-disclosure surface (component 1) holds regardless of the (a)-vs-(b) agent decision.** The admin-key and `deriveOfferState`-contract reasoning in `02-risk-assessment.md` §1 doesn't depend on which agentId the classification call targets; C3's pin doesn't reopen it.

**M2 — `assertSuggestionsEnabled`'s use for Generic/Technical (unchanged personas) is untouched by C4's fix** — the fix is additive (a per-persona expectation flag defaulting to today's `true`), so the two live agents keep the exact same hard-gate behavior they have today. No regression risk for the two already-shipped agents.

---

## Pinned answers to the four review questions

### 1. Track B query-provenance fix → written into `04-spec-track-b.md` (new)
`runTurn`'s orchestrator-driven rewrite must call Generic/Technical with `turn.query`/`turn.deepDiveQuery` (the client's own trusted value), using the intercepted tool call's `args` only to determine which tool fired (`call_generalist` vs `call_specialist`). See `04-spec-track-b.md` §2 for the exact call-site contract and required RED test (feed a tool-call frame whose `args.query` differs from the turn's real query; assert the real call still uses the turn's query).

### 2. `scopeTools` `noSearchTool` escape hatch — minimal concrete design

Current (`build_acs_agents.mjs:35-40`):
```js
function scopeTools(tools, filters, desc) {
  const searchTools = tools.filter((t) => t.type === 'algolia_search_index');
  const t = JSON.parse(JSON.stringify(searchTools));
  for (const tool of t) { tool.description = desc; if (Array.isArray(tool.indices)) for (const ix of tool.indices) { ix.index = INDEX; ix.description = desc; ix.searchParameters = ix.searchParameters ?? {}; if (filters) ix.searchParameters.filters = filters; else delete ix.searchParameters.filters; } }
  return t;
}
```

Change (backward-compatible — 4th arg is optional, default `false`, so Generic/Technical's existing call sites need zero edits and zero behavior change):
```js
function scopeTools(tools, filters, desc, { noSearchTool = false } = {}) {
  if (noSearchTool) return [];
  const searchTools = tools.filter((t) => t.type === 'algolia_search_index');
  const t = JSON.parse(JSON.stringify(searchTools));
  for (const tool of t) { tool.description = desc; if (Array.isArray(tool.indices)) for (const ix of tool.indices) { ix.index = INDEX; ix.description = desc; ix.searchParameters = ix.searchParameters ?? {}; if (filters) ix.searchParameters.filters = filters; else delete ix.searchParameters.filters; } }
  return t;
}
```

Call site (`build_acs_agents.mjs:63,66`) threads the new field through the existing destructure — no other change needed:
```js
for (const { name, prompt, filters, desc, extraTools, noSearchTool } of PERSONAS) {
  ...
  const tools = [...scopeTools(base.tools, filters, desc, { noSearchTool }), ...extraTools];
```

`PERSONAS` entries for Generic/Technical are untouched (no `noSearchTool` key → `undefined` → default `false`, identical behavior to today). The orchestrator (Track B) and classifier (Track A, C3) personas both add `noSearchTool: true`. This is the single mechanism both tracks' new agents need — designed once here, consumed by both specs.

### 3. Track A's open questions — pinned (see C3/C4 above for the grounded reasoning)
- **Which agent absorbs the classification call:** a new dedicated agent, `ACS-classifier-neural`, NOT Generic's existing `agentId`.
- **New agent ID or per-request override:** new agent ID — no per-request instructions-override field exists in `CompletionsRequest`/`callCompletions` today, and building on an unverified platform capability (never seen in any spike/wire capture in this repo) would contradict this project's own "needs a live check, not assumed" discipline. The proven pattern (10/10 in the E2E spike) is a dedicated agentId called via the existing `callCompletions` client, unchanged.
- Full pin, with the script-level fix for C4 and the `InstanceConfig` type change for I1, is written into the updated `03-spec-track-a.md`.

### 4. Dev/live agent-ID override — minimal concrete design (serves both tracks, per I2)

Add one JSON-shaped Vite env var, parsed once in `active.ts`, overriding only the keys present — absent/unset behaves exactly as today:

```ts
// web/src/config/active.ts
import type { InstanceConfig } from './instance';
import spectrumInstance from './instances/spectrum';
import '../themes/algolia-adobe.css';

/**
 * Dev/live agent-ID override. VITE_ACS_DEV_AGENT_IDS, if set, is a JSON object
 * mapping agent key -> a `-dev`-suffixed agent's real ID, e.g.
 * '{"generic":"<dev-id>","classifier":"<dev-id>"}'. Lets a `-dev` build point
 * at ACS_AGENT_SUFFIX=-dev agents (built by build_acs_agents.mjs) without
 * hand-editing spectrum.ts's live-hardcoded IDs — the exact manual-edit
 * failure shape behind incident 4a66cad. Unset → today's behavior, unchanged.
 */
function withDevAgentOverrides(instance: InstanceConfig): InstanceConfig {
  const raw = import.meta.env.VITE_ACS_DEV_AGENT_IDS;
  if (!raw) return instance;
  let overrides: Record<string, string>;
  try {
    overrides = JSON.parse(raw);
  } catch {
    console.error('[active] VITE_ACS_DEV_AGENT_IDS is set but not valid JSON — ignoring, using live agent IDs.');
    return instance;
  }
  const agents = { ...instance.agents } as Record<string, InstanceConfig['agents']['generic']>;
  for (const [key, devId] of Object.entries(overrides)) {
    if (agents[key] && devId) agents[key] = { ...agents[key], id: devId };
  }
  // Loud, unmissable — this must never be quietly true in a production build.
  console.warn(`[active] DEV AGENT ID OVERRIDE ACTIVE for: ${Object.keys(overrides).join(', ')} — this build is NOT using live agent IDs.`);
  return { ...instance, agents: agents as InstanceConfig['agents'] };
}

export const activeInstance = withDevAgentOverrides(spectrumInstance);
```

`web/.env.local.example` gets a new commented-out line documenting the shape. The `console.warn` is deliberate and load-bearing, not debug noise: it's the one place a `-dev`-pointed build announces itself, so B4/B5 (and Track A's own A4 once the classifier exists) can visually confirm they're hitting dev agents, and so nobody ships this flag set in a production build unnoticed.

---

## Verdict

**Track A: approve with changes — ready for Build once `03-spec-track-a.md`'s pinned updates (this review) are in place.** The two open questions are now answered with wire-level evidence, not inference; the follow-on script fix (C4) and type change (I1) are small, mechanical, and don't touch the two already-shipped agents' behavior. Nothing here reopens Risk's Go/No-Go — it tightens item 2 ("target agent named explicitly, covered by a test") with a concrete answer plus the two downstream fixes that answer requires.

**Track B: not yet ready for Build — one item remains genuinely open, and it is not this review's to resolve.** `build.md`'s open question 2 (auto-chain vs. keep the human deep-dive gate, B0) is a UX decision, explicitly deferred to Arijit in the plan doc itself, and this review has not seen a decision recorded anywhere in this run's artifacts. Everything this review COULD pin without that decision has been pinned: the query-provenance fix (C1, HIGH from Risk, now a real spec), the `scopeTools` escape hatch (C2), and the integration correction against Track A's landed changes (I4). `04-spec-track-b.md` is written up to and blocked on B0 — Build should not start on B3 (the `runTurn` rewrite) until B0 is answered, though B1/B2 (agent creation, frame-parsing wiring) have no dependency on B0 and could proceed in parallel once Track A ships per Intake's sequencing.

**Recommendation:** proceed to Plan stage for Track A now. For Track B, either get B0's answer from Arijit before Plan starts, or scope Track B's Plan stage to B1/B2 only and gate B3-B6 on B0 being answered — don't let B0 slide into Build as a silent default (this is exactly the failure shape this project's own Cardinal Rules exist to prevent).

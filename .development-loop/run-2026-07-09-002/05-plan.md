# 05 — Plan (Stage 5 output → drives Stage 6 Build)

**Scope: Track A only.** Track B (the pure-orchestrator) is killed for this run — see `01-intake.md`'s revised Scope Note (auto-chain orchestrator hop is provably redundant once the client computes `offerSpecialist` itself via the classifier). `04-spec-track-b.md` stays shelved-for-AC2, untouched by this plan.

Builder: **module-builder** (no new UI surface — this rewires an existing hook + an existing build script, and adds one new invisible plumbing agent; nothing user-facing is added or restyled).

Grounded directly in the current code (not re-derived from 01–04 alone): `web/src/hooks/useChat.ts`, `web/src/hooks/useChat.test.ts`, `web/src/lib/agentStudio.ts`, `web/src/lib/agentStudio.test.ts`, `web/src/lib/agents.ts`, `web/src/types.ts`, `web/src/config/instance.ts`, `web/src/config/active.ts`, `web/src/config/instances/spectrum.ts`, `web/src/components/DiscoveryCard.tsx`, `scripts/agents/agentConfig.mjs`, `scripts/agents/agentConfig.test.mjs`, `scripts/agents/build_acs_agents.mjs`, `scripts/agents/suggestions_generic.md`, plus `docs/spikes/2026-07-09-suggestions-frame-findings.md` (the real wire evidence for how the *old* mechanism's caching race actually manifests) and `SESSION.md` (current shipped state, cache-poisoning precedent).

---

## 0. Gaps found reading the actual code (not caught by 02/03/04)

Three real gaps, all closed below, none deferred:

**Gap 1 — `03-spec-track-a.md`'s own pinned `PERSONAS` example reuses `suggestions_generic.md` verbatim as the classifier's full agent `instructions`, but that file is a live, still-shipping prompt for a *different* contract and reusing it is a real regression risk, not just a style choice.**
`suggestions_generic.md` today is loaded by `agentConfig.mjs`'s `SUGGESTIONS_PROMPT` map and used as `config.suggestions.system_prompt` for Generic's own **native, platform-managed** suggestion job — a job that receives its context (the turn's tool outputs) automatically from the platform via `context: { include_tool_outputs: true }`. The new classifier agent has no tool call at all (`noSearchTool: true`, Gap-driving decision C2/C3) and receives history-less, tool-less standalone completions — the ONLY way it ever sees the question/answer/hits is if the client embeds them literally inside the `query` string it sends. `classifyOffer`'s own contract note ("`suggestions_generic.md`'s prompt content... needs a small edit to accept hits explicitly") is really asking to change the platform-context-assuming prompt into a client-embedded-context-parsing prompt — editing the SAME file both ways at once would risk regressing Generic's still-live, already-shipped mechanism (production, `main`, `111c8fd`) for the sake of a brand-new agent with a different context-delivery contract. **Fix (Task A2 below): a NEW, separate prompt file, `scripts/agents/instructions_classifier.md`, adapted from — not sharing — `suggestions_generic.md`'s decision logic. `suggestions_generic.md` is not touched by this plan at all.** This matches the user's own framing of the task ("it needs its own prompt file, likely adapting `suggestions_generic.md`'s content") — the adaptation is content-level, not file-level.

**Gap 2 — three files' doc comments describe the *current* (pre-Track-A) signal source and will be actively wrong the moment this ships; two of the three aren't mentioned in 02/03/04 at all.**
Grepped `genericResult.suggestions` and `config.suggestions` across `web/src`:
- `web/src/hooks/useChat.ts:1-21` (the file header) — already found by 03/04's own reasoning, since it's the file being rewired.
- `web/src/types.ts:54-56` (`ChatTurn`'s doc comment) — "Generic *offers* a specialist deep-dive when its native `config.suggestions` completion emits a `SPECIALIST:`-prefixed suggestion" — **not mentioned in 03 or 04.** Wrong the moment `runTurn` stops reading `genericResult.suggestions`.
- `web/src/components/DiscoveryCard.tsx:10-11` — "`extractDeepDiveOffer(genericResult.suggestions)`" **literally names the field this plan retires — not mentioned in 03 or 04.**
All three get corrected in the same task that lands the functional rewiring (Task A7 below) — same class of "don't leave prose describing a retired mechanism" bug this project has hit at least three times already (the HANDOFF tool section, the `[[FOLLOWUP:]]` sentinel, `DiscoveryCard.tsx`'s comment after the *previous* migration — see `run-2026-07-08-001/06-plan.md` Task B8).

**Gap 3 — `callWithRetry` (the ~1-in-8-flake retry wrapper) is private to `useChat.ts`, but the new `classifyOffer` needs the identical resilience and lives in a new file — moving it, not duplicating it, avoids both a code-duplication regression and a circular import.**
`classifyOffer` will live in a new `web/src/lib/classifier.ts` (Task A6, single-responsibility, matches this codebase's one-file-one-job convention: `agentStudio.ts` = wire protocol, `agents.ts` = env/config plumbing). If `classifier.ts` imports `callWithRetry` from `useChat.ts`, and `useChat.ts` imports `classifyOffer` from `classifier.ts`, that's a circular import. **Fix (Task A6): move `callWithRetry` into `agentStudio.ts`** (it's generically "retry any `callCompletions` call," not chat-turn-specific — a more natural home than `useChat.ts` anyway) and export it; both `useChat.ts` and `classifier.ts` import the one shared copy. Its `onText` param becomes optional (`onText?: ...`, matching `callCompletions`'s own already-optional `onText?`) since classification never streams to the UI.

---

## 1. Builder + branch strategy

**Cut a fresh branch off `main` before Task A1** — do not build on `main` directly. Two reasons, neither about branch-topology-as-safety (this project's own prior finding, `run-2026-07-08-001/06-plan.md` §1, is that branch topology never was the real protection — the `ACS_AGENT_SUFFIX` dry-run discipline is):
1. `main` currently has real uncommitted state unrelated to this build (`git status`: `CLAUDE.md` and `SESSION.md` modified, plus a pile of untracked `docs/spikes/*`, `docs/plans/*`, `.development-loop/*`, and `scripts/spikes/agent-tool-handoff/*` files from tonight's E2E-validation work). Building Track A directly on top of that mixes two unrelated units of history.
2. This build creates a **third live agent** (a new, not-yet-existing external resource) and changes a production TypeScript type (`InstanceConfig.agents`) — the same "production ID surface" criterion that put this whole run on the FULL PATH per Intake #8.

Suggested name: `feat/track-a-classifier-offer-signal`. Not prescriptive beyond that — any name is fine as long as it isn't `main`.

**The actual mitigation, as before, is the suffix discipline:** no task in Wave 0–5 may run `node scripts/agents/build_acs_agents.mjs` without `ACS_AGENT_SUFFIX=-dev` set. The one unsuffixed run happens in Task A9, after explicit human sign-off. Same rule, same enforcement shape as the prior migration's Task B2/B9 (`run-2026-07-08-001/06-plan.md` §4).

**Two test runners, same split as the prior migration, for the same reason:** `web/` gets **vitest** (already wired — `web/vite.config.ts`, `web/package.json`); `scripts/agents/` gets Node's built-in **`node:test`** (already wired — `agentConfig.test.mjs` exists and passes today). No new toolchain either side of this build needs.

---

## 2. Task breakdown

Nine tasks, `A1`–`A9`. Each names files touched, the RED test to write first (real captured fixtures where the test concerns actual agent/wire behavior; synthetic strings are fine for pure string-plumbing tests — same discipline this repo's own `useChat.test.ts`/`agentStudio.test.ts` already draw that line at), acceptance criteria, and dependencies.

Cross-reference to the original task labels: `docs/plans/2026-07-10-reconciled-handoff-architecture-build.md` §1 named Track A's tasks A1–A7 *before* the Architecture Review pinned the "classifier needs to be a new dedicated agent" decision (C3) — that decision added real infra work (a `noSearchTool` escape hatch, a suggestions-off hard gate, a new `InstanceConfig` key, a dev/live ID override) the original 7-task sketch didn't anticipate. This plan's A1–A9 supersede that sketch; inline notes below map each new task back to the original label it descends from or the review finding (C2/C3/C4/I1/I2) that drove it.

---

### Task A1 — `noSearchTool` escape hatch + suggestions-off support (script infra, no persona changes yet)

**Files:** `scripts/agents/agentConfig.mjs` (modify), `scripts/agents/agentConfig.test.mjs` (modify), `scripts/agents/build_acs_agents.mjs` (modify).

**Descends from:** Architecture Review C2 (`scopeTools` has no "zero search tools" path) + C4 (`buildSuggestionsConfig`/`assertSuggestionsEnabled`'s hard gate can't express "expected off"). Both are prerequisites for Task A4's classifier persona and are pure, mechanical, already pinned with exact code in `04-architecture-review.md` §2 and `03-spec-track-a.md` §(b) — this task implements them as written, with one testability refinement (below).

**Testability refinement (why this isn't a 1:1 copy of the review's snippet):** `scopeTools` lives today as an unexported function inside `build_acs_agents.mjs`, which does `const existing = await listAgents();` as unguarded top-level `await` — importing that file at all triggers a real network call (this is exactly why `PERSONAS`/`buildAgentName`/`buildSuggestionsConfig`/`buildAgentBody`/`assertSuggestionsEnabled` already live in the network-free `agentConfig.mjs`, per the prior migration's Task B2). **Move `scopeTools` into `agentConfig.mjs` too, exported**, so its new `noSearchTool` branch is directly unit-testable without a live API call. `build_acs_agents.mjs` imports it from there instead of defining it locally.

**Change — `agentConfig.mjs`:**
- Add (moved from `build_acs_agents.mjs`, `INDEX` already in scope): `export function scopeTools(tools, filters, desc, { noSearchTool = false } = {}) { if (noSearchTool) return []; ...unchanged body... }`.
- `buildSuggestionsConfig(systemPrompt, enabled = true)` — add the second parameter; body unchanged except `enabled: true` becomes `enabled`. Default `true` keeps every existing call site (Generic, Technical) byte-identical.

**Change — `build_acs_agents.mjs`:**
- Import `scopeTools` from `agentConfig.mjs`; delete the local definition.
- The `PERSONAS` loop destructure gains `noSearchTool, expectSuggestions`: `for (const { name, prompt, filters, desc, extraTools, noSearchTool, expectSuggestions } of PERSONAS)`.
- `const tools = [...scopeTools(base.tools, filters, desc, { noSearchTool }), ...extraTools];`
- `const wantSuggestions = expectSuggestions ?? true;` then `buildSuggestionsConfig(SUGGESTIONS_PROMPT[name] ?? '', wantSuggestions)`.
- Post-write verification block: replace the unconditional `assertSuggestionsEnabled(...) ? 'on' : 'MISSING'` + unconditional exit with the two-sided check from `03-spec-track-a.md` §(b): log `suggestions=${enabledOk ? 'on' : 'off'} (expected ${wantSuggestions ? 'on' : 'off'})`; `if (wantSuggestions && !enabledOk)` exit 1 with the existing message; **new:** `if (!wantSuggestions && enabledOk)` exit 1 with *"expected suggestions OFF but server reports ON — hard gate failed (would silently reintroduce the caching-race signal path this track exists to remove)"*.

**RED test (`agentConfig.test.mjs`, `node --test`), written against the not-yet-moved/not-yet-changed functions first (fails: `scopeTools is not exported` / wrong arity):**
1. `scopeTools([{type:'algolia_search_index', indices:[{index:'x'}]}], null, 'd', { noSearchTool: true })` → `[]`.
2. `scopeTools([{type:'algolia_search_index', indices:[{index:'x'}]}], null, 'd')` (no options arg at all) → unchanged existing behavior (a one-element array with `indices[0].index === INDEX`) — proves the default (`noSearchTool: false`) doesn't regress Generic/Technical.
3. `buildSuggestionsConfig('p')` (1-arg call, existing test) → still `enabled: true` (backward-compat regression guard on the new default parameter).
4. `buildSuggestionsConfig('p', false)` → `enabled: false`, every other field unchanged.

**Acceptance:** `node --test scripts/agents/agentConfig.test.mjs` passes, including the 3 pre-existing tests untouched. `build_acs_agents.mjs` has zero remaining local `function scopeTools`. The hard-gate control-flow change itself (the two `if` branches) is **not** unit-testable without a live agent (same reasoning as the prior migration's Task B3) — its correctness is confirmed live in Task A5.

**Depends on:** nothing. **Wave 0** — parallel with A2, A3 (zero file overlap).

---

### Task A2 — `instructions_classifier.md` (new prompt file — content only, no code)

**Files:** `scripts/agents/instructions_classifier.md` (new).

**Why a new file, not an edit to `suggestions_generic.md`:** Gap 1 above. This file becomes the classifier agent's own full `instructions` (its entire system prompt — it has no other role), not a `config.suggestions.system_prompt` snippet.

**Content requirements (Build writes the final copy; this pins the contract, same convention as the prior migration's Task B1):**
- **Role framing:** this agent never searches (it has no search tool — structurally true once A4 sets `noSearchTool: true`, not just an instruction), never answers the end user, and its entire output is machine-parsed — no exposition, no markdown, no explaining its own reasoning, no preamble.
- **Input contract — pin this exact delimited shape** (the same shape Task A6's `buildClassificationQuery` constructs and Task A5's probe script sends, so prompt and client-code agree byte-for-byte):
  ```
  QUESTION:
  <the user's real question, verbatim>

  GENERIC'S ANSWER:
  <the front agent's real streamed answer, verbatim>

  RETRIEVED HITS (JSON):
  <a JSON array of the real retrieved hit objects>
  ```
  State explicitly that this agent receives no conversation history and no tool-provided context (unlike Generic's own native suggestion job) — everything it needs is in this one message, and it must parse the three sections itself.
- **Decision logic — port the exact criteria from `suggestions_generic.md`'s "Decide which of two kinds of suggestion to emit" section, adapted for this input shape, not re-derived:** emit a deep-dive offer only when the QUESTION was implementation-heavy (how do I build/implement/create/code/write/use/set up/wire X in React (Spectrum), a request for a code example, exact props/types, hooks wiring, TypeScript, event handlers, or version-specific API); otherwise an ordinary follow-up.
- **Output contract — pin this exactly, it is what `parseClassifierResponse` (Task A6) parses:** respond with **exactly one line of plain text**, no other content. Either `SPECIALIST: <resolved deep-dive question>` (case-sensitive prefix, resolving pronouns/references against the supplied QUESTION/ANSWER — matches `extractDeepDiveOffer`'s existing case-insensitive-trim matching, unchanged) or an ordinary one-sentence follow-up with no prefix.
- **Grounding rule for the suggestion text itself — port verbatim from `suggestions_generic.md`'s "How to write the suggestion text" section:** name a specific real thing from the supplied HITS that the ANSWER did not already cover; react to what this user actually cares about; vary phrasing turn to turn (this agent has no turn-to-turn memory itself, but the ANSWER/QUESTION context still varies); one sentence; never tease something the hits can't answer.

**RED test:** none — content-only file with no executable surface (same convention as the prior migration's Task B1/B8 comment-only edits — `verify` tooling isn't invoked on doc-only changes). Its correctness is verified empirically in Task A5 (does the real model, given this real prompt, actually classify correctly).

**Acceptance:** file exists, names the `SPECIALIST:` marker exactly matching `extractDeepDiveOffer`'s case-sensitive slice point, and states the QUESTION/GENERIC'S ANSWER/RETRIEVED HITS delimiter shape explicitly (Task A5's probe and Task A6's `buildClassificationQuery` must byte-match this).

**Depends on:** nothing. **Wave 0** — parallel with A1, A3.

---

### Task A3 — `VITE_ACS_DEV_AGENT_IDS` dev/live agent-ID override (`active.ts`)

**Files:** `web/src/config/active.ts` (modify), `web/src/config/active.test.ts` (new), `web/.env.local.example` (modify).

**Descends from:** Architecture Review I2 (no client-side dev/live override exists; blocks BOTH Track A's own A5/A8 live verification and, previously, Track B's — Track B is dead for this run, but the mechanism is needed regardless).

**Testability refinement over the review's pinned snippet (`04-architecture-review.md` §4):** the reviewed design reads `import.meta.env.VITE_ACS_DEV_AGENT_IDS` *inside* `withDevAgentOverrides`, which makes the function untestable without mocking Vite's env object — and this codebase has no existing precedent for doing that (no test mocks `import.meta.env` anywhere today; `agents.ts`'s `getEnvConfig` reads it directly and has no test either). **Split the env read out as an explicit second parameter** so the merge logic itself is a pure function:

```ts
export function withDevAgentOverrides(
  instance: InstanceConfig,
  rawOverrides: string | undefined,
): InstanceConfig {
  if (!rawOverrides) return instance;
  let overrides: Record<string, string>;
  try {
    overrides = JSON.parse(rawOverrides);
  } catch {
    console.error('[active] VITE_ACS_DEV_AGENT_IDS is set but not valid JSON — ignoring, using live agent IDs.');
    return instance;
  }
  const agents = { ...instance.agents } as Record<string, InstanceConfig['agents']['generic']>;
  for (const [key, devId] of Object.entries(overrides)) {
    if (agents[key] && devId) agents[key] = { ...agents[key], id: devId };
  }
  console.warn(`[active] DEV AGENT ID OVERRIDE ACTIVE for: ${Object.keys(overrides).join(', ')} — this build is NOT using live agent IDs.`);
  return { ...instance, agents: agents as InstanceConfig['agents'] };
}

export const activeInstance = withDevAgentOverrides(spectrumInstance, import.meta.env.VITE_ACS_DEV_AGENT_IDS);
```

Same behavior, same semantics as the reviewed design (unset → today's behavior unchanged; malformed JSON → loud console error, falls back to live; only keys already present on `instance.agents` get overridden, so an override targeting a not-yet-existing key is a silent no-op by construction — this is what lets A3 ship in Wave 0 *before* A4 adds the `classifier` key: once A4 lands, the exact same override code starts working for `classifier` with zero further changes here).

`web/.env.local.example` gets one new commented-out line documenting the shape, e.g. `# VITE_ACS_DEV_AGENT_IDS={"classifier":"<dev-agent-id>"}` with a one-line comment pointing at this mechanism.

**RED test (`active.test.ts`, vitest — synthetic fixture instance, no real agent IDs needed):**
1. `withDevAgentOverrides(mockInstance, undefined)` → returns the exact same object reference or deep-equal instance (identity/no-op).
2. `withDevAgentOverrides(mockInstance, '{"classifier":"dev-id-123"}')` where `mockInstance.agents.classifier` already exists → returned instance's `agents.classifier.id === 'dev-id-123'`; every other agent key unchanged.
3. `withDevAgentOverrides(mockInstance, 'not valid json')` → returns unchanged instance; `console.error` called once (spy).
4. `withDevAgentOverrides(mockInstance, '{"nonexistentKey":"x"}')` → returns instance unchanged (no key on `agents` to overwrite — proves the override is inert against an unknown key rather than inventing one).
5. Applying any real override → `console.warn` called (spy) — this is the "unmissable in a real build" guarantee the review's design intentionally makes load-bearing.

**Acceptance:** `cd web && npx vitest run src/config/active.test.ts` passes (5/5). `activeInstance`'s own module-level wiring (`withDevAgentOverrides(spectrumInstance, import.meta.env.VITE_ACS_DEV_AGENT_IDS)`) compiles clean under `tsc -b`.

**Depends on:** nothing (works against a synthetic mock instance; doesn't need A4's `classifier` key to exist yet, per the no-op-on-unknown-key behavior above). **Wave 0** — parallel with A1, A2.

---

### Task A4 — Classifier persona wiring (`PERSONAS` entry + `InstanceConfig` type + `spectrum.ts` placeholder)

**Files:** `scripts/agents/agentConfig.mjs` (modify — same file as A1, sequential), `scripts/agents/agentConfig.test.mjs` (modify), `web/src/config/instance.ts` (modify), `web/src/config/instances/spectrum.ts` (modify).

**Descends from:** Architecture Review C3 (classifier must be a new dedicated agent) + I1 (`InstanceConfig.agents`'s fixed 2-key shape has no room for it). This is where A1's and A2's infra get consumed for the first time.

**Change — `agentConfig.mjs`'s `PERSONAS` array — append (Generic/Technical entries untouched, zero behavior change to either):**
```js
{
  name: 'ACS-classifier-neural',
  prompt: 'instructions_classifier.md',
  filters: null,
  desc: 'ACS_SPECTRUM_MULTI classifier — no independent search, classifies from supplied context only.',
  extraTools: [],
  noSearchTool: true,
  expectSuggestions: false,
}
```
(Exact fields pinned by `03-spec-track-a.md`'s "Required changes" §(a); the `prompt` filename is the one difference from that doc's literal example, per Gap 1 above.)

**Change — `web/src/config/instance.ts`:** `InstanceConfig.agents` gains `classifier: AgentDescriptor;` alongside `generic`/`technical`.

**Change — `web/src/config/instances/spectrum.ts`:** add a `classifier` entry to `agents`. **The `id` value here cannot be real yet** — the live agent doesn't exist until Task A9's flip. Use an explicit, self-documenting placeholder, not a blank string that could be mistaken for a bug:
```ts
classifier: {
  id: 'PENDING-A9-LIVE-FLIP', // set to the real live ID by Task A9 — see build_acs_agents.mjs output
  label: 'Classifier (internal)',
  accentToken: '--ac-agent-classifier',
},
```
Note for Build: `label`/`accentToken` are required by the `AgentDescriptor` type but are functionally inert here — no `AnswerSegment` ever has `agent: 'classifier'` (`AgentKind` stays `'generic' | 'technical'`, unchanged; the classifier is invisible plumbing, never a rendered chat participant). No CSS token needs to be defined for `--ac-agent-classifier`; nothing reads it. This is deliberate, not an oversight — don't "complete" `AgentKind` to include `'classifier'`.

**RED test (`agentConfig.test.mjs`):**
1. `PERSONAS.find(p => p.name === 'ACS-classifier-neural')` exists, has `noSearchTool: true`, `expectSuggestions: false`, `prompt: 'instructions_classifier.md'`.
2. `PERSONAS.length === 3` (regression guard — catches an accidental duplicate-append or a lost entry on a future edit).

**Acceptance:** both new tests pass alongside A1's and the 3 pre-existing tests (`node --test scripts/agents/agentConfig.test.mjs`, 9/9 total). `cd web && tsc -b` is clean with the widened `InstanceConfig`/`spectrum.ts`. `scripts/agents/instructions_classifier.md` (A2) is a real, non-empty file at this point — a dangling `prompt` reference would only surface at Task A5's live run (`loadPrompt` does a plain `readFileSync`, no compile-time check), so confirm the file exists as part of this task's own acceptance, don't defer discovering a typo to A5.

**Depends on:** A1 (needs `noSearchTool`/`expectSuggestions` params to exist on `scopeTools`/`buildSuggestionsConfig`) + A2 (needs the real prompt file to reference). **Wave 1.**

---

### Task A5 — Empirical discovery: real classifier response, captured live (investigation task, no product code)

**Files produced:** `docs/spikes/2026-07-10-classifier-empirical-findings.md` (new), `docs/spikes/2026-07-10-classifier-probe-implementation.txt` (new, raw capture), `docs/spikes/2026-07-10-classifier-probe-design.txt` (new, raw capture). No `web/` or `scripts/agents/` product code changes in this task.

**Descends from:** original build.md's A1 ("use REAL captured content... not synthesized text") pushed earlier in sequence, because unlike the original 7-task sketch (which assumed the classification prompt could reuse Generic's own agentId, live *today*), this design's target agent (`ACS-classifier-neural`) doesn't exist until A4 lands and a `-dev` copy is built. Same method precedent used for the analogous gap (`run-2026-07-08-001/06-plan.md` Task B4, and this session's own `2026-07-09-suggestions-frame-findings.md`): probe the real API, capture raw frames, never assume the abstract shape is the wire shape.

**Method:**
1. `ACS_AGENT_SUFFIX=-dev node scripts/agents/build_acs_agents.mjs` — creates/confirms `-dev` copies of all three personas. **This is the first live exercise of A1's hard-gate fix** — confirm in the real terminal output that `ACS-classifier-neural-dev` reports `suggestions=off (expected off)` and does **not** exit 1 (proving the new two-sided gate branch actually works, not just its unit-tested pure-function half). Confirm `ACS-generic-neural-dev`/`ACS-technical-neural-dev` still report `suggestions=on (expected on)` — zero regression on the two already-shipped personas.
2. Call the **live production** `ACS-generic-neural` (id `95826da6-d1b6-4b81-b061-bfb52b881356` — read-only from the client's perspective, the exact call every real visitor already makes) with a real implementation-flavored question, to get a genuinely real answer + real hits. **Reuse the exact wording already proven live to trigger a `SPECIALIST:` classification** — `docs/spikes/2026-07-09-suggestions-frame-findings.md` §2 has one verbatim ("...a controlled TextField with onChange and validation state in React Spectrum S2 TypeScript"). **Do not reuse a literal current `sampleQuestions` entry from `spectrum.ts`** — this project has cache-poisoned a sample-question chip twice already (`SESSION.md`, commit `d7a999c` is the most recent fix for exactly this); a one-off probe call is harmless, but there's no reason to add risk to a live UI-facing cached string when an already-proven, non-chip wording is sitting right there in the spike evidence.
3. Repeat step 2 with a design-flavored question (reuse `2026-07-09-suggestions-frame-findings.md`'s own ordinary-path example, or a close paraphrase — same reasoning, avoid literal sample-question-chip text).
4. For each of the two captures: build the composite `query` string using the **exact** QUESTION/GENERIC'S ANSWER/RETRIEVED HITS delimiter format pinned in Task A2, with the real question, real answer text, and `JSON.stringify(hits)` of the real hits array. POST it (raw `fetch` or `curl`, admin or search key — either works for this endpoint, this call never leaves the machine, same convention as every prior spike script in `scripts/spikes/agent-tool-handoff/`) directly against `ACS-classifier-neural-dev`'s id from step 1. Capture the full raw response.
5. Confirm the implementation-question capture's response is a single line, `SPECIALIST:`-prefixed, naming something real from the supplied hits. Confirm the design-question capture's response is a single line, no `SPECIALIST:` prefix. If either capture doesn't match (wrong prefix behavior, multi-line, generic template text, empty response) — **iterate the prompt (A2) or the probe query, do not proceed to A6 on an assumption.** This mirrors the prior migration's own Task B4 acceptance bar exactly.
6. Watch the composite query's total length/latency during this step — `JSON.stringify(hits)` verbatim is the default per this plan (same information the platform already gave Generic's own native suggestion job, just delivered differently), but if it turns out unreasonably large or slow, note that in the findings file and trim to `{title, url, source}` per hit instead. Don't decide this in the abstract; decide it from what's actually observed here.

**Acceptance:** the findings file states, verbatim (not paraphrased): the classifier-dev agent's real ID, both raw captured responses, and an explicit confirmation of A1's hard-gate live behavior (step 1). Both `.txt` capture files hold the exact raw response bodies — these become Task A6's RED-test fixtures, pasted literally, per this repo's own `agentStudio.test.ts` convention ("Do not synthesize these").

**Depends on:** A4 (persona must exist in `PERSONAS` to be created). **Wave 2.**

---

### Task A6 — `classifyOffer` implementation (new module, RED tests against A5's real fixtures)

**Files:** `web/src/lib/classifier.ts` (new), `web/src/lib/classifier.test.ts` (new), `web/src/lib/agentStudio.ts` (modify — move + export `callWithRetry`, per Gap 3).

**Change — `agentStudio.ts`:** move `callWithRetry` here from `useChat.ts` verbatim, export it, widen its third parameter to `onText?: (accumulated: string) => void` (was required; classification never streams). No change to its retry semantics (network error OR successful-but-empty completion → one retry, rethrow if the retry also fails).

**Change — `classifier.ts` (new):**
```ts
export function buildClassificationQuery(
  query: string,
  genericAnswer: string,
  hits: Record<string, unknown>[],
): string
```
Builds the exact QUESTION/GENERIC'S ANSWER/RETRIEVED HITS delimited string pinned in Task A2 — `JSON.stringify(hits)` for the hits section, per A5's finding (or A5's trimmed alternative, if that's what A5 concluded).

```ts
export function parseClassifierResponse(content: string): string[]
```
`content.split('\n').map(l => l.trim()).filter(Boolean)` — defensive (never throws on a stray blank line or extra whitespace), matches the "malformed input degrades gracefully, never crashes" discipline every other parser in this codebase already follows (`agentStudio.ts`'s frame handlers, `extractDeepDiveOffer`'s tolerant matching).

```ts
export async function classifyOffer(
  config: CompletionsConfig,
  query: string,
  genericAnswer: string,
  hits: Record<string, unknown>[],
): Promise<string[]>
```
`const compositeQuery = buildClassificationQuery(query, genericAnswer, hits); const result = await callWithRetry(config, { history: [], query: compositeQuery }); return parseClassifierResponse(result.content);` — exact signature pinned by `03-spec-track-a.md`. `history: []` always (each classification is independent — no cross-turn state, per spec). No `onText` passed (nothing streams).

**RED tests (`classifier.test.ts`, vitest):**
1. `buildClassificationQuery('a question', 'an answer', [{title: 'X'}])` → contains `QUESTION:\na question`, `GENERIC'S ANSWER:\nan answer`, and `RETRIEVED HITS (JSON):\n[{"title":"X"}]` (or equivalent — assert via `.toContain` on each section, not brittle whole-string equality). Synthetic input is fine here — this is pure string assembly, not agent behavior (same line this repo already draws for `buildTechnicalHistory`'s test).
2. `parseClassifierResponse(...)` fed **A5's real captured implementation-question response text, pasted verbatim** → returns a one-element array whose entry starts with `SPECIALIST:`.
3. `parseClassifierResponse(...)` fed **A5's real captured design-question response text, pasted verbatim** → returns a one-element array with no `SPECIALIST:`-prefixed entry.
4. `parseClassifierResponse('  ')` / `parseClassifierResponse('')` → `[]` (no throw).
5. `classifyOffer(config, ...)` with `callWithRetry`/`callCompletions` mocked to resolve A5's real implementation capture's content → returns an array containing the real `SPECIALIST:` text; assert the mock was called with `{ history: [], query: <the composite string> }` targeting whatever `agentId` was in `config` (proves `classifyOffer` faithfully uses the config it's given — it does not hardcode or redirect to a different agent internally; *which* config is passed in is Task A7's concern, tested there).

**Acceptance:** `cd web && npx vitest run src/lib/classifier.test.ts src/lib/agentStudio.test.ts` passes — the second file passes unchanged (proves moving `callWithRetry` didn't regress `agentStudio.ts`'s existing suite). `tsc -b` clean.

**Depends on:** A5 (needs the real captured response text for tests 2–3 and 5). **Wave 3.**

---

### Task A7 — Wire `classifyOffer` into `useChat.ts`'s `runTurn` (Go/No-Go items 1 & 2, closed structurally)

**Files:** `web/src/hooks/useChat.ts` (modify), `web/src/hooks/useChat.test.ts` (modify), `web/src/types.ts` (modify — comment only), `web/src/components/DiscoveryCard.tsx` (modify — comment only).

**Descends from:** `03-spec-track-a.md`'s core contract + `02-risk-assessment.md`'s Go/No-Go items 1 ("must fully REPLACE `genericResult.suggestions`, never merge") and 2 ("target agent named explicitly, covered by a test"). Both get closed **structurally**, not just by convention — same pattern this codebase already uses for `deriveOfferState`/`buildTechnicalHistory` (pull the risky logic into a small function whose *signature* makes the invariant true by construction, "provable by testing a return value, not by inspecting a `setTurns` side effect" — this project's own words, prior migration Task B6).

**Add, exported from `useChat.ts` for direct unit testing (same precedent as `deriveOfferState`):**
```ts
export async function resolveOfferPatch(
  classifierConfig: CompletionsConfig,
  query: string,
  genericAnswer: string,
  hits: Record<string, unknown>[],
): Promise<{ deepDiveOffered: boolean; followUp?: string; deepDiveQuery?: string }> {
  let suggestions: string[] = [];
  try {
    suggestions = await classifyOffer(classifierConfig, query, genericAnswer, hits);
  } catch (err) {
    console.error('[useChat] classifyOffer failed — no deep-dive offer this turn (Generic\'s answer is unaffected)', err);
  }
  return deriveOfferState(suggestions, query);
}
```
This signature has **no parameter through which `genericResult.suggestions` could enter** — Go/No-Go item 1 is closed by the function not accepting that value at all, not by a rule someone has to remember to follow. A failed classification degrades to "no offer this turn," never to an error card — Generic's own segment has already rendered and succeeded by the time this runs; a classification hiccup must not retroactively break it.

**Wire it in — `runTurn`:** replace `const patch = deriveOfferState(genericResult.suggestions, query); setTurns(...)` with:
```ts
const patch = await resolveOfferPatch(
  getAgentConfig(activeInstance.agents.classifier.id),
  query,
  genericText,
  genericResult.hits,
);
setTurns((prev) => prev.map((t) => (t.id === turnId ? { ...t, ...patch } : t)));
```
Note `genericResult.hits` (the raw hit objects), not `genericSources` (the deduped, display-shaped `AnswerSource[]`) — the classifier should see the same raw retrieval Generic's own answer was grounded in, not a UI-shaped derivative.

**`runTechnicalLeg` is explicitly unchanged** — Technical's own `extractDeepDiveOffer(technicalResult.suggestions)` call (for its own post-deep-dive follow-up, not a `SPECIALIST:` offer — Technical never emits one) still reads its own native `config.suggestions` output, untouched. `docs/plans/2026-07-10-reconciled-handoff-architecture-build.md` §4's open question 3 ("does Track A's fix need to also touch Technical's leg?") is explicitly answered **no** by that same doc's own text ("lower-stakes... not addressed here unless Arijit wants it in scope") and neither `02`/`03`/`04` nor this run's task list pin a decision to bring it in scope — noted here so it isn't silently dropped, not silently expanded either.

**Header comment (lines 1–21) + `types.ts`'s `ChatTurn` comment (lines 51–61) + `DiscoveryCard.tsx`'s comment (lines 7–11):** rewrite per Gap 2 above — replace every reference to "Generic's native `config.suggestions`"/"`genericResult.suggestions`" as the offer signal with "the client's own classifier call (`ACS-classifier-neural`, via `resolveOfferPatch`/`classifyOffer`)". Technical's own native-suggestions mechanism (unaffected) should stay described as such, not swept into the same correction.

**RED tests (`useChat.test.ts`), mocking `classifyOffer` via `vi.mock('../lib/classifier')`:**
1. `resolveOfferPatch` forwards `classifyOffer`'s resolved array into `deriveOfferState` untouched — mock `classifyOffer` to resolve `['SPECIALIST: x', 'y']`, assert `resolveOfferPatch(...)` returns exactly `deriveOfferState(['SPECIALIST: x', 'y'], query)`'s value (`{ deepDiveOffered: true, followUp: 'y', deepDiveQuery: query }`).
2. `resolveOfferPatch` on `classifyOffer` throwing → returns `{ deepDiveOffered: false, followUp: undefined, deepDiveQuery: undefined }` (i.e., `deriveOfferState([], query)`), and does not rethrow (the turn survives).
3. **Go/No-Go item 2, at its real call site:** assert `classifyOffer` (the mock) is called with a config whose `agentId` is `activeInstance.agents.classifier.id` — **not** `activeInstance.agents.generic.id` — by spying on the mock's call args from within a `runTurn`-level test (or, if hook-level testing proves awkward without React test infra — matching this repo's own stated philosophy of not adding `@testing-library/react` for one hook — assert this at the `resolveOfferPatch` call-site level: `runTurn`'s own source literally passes `getAgentConfig(activeInstance.agents.classifier.id)`, so a source-level assertion reading that exact literal from `useChat.ts` is an acceptable, cheap regression guard if a mocked-hook-call test proves impractical — Build's call, either is acceptable, but one of the two must exist).

**Acceptance:** `cd web && npx vitest run src/hooks/useChat.test.ts` passes, including all pre-existing tests (`extractDeepDiveOffer`, `deriveOfferState`, `buildTechnicalHistory`, `summarizeForHistory`, `summarizeSegmentsForHistory`, `turnToHistory` — zero regressions, none of their contracts change). `tsc -b` clean. Direct read confirms no remaining reference to `genericResult.suggestions` anywhere in `runTurn`, and no remaining `[[FOLLOWUP` / stale-mechanism prose in the three comment blocks touched.

**Depends on:** A6 (needs `classifyOffer` to exist). **Wave 4.**

---

### Task A8 — Acceptance gate: repeated-query live probe (the actual bug regression test)

**Files produced:** `scripts/spikes/track-a-classifier/repeated-query-acceptance-probe.mjs` (new, disposable — same self-contained-raw-fetch convention as every other script in `scripts/spikes/agent-tool-handoff/`, not importing `web/`'s TS source, for the same reason those scripts don't), `docs/spikes/2026-07-10-track-a-repeated-query-acceptance.md` (new, real terminal output pasted, not summarized).

**Why this is the real gate, not the vitest suite:** per this project's own Cardinal Rule and `02-risk-assessment.md`'s Go/No-Go item 3 — a green test suite proves the code does what the tests assume; it can't exercise Agent Studio's actual per-query response cache, which is the mechanism the original bug lived in. This is `docs/plans/...build.md`'s original **A4**, updated for three agents' `-dev` copies instead of two.

**What the old bug actually looked like, so the gate proves the right thing (per `2026-07-09-suggestions-frame-findings.md` §5, real observed evidence):** the OLD mechanism's suggestion was a **second, platform-internal async job** racing the platform's own per-query cache — a cold call could close its stream before that job finished, and (per this project's own cache-poisoning precedent, `SESSION.md`) a repeated identical query could then replay that same suggestion-less cached response forever. The NEW mechanism has no such second job: the classifier's answer **is** the primary, synchronous content of its own completion — if Agent Studio's cache ever serves a cached response for a repeated identical composite query, that cached response was always complete (the classification was decided in the same request/response cycle it's served from), so there is no race left to lose. This task's job is to confirm that reasoning empirically, not just assert it.

**Method:**
1. Point at the `-dev` copies from A5 (already live). Build the exact same composite query format (Task A2/A6) for a real implementation-flavored question (reuse A5's own captured question — this specific repeat is the point).
2. POST it to `ACS-classifier-neural-dev` **twice in a row, byte-identical**, capturing both raw responses.
3. Confirm both responses contain a `SPECIALIST:`-prefixed line naming something real from the hits — not just "non-empty," the actual expected content, both times.
4. Repeat steps 2–3 for **at least 3 more repeat pairs** (mirroring the original build.md A4's "include at least 2 repeated/near-duplicate wordings" — this plan raises it to 4 total pairs across a small mix of implementation-flavored wordings, since repeat-count is exactly the dimension the old bug depended on and a single lucky pair proves less than several).
5. As a negative control, confirm a repeated **design**-flavored query still returns no `SPECIALIST:` prefix, both times (proves the classifier isn't just defaulting to "always offer" under repetition).

**Acceptance:** the findings file shows all captured raw responses (not paraphrased) across all repeat pairs, with a pass/fail line per pair. **This gate must be unambiguously green before A9 proceeds** — if any repeat pair loses the offer, the fix is wrong (most likely culprit: `history: []` isn't actually being sent identically, or the composite-query serialization is non-deterministic, e.g. object-key ordering in `JSON.stringify(hits)` — investigate via `systematic-debugging`, don't paper over it with a retry loop in product code).

**Depends on:** A7 (needs the real wiring, since this gate is validating the mechanism A7 wires in, run against the same `-dev` agents A5 created) + A3 (conceptually — the dev-id override is what lets a real `web/` dev session point at these same `-dev` agents for a manual spot-check alongside the scripted probe, if Build wants the extra confirmation; the scripted probe itself talks to Agent Studio directly and doesn't strictly need A3 to run). **Wave 5.**

---

### Task A9 — Human-gated live flip

**Files:** `web/src/config/instances/spectrum.ts` (modify — replace the A4 placeholder with the real live classifier ID), `SESSION.md` (modify — status update, per this project's own per-session convention).

**Sequence (mirrors the prior migration's Task B9 exactly — same reasoning, same gate):**
1. Re-run the full local gate suite (§4 below) against the `-dev` copies one more time, end to end, with A1–A8 all landed together.
2. **Stop for an explicit human go-ahead before the next step.** This is a production change to a live, externally-reachable system — a brand-new live agent gets created, and the deployed Vercel app's hardcoded config gains a new ID it will start calling on every implementation-flavored question. Per Intake #4 ("must not touch the live-linked agent IDs... without explicit redeploy sign-off") and the global standing rule that production changes always need a fresh explicit yes regardless of momentum — do not auto-proceed even if every automated gate above is green.
3. On go-ahead: run `node scripts/agents/build_acs_agents.mjs` **with no `ACS_AGENT_SUFFIX`** — the first and only unsuffixed run in this build. Confirm in its own output: `ACS-classifier-neural` created, `suggestions=off (expected off)`; `ACS-generic-neural`/`ACS-technical-neural` PATCHed in place with **unchanged IDs** and `suggestions=on (expected on)` — zero regression to the two live agents.
4. Replace `spectrum.ts`'s `classifier.id` placeholder (`'PENDING-A9-LIVE-FLIP'`) with the real ID just printed.
5. **Live spot-check, real browser, ≥5 real turns**, mixing implementation- and design-flavored questions, **including at least one deliberately repeated question** (this is where A8's API-level proof gets a real-UI confirmation, mirroring the original build.md's A6 and the prior migration's Task B9 step 4): confirm the deep-dive offer appears only on implementation questions, never on design questions, and survives the repeat. This is a human-observed check — record actual observed transcripts, not a pass/fail assertion (Cardinal Rule).
6. Update `SESSION.md`'s status block.

**Acceptance:** all 6 sub-steps show real terminal/browser output, not a claim of completion. Step 5's transcripts are the actual evidence Go/No-Go item 3 (`02-risk-assessment.md`) exists to require.

**Depends on:** A1–A8, all of them. **Wave 6 — last.**

---

## 3. Test strategy matrix

| # | Test case | Where it lands |
|---|---|---|
| 1 | `scopeTools(..., {noSearchTool:true})` → `[]` regardless of input tools | A1 |
| 2 | `scopeTools(...)` default (`noSearchTool` absent) → unchanged existing behavior | A1 |
| 3 | `buildSuggestionsConfig('p')` (1-arg) → still `enabled:true` (backward-compat regression) | A1 |
| 4 | `buildSuggestionsConfig('p', false)` → `enabled:false` | A1 |
| 5 | `PERSONAS` gains the classifier entry with the pinned fields | A4 |
| 6 | `PERSONAS.length === 3` regression guard | A4 |
| 7 | `withDevAgentOverrides` — no-op unset / applies matching key / malformed JSON falls back / inert on unknown key / warns loudly | A3 |
| 8 | `buildClassificationQuery` assembles the pinned QUESTION/ANSWER/HITS shape | A6 |
| 9 | `parseClassifierResponse` on A5's **real** SPECIALIST capture → 1-element array, prefixed | A6 |
| 10 | `parseClassifierResponse` on A5's **real** ordinary capture → 1-element array, no prefix | A6 |
| 11 | `parseClassifierResponse` on empty/whitespace → `[]`, no throw | A6 |
| 12 | `classifyOffer` (mocked transport) returns the real offer text; request shape asserted (`history:[]`, composite query, given `config`) | A6 |
| 13 | `agentStudio.test.ts`'s existing suite still passes after `callWithRetry` moves here | A6 (no-regression) |
| 14 | `resolveOfferPatch` forwards `classifyOffer`'s result into `deriveOfferState` untouched | A7 |
| 15 | `resolveOfferPatch` on `classifyOffer` throwing → graceful no-offer, no rethrow | A7 |
| 16 | Go/No-Go item 2 — the real call site targets `activeInstance.agents.classifier.id`, never `.generic.id` | A7 |
| 17 | Existing `useChat.test.ts` suite (`extractDeepDiveOffer`/`deriveOfferState`/`buildTechnicalHistory`/history summarization) — zero regressions, contracts unchanged | A7 (no-regression) |
| 18 | Live: A1's two-sided hard gate actually fires correctly on a real `-dev` run | A5 |
| 19 | Live: real classifier output on real implementation vs. design questions | A5 |
| 20 | Live: repeated-query acceptance gate, 4+ pairs, offer survives every repeat | A8 |
| 21 | Live: full local gate suite + ≥5-turn real browser spot-check including a repeat, at the live flip | A9 |

---

## 4. Wave map

```
Wave 0 (parallel, zero file overlap):
  A1  noSearchTool + suggestions-off infra    (scripts/agents/agentConfig.mjs, build_acs_agents.mjs)
  A2  instructions_classifier.md              (scripts/agents/instructions_classifier.md — new, content only)
  A3  VITE_ACS_DEV_AGENT_IDS override          (web/src/config/active.ts)

Wave 1:
  A4  classifier persona + InstanceConfig type + spectrum.ts placeholder   [needs A1 (params) + A2 (file)]

Wave 2:
  A5  empirical discovery — real classifier response, live -dev probe     [needs A4 (persona must exist)]

Wave 3:
  A6  classifyOffer implementation (new web/src/lib/classifier.ts)        [needs A5 (real fixtures)]

Wave 4:
  A7  wire into useChat.ts's runTurn + retire stale comments              [needs A6 (classifyOffer)]

Wave 5:
  A8  acceptance gate — repeated-query live probe                        [needs A7 (real wiring) + A3 (dev-id override, for the optional manual spot-check)]

Wave 6 (last, human-gated):
  A9  live flip                                                          [needs A1–A8, all]
```

**Hard rule threading every wave:** no task in Wave 0–5 may run `node scripts/agents/build_acs_agents.mjs` without `ACS_AGENT_SUFFIX=-dev` set. The unsuffixed run happens exactly once, in A9, after explicit human sign-off.

---

## 5. Local gate definitions

No CI runner in this repo (confirmed: no `.github/workflows/`, no root `package.json` — unchanged from the prior migration's own finding). These are the local gates Build runs directly and shows terminal output for, per this project's Cardinal Rule:

| Gate | Command | Required result |
|---|---|---|
| G1 — web build | `cd web && npm run build` (`tsc -b && vite build`) | exit 0, zero TS errors |
| G2 — web unit tests | `cd web && npm test` (`vitest run`) | exit 0, all suites pass (A3/A6/A7's new suites + zero regression on `agentStudio.test.ts`/existing `useChat.test.ts`) |
| G3 — script unit tests | `node --test scripts/agents/agentConfig.test.mjs` | exit 0, 9/9 (3 pre-existing + A1's 4 + A4's 2) |
| G4 — dry-run discipline | manual check: every `build_acs_agents.mjs` invocation in A1–A8 was `ACS_AGENT_SUFFIX=-dev` prefixed | no unsuffixed run before A9 |
| G5 — live acceptance | A5's empirical capture + A8's repeated-query gate + A9's browser spot-check | offer deterministic across repeats; classifier never fires on design questions; Generic/Technical unaffected |

G1–G3 gate every task from A6 onward (run after each task, not batched at the end — same discipline the prior migration established and this project's own `SESSION.md` shows was followed "clean throughout"). G4 is a running check across every wave. G5 is exclusively A5/A8/A9's.

---

## 6. Coverage checklist (nothing silently dropped)

User's 7 minimum-coverage items → task:
1. `scopeTools` fix → **A1**
2. `buildSuggestionsConfig`/hard-gate fix for suggestions-OFF persona → **A1**
3. New `ACS-classifier-neural` persona + its own prompt file (adapted from `suggestions_generic.md`) → **A2** (prompt) + **A4** (persona wiring)
4. `InstanceConfig`/`spectrum.ts` type + config change → **A4**
5. `VITE_ACS_DEV_AGENT_IDS` override in `active.ts` → **A3**
6. `classifyOffer` function + wiring into `useChat.ts`'s `runTurn` → **A6** (function) + **A7** (wiring)
7. Acceptance-gate live probe (repeated-query, the actual bug regression test, not just unit tests) → **A8** (scripted) + **A9** (browser confirmation at flip time)

Go/No-Go conditions from `02-risk-assessment.md` → concrete mechanisms, not citations: item 1 (never merge with `genericResult.suggestions`) → closed structurally by **A7**'s `resolveOfferPatch` signature; item 2 (target agent named + tested) → **A4** (named) + **A6**/**A7** (tested at both the function and call-site level); item 3 (A4's repeated-query probe is the real bar, not the test suite) → **A8**.

Three gaps this plan found beyond 02/03/04's scope (§0 above): `suggestions_generic.md` reuse risk → resolved by giving the classifier its **own** file (**A2**), never touching the shipping one. Three stale-comment sites (`useChat.ts`, `types.ts`, `DiscoveryCard.tsx`) describing the retired signal source → folded into **A7**. `callWithRetry`'s circular-import risk → resolved by relocating it to `agentStudio.ts` (**A6**).

**Explicitly out of scope, not silently dropped (confirmed by the source doc itself, not this plan's own judgment call):** `docs/plans/2026-07-10-reconciled-handoff-architecture-build.md` §4's open question 3 — whether Track A's fix should also touch Technical's own (lower-stakes, non-gating) follow-up suggestion mechanism. That doc's own text defers it ("not addressed here unless Arijit wants it in scope"); neither `02`, `03`, `04`, nor this run's task list pin a decision to include it, so it stays out. Track B (the orchestrator) stays fully out per `01-intake.md`'s revised Scope Note — no task above creates any orchestrator persona, tool, or auto-chain logic.

**Noted, out of this plan's scope (found while reading state, not touched here):** `main`'s current working tree carries uncommitted changes (`CLAUDE.md`, `SESSION.md`) and a batch of untracked files from tonight's Track-B-validation work (`docs/plans/`, several `docs/spikes/*`, `scripts/spikes/agent-tool-handoff/*`, `.development-loop/`) predating this plan — see §1's branch-strategy note. Not this plan's job to commit or clean up; flagging so it isn't mistaken for something Task A1 was supposed to have caused.

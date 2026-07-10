# 06 — Plan (Stage 5 output → drives Stage 6 Build)

Builder: **module-builder** (locked at Spec — no new UI surface, this rewires existing mechanism files + a data-source swap on an existing component).

Grounded directly in the current code (not re-derived from 03/04/05 alone): `web/src/hooks/useChat.ts`, `web/src/lib/agentStudio.ts`, `scripts/agents/build_acs_agents.mjs`, `web/src/types.ts`, `web/src/components/{DiscoveryCard,ChatMessage,DeepDivePrompt}.tsx`, `web/src/lib/agents.ts`, `scripts/agents/instructions_{generic,technical}.md`, `web/package.json`, `web/vite.config.ts`, plus the sibling `Algolia-Central2` repo (test-infra precedent) and this repo's own `lab/server` (same precedent, different package).

Two gaps found here that 04-spec.md and 05-architecture-review.md did not catch (both closed below, not deferred):
1. **Technical's leg is still wired to the dead sentinel parser.** `runTechnicalLeg` (lines 240–243, 268) calls the same `parseAgentText()` the spec removes. Once the `[[FOLLOWUP:...]]` sentinel stops being emitted, `parseAgentText` on clean text is a silent no-op — Technical's discovery card would just stop appearing, with no error, no crash. Spec's diff only showed Generic's leg. Fixed in Task B5 below.
2. **`instructions_generic.md`/`instructions_technical.md` still tell the model to run the mechanisms this Build deletes.** Removing the tool from `extraTools` (R12) without also removing `instructions_generic.md`'s "HANDOFF — the `consult_technical_specialist` TOOL (REQUIRED...)" section leaves Generic instructed to call a tool that no longer exists. Same for both agents' `[[FOLLOWUP: ...]]` sections — that in-band signal is superseded by the native `config.suggestions` mechanism entirely, so the main `instructions` body needs the section removed, not left as dead/contradictory prose. Fixed in Task B1 (folded into the suggestions-prompt authoring task, since it's the same "retire Job A/old FOLLOWUP, install the replacement" unit of work).

---

## 1. Builder + branch strategy

**Continue on `spike/agent-to-agent-tool`. Do not cut a sub-branch.**

Reasoning: the real incident this session (`git log` — commit `4a66cad`, *"fix(prod): restore production agent IDs, killed by spike-branch redeploys"*) was **not caused by git branch topology**. Root cause per that commit's own message: `build_acs_agents.mjs` deleted-and-recreated agents by name on every run, which silently orphaned production's hardcoded IDs in `spectrum.ts` *regardless of which local branch the script was run from* — because Agent Studio's live agents are an external, shared, non-git-versioned resource. Being on a feature branch bought zero protection then, and cutting a new sub-branch now buys zero protection either, because the exposure is "running the script unguarded against the live names," not "which branch HEAD points at."

The actual mitigation is already double-layered as of this session:
- `1b17607` changed the script from delete+recreate to PATCH-in-place (no more ID churn on refresh).
- This plan's **Task B2 (dry-run mechanism, `ACS_AGENT_SUFFIX`)** is Wave 0 and gates every other script-touching task — nothing after B2 is allowed to run the script unsuffixed until Task B10's explicit, human-gated flip.

Given that, a sub-branch adds git overhead with no corresponding risk reduction. Staying on `spike/agent-to-agent-tool` also keeps one linear history for this specific redesign, and `main` remains untouched (confirmed zero deploy risk both in SESSION.md and by the Vercel project config building from `main`, not this branch).

**One safety action before Task B1 starts** (cheap, reversible, not itself a task): tag current HEAD — `git tag pre-suggestions-migration` — as a named rollback point distinct from "revert N individual commits," given the precedent that this exact branch already needed one unplanned recovery this session.

**Finish-stage note (out of scope for Build, flagged for later):** this branch's history now contains "build the tool-call handoff" (5dbdf1e, a4de7d0, fac01d5) immediately followed by "delete the tool-call handoff" (this Build's commits). Recommend a **squash merge** at Finish, not a fast-forward, so `main` reads as one clean "native suggestions replace the tool-call handoff" change rather than a build-then-delete saga. Not a Build-stage decision — noting it now so it isn't lost.

---

## 2. Task / story breakdown

Ten tasks, `B1`–`B10`. Each states files touched, the RED test to write first, acceptance criteria, and dependencies. "RED test" = the failing test written *before* the implementation, per this project's global TDD mandate and the risk assessment's Go-condition #3 (NR3: zero existing test coverage in `useChat.ts`/`agentStudio.ts`, both being rewired here — tests are a Build gate, not an afterthought).

Two test runners are used, deliberately, not one:
- **`web/`** gets **vitest** — ported verbatim from the sibling `Algolia-Central2` repo's pattern (`vite.config.ts`'s `test` block, `environment: 'node'`, `vitest ^4.1.8`), which is also this repo's own `lab/server`/`lab/judge` convention. Not inventing a new toolchain; reusing the one already proven twice in this codebase family.
- **`scripts/agents/`** gets Node's **built-in `node:test`** (confirmed available: this machine runs Node v25.8.2). `scripts/agents/` has no `package.json` today and isn't an npm workspace member; adding vitest + a new package.json there just to test ~4 pure functions is disproportionate infra for the size of the surface. `node --test scripts/agents/` needs zero new dependency and zero new config file.

Named consequence of that split, worth stating plainly: **`scripts/agents/*.mjs` has no TypeScript and no compiler safety net at all** (it's plain JS). Unlike the `web/` side, where `tsc -b` catches a dangling import for free, nothing catches a stale reference in `build_acs_agents.mjs`/`agentConfig.mjs` except the tests this plan requires. That's the actual reason B1/B2/B7's test coverage isn't optional polish.

---

### Task B0 — vitest test infra for `web/`

**Files:** `web/package.json` (modify), `web/vite.config.ts` (modify).

**Change:** Add devDependency `vitest: ^4.1.8`. Add scripts `"test": "vitest run"`, `"test:watch": "vitest"`. In `vite.config.ts`, add `/// <reference types="vitest/config" />` at the top and a `test: { environment: 'node', include: ['src/**/*.test.{ts,tsx}'] }` block to `defineConfig({...})` — this is AC2's `web/vite.config.ts` verbatim, ported.

**RED test:** N/A — this task creates the test *runner*, not a test. Its own acceptance check is operational, not a unit test.

**Acceptance:** `cd web && npm install && npx vitest run` exits 0 with "No test files found" (not an error) — proves the runner is wired before any test file exists yet.

**Depends on:** nothing. **Blocks:** B7, B8, B9 (the `web/`-side tasks). Does **not** block B1/B2/B6/B10 — those use `node:test`, unrelated toolchain.

---

### Task B1 — Suggestions prompts + retire the dead in-band signaling (resolves vault Open Question #6)

**Files:** `scripts/agents/suggestions_generic.md` (new), `scripts/agents/suggestions_technical.md` (new), `scripts/agents/instructions_generic.md` (modify), `scripts/agents/instructions_technical.md` (modify).

**Why this is one task, not a docs afterthought:** the corrected architecture moves the "should I offer a deep dive?" decision entirely out of Generic's main instructions and into a *separate* platform-managed completion (`config.suggestions.system_prompt`, wired in Task B3). That makes the current "HANDOFF — the `consult_technical_specialist` TOOL (REQUIRED...)" section of `instructions_generic.md` (lines 27–35) and both agents' "FOLLOW-UP QUESTION (machine-readable — the discovery card)" sections dead prose the moment B3 lands — if left in place, Generic keeps being told to call a tool B3 removes from its registration (R12), and both agents keep being told to emit a `[[FOLLOWUP: ...]]` token nothing downstream reads anymore (B5 deletes the reader). This is the same failure shape as everything else this session has fixed at the root: don't leave instructions describing a mechanism that no longer exists.

**Content requirements (not final prose — Build writes the copy, this pins the contract):**
- `suggestions_generic.md`: the `system_prompt` for Generic's native suggestion. Must instruct the model to emit exactly one suggestion literally prefixed `SPECIALIST:` **only** when the question is implementation-heavy — reuse the exact trigger criteria already proven in the current (soon-deleted) HANDOFF section verbatim: "how do I build/implement/create/code/write/use/set up/wire X in React (Spectrum)", a request for a code example, exact props/types, hooks wiring, TypeScript, event handlers, or version-specific API. For everything else, emit an ordinary follow-up suggestion with **no** `SPECIALIST:` prefix, following the same "name something real and specific from this turn's hits, vary the phrasing, one sentence" rule already proven to work in the current FOLLOWUP section (ported, not re-invented — that rule already shipped and was verified live this session).
- `suggestions_technical.md`: the `system_prompt` for Technical's native suggestion — an ordinary follow-up only (Technical never emits `SPECIALIST:`; it has no one to hand off to). Port the existing hard-won grounding rule verbatim from `instructions_technical.md`'s current FOLLOWUP section (name a real prop/sibling hook/version difference/next implementation step actually present in the hits — this exact rule is what fixed the "generic template" failure mode earlier this session; do not re-derive it, copy it).
- `instructions_generic.md`: delete the entire "HANDOFF — the `consult_technical_specialist` TOOL" section and the entire "FOLLOW-UP QUESTION" section. Nothing in the main instructions body should reference a tool call or a `[[FOLLOWUP:...]]` token afterward.
- `instructions_technical.md`: delete its "FOLLOW-UP QUESTION" section. Nothing else in that file changes (its DEPTH DOCTRINE / grounding rules are unaffected — R11's grounding language lives in the shared/technical instructions already and isn't part of what's being retired).

**RED test:** `scripts/agents/agentConfig.test.mjs` (see B2 — same file), case: `readFileSync` both `instructions_*.md` files and assert neither contains the substrings `consult_technical_specialist` or the follow-up token marker `[[FOLLOWUP:` — write this assertion against the *current* file content first (it currently fails, since both strings are present today), then make it pass by editing the files. Use a file-content check here (not an import) specifically because these are prose files with no executable surface.

**Acceptance:** both instruction files compile-clean as prose (no dangling references to removed mechanisms); both new `suggestions_*.md` files exist and name the `SPECIALIST:` marker convention exactly (must match `extractDeepDiveOffer`'s parsing in B5 — same literal string, case-sensitive). Vault `Projects/Algolia-Central/spectrum/wiki/open-questions.md` Q6 is marked resolved (mirrors how Q7 was closed in that same file this session) — record the actual decision made here, not a placeholder.

**Depends on:** nothing. **Wave 0** — fully parallel with B0 and B2 (zero file overlap).

---

### Task B2 — `build_acs_agents.mjs` dry-run mechanism (`ACS_AGENT_SUFFIX`)

**Files:** `scripts/agents/agentConfig.mjs` (new), `scripts/agents/agentConfig.test.mjs` (new), `scripts/agents/build_acs_agents.mjs` (modify).

**Why a new module, not an inline change:** `build_acs_agents.mjs` runs `const existing = await listAgents();` as unguarded top-level `await` the instant the file is imported — anything that imports it to test a pure value (like `PERSONAS`) triggers a real network call against live Algolia Agent Studio. That is exactly the kind of unguarded live-API touch this whole plan exists to prevent. Split: `agentConfig.mjs` holds all *pure, static* configuration and logic (no network, no top-level await) — `PERSONAS`, `INDEX`, `CLONE_BASE`, `RETIRE`, and the new `buildAgentName()` helper. `build_acs_agents.mjs` keeps all *side-effecting* orchestration (`call()`, `listAgents()`, `loadPrompt()`, `scopeTools()`, the top-level execution flow) and imports the static config from `agentConfig.mjs`. This is the only way to unit-test any of this script's logic without a live API call in the test run.

**Change:**
- `agentConfig.mjs` exports `PERSONAS`, `INDEX`, `CLONE_BASE`, `RETIRE` (moved verbatim from `build_acs_agents.mjs` lines 24, 44–53) and a new `buildAgentName(baseName, suffix)` → `` `${baseName}${suffix}` ``.
- `build_acs_agents.mjs` imports these instead of declaring them inline. Reads `const SUFFIX = process.env.ACS_AGENT_SUFFIX ?? '';`. Every place the script currently uses a persona's bare `name` to look up/create/patch a live agent (the `names = PERSONAS.map(p => p.name)` line, the `existing[name]` lookups, the POST `body.name`) uses `buildAgentName(p.name, SUFFIX)` instead of the bare `p.name`.

**RED test (`agentConfig.test.mjs`, `node --test`):**
1. `buildAgentName('ACS-generic-neural', '-dev')` → `'ACS-generic-neural-dev'`.
2. `buildAgentName('ACS-generic-neural', '')` → `'ACS-generic-neural'` (default/no-suffix case — proves the unsuffixed live path is unchanged behavior).
Write both against the *not-yet-existing* function first (fails: `buildAgentName is not a function` / import error), then implement.

**Acceptance:** `ACS_AGENT_SUFFIX=-dev node scripts/agents/build_acs_agents.mjs --list` prints `ACS-generic-neural-dev` / `ACS-technical-neural-dev` (not the live names) and reports `(none)` for both on a first run (they don't exist yet). Running with no `ACS_AGENT_SUFFIX` set still targets the real live names (backward-compatible default). `node --test scripts/agents/agentConfig.test.mjs` passes.

**Depends on:** nothing. **Wave 0** — parallel with B0/B1 (touches `scripts/agents/agentConfig.mjs`+`build_acs_agents.mjs`, which neither B0 nor B1 touch).

---

### Task B3 — PATCH/create body: `config.suggestions` + R12 tool removal

**Files:** `scripts/agents/agentConfig.mjs` (modify — same file as B2, sequential), `scripts/agents/agentConfig.test.mjs` (modify), `scripts/agents/build_acs_agents.mjs` (modify).

**R12 (exact edit site, per architecture-review Important #6, corrected):** in `agentConfig.mjs`'s `PERSONAS` array, change `PERSONAS[0].extraTools` from `[CONSULT_TECHNICAL_TOOL]` to `[]`. Delete the `CONSULT_TECHNICAL_TOOL` object declaration entirely — nothing references it after this change. This is **not** a change to `build_acs_agents.mjs`'s PATCH-body construction site; `tools` there is already computed upstream from `extraTools`, unchanged.

**Single shared body-builder (closes the exact risk the risk assessment named — "an incomplete edit adds `suggestions` to one path but not the other"):** add to `agentConfig.mjs`:
- `buildSuggestionsConfig(systemPrompt)` → `{ enabled: true, model: 'gemini-2.5-flash-lite', system_prompt: systemPrompt, generation: { max_count: 1, max_words: 20 }, context: { include_tool_outputs: true } }` — every field here is locked by the approved spec (04-spec.md lines 22–29), not open to Build's discretion.
- `buildAgentBody({ name, status, instructions, model, providerId, tools, suggestionsConfig })` → returns `{ instructions, model, providerId, tools, config: { suggestions: suggestionsConfig }, ...(name ? { name } : {}), ...(status ? { status } : {}) }`. **Both** the existing-agent PATCH call site (`build_acs_agents.mjs` line ~92) and the new-agent POST call site (line ~97) call this *one* function — there is structurally only one place `config.suggestions` gets set, so a future edit can't add it to one path and silently miss the other.
- `assertSuggestionsEnabled(agentJson)` → `agentJson?.config?.suggestions?.enabled === true`.

`build_acs_agents.mjs` reads the two new prompt files from B1 (`loadPrompt('suggestions_generic.md')` / `loadPrompt('suggestions_technical.md')`) into a `SUGGESTIONS_PROMPT` map keyed by persona name, and passes `buildSuggestionsConfig(SUGGESTIONS_PROMPT[name])` into `buildAgentBody(...)` at both call sites. The existing post-write `console.log` verification block (currently prints index/filter/tools) extends to also print `suggestions=${assertSuggestionsEnabled(v.json) ? 'on' : 'MISSING'}` and the script must not report a persona as done if that's `MISSING` — this is Risk finding #1, promoted from suggestion to a hard gate.

**RED test (`agentConfig.test.mjs`):**
1. `buildSuggestionsConfig('test prompt')` returns an object with `enabled: true`, `model: 'gemini-2.5-flash-lite'`, `generation: { max_count: 1, max_words: 20 }`, `context: { include_tool_outputs: true }`.
2. `buildAgentBody({ instructions: 'i', model: 'm', providerId: 'p', tools: [], suggestionsConfig: buildSuggestionsConfig('x') })` returns a body whose `config.suggestions.enabled === true` and which has **no** `name`/`status` keys when those args are omitted (proves the PATCH path stays shape-compatible with today's live PATCH body, `{instructions, model, providerId, tools}` plus the new `config` key — nothing removed, only added).
3. `buildAgentBody({ name: 'x', status: 'published', ... })` includes `name`/`status` (proves the create/POST path still gets them).
4. **R12 regression:** import `PERSONAS` from `agentConfig.mjs` and assert `PERSONAS.find(p => p.name === 'ACS-generic-neural').extraTools` is `[]` and does not (recursively, via `JSON.stringify`) contain the string `consult_technical_specialist`.

**Acceptance:** all four tests pass. `ACS_AGENT_SUFFIX=-dev node scripts/agents/build_acs_agents.mjs` (first run — creates `-dev` copies, since B2 proved they don't exist yet) prints `suggestions=on` for both personas, and prints `tools=algolia_search_index` only for Generic (not `algolia_search_index+client_side` — proves the tool is gone).

**Depends on:** B2 (same file, sequential edits) + B1 (needs the two prompt files' real content to load). **Wave 1.**

---

### Task B4 — Empirical discovery: real suggestions SSE frame prefix (investigation task, not a code task)

**Files produced:** `docs/spikes/2026-07-09-suggestions-frame-findings.md` (new — no product code changes in this task).

**Method (directly reusing this session's own proven precedent — `docs/spikes/2026-07-08-agent-to-agent-tool-findings.md`'s Task 3/5/6 technique: probe the real API, capture raw frames, never assume the docs' abstract shape is the wire shape):**
1. Confirm the `-dev` copies from B3 actually have `config.suggestions.enabled: true` (`node scripts/agents/build_acs_agents.mjs --list` with `ACS_AGENT_SUFFIX=-dev`, then a `GET /agents/{id}` check).
2. Issue a raw completions POST directly against `ACS-generic-neural-dev`'s ID (curl or a small throwaway probe script — either the search-only key from `web/.env.local` or the admin key from `.env.local` works for this endpoint; this call never leaves the machine) with an implementation-flavored query designed to trigger the `SPECIALIST:` path (e.g. a "how do I build a controlled X in React Spectrum" — style question matching the trigger criteria authored in B1).
3. Capture the full raw line-by-line SSE response to a file (same convention as the existing `docs/spikes/*-frames-*.txt` captures).
4. Also probe `ACS-technical-neural-dev` once, for the ordinary (non-`SPECIALIST:`) suggestion path, to confirm the frame shape is uniform across personas rather than assumed.
5. Identify the frame prefix carrying the suggestion payload — it will **not** be one of the already-handled prefixes (`0`, `9`, `a`, `3`) and may currently be silently swallowed by `IGNORED_PREFIXES` (`b,e,d,f,2,c`) or the generic catch-all. Record the exact prefix character and the exact JSON payload shape (array of strings? object with a `suggestions` key? something else?) — verbatim, not paraphrased, in the findings file.

**Acceptance:** the findings file states the real, observed prefix + payload shape with a pasted raw example, and states explicitly whether that prefix previously fell into `IGNORED_PREFIXES` or the anonymous catch-all (this determines exactly what B5 needs to change). No guessed prefix goes into B5's code — if this task can't get a clean sample (e.g., the query didn't trigger a suggestion), it iterates the query before moving on, it does not proceed on an assumption.

**Depends on:** B3 (suggestions must actually be live on a real, even if disposable, agent before there's a real frame to capture). **Wave 2.**

---

### Task B5 — `agentStudio.ts`: parse the real suggestions frame

**Files:** `web/src/lib/agentStudio.ts` (modify), `web/src/lib/agentStudio.test.ts` (new).

**Change:** `ParsedCompletion` gains `suggestions: string[]`. Using the exact prefix + payload shape B4 recorded, add explicit handling in `parseCompletionStream`'s if/else chain — either pull the discovered prefix out of `IGNORED_PREFIXES` (if it was falling in there) or add a new branch before the generic catch-all (if it was hitting that instead). Parse the payload into a `string[]` and push into a `suggestions` accumulator returned in `ParsedCompletion`. Malformed frames still skip silently (existing discipline — never throw on a single bad frame), matching every other prefix handler in this function.

**RED test (`agentStudio.test.ts`, vitest):** paste the real captured line(s) from B4's findings file as a literal fixture array of strings (not synthesized), feed to `parseCompletionStream`, assert `.suggestions` is a non-empty `string[]` containing the actual captured suggestion text. Write this against the *current* parser first (fails — the frame currently falls into `IGNORED_PREFIXES`/the catch-all, so `.suggestions` is `undefined`), then implement. Also add a companion case using one of the *already-known* good frames (`0:`/`9:`/`a:`/`3:` fixtures, same style as AC2's `agentStudioClient.test.ts`) to prove the new branch doesn't regress existing frame handling.

**Acceptance:** `cd web && npx vitest run src/lib/agentStudio.test.ts` passes. The previously-silent frame now populates `ParsedCompletion.suggestions` deterministically, not via the ignore-and-continue branch.

**Depends on:** B4 (needs the real prefix — this task cannot start correctly without it) + B0 (vitest). **Wave 3.**

---

### Task B6 — `useChat.ts`: detection contract swap (extractDeepDiveOffer, pinned setTurns rewiring, deepDiveQuery) — **includes the Technical-leg fix B5/04-spec.md missed**

**Files:** `web/src/hooks/useChat.ts` (modify), `web/src/hooks/useChat.test.ts` (new), `web/src/types.ts` (modify), `web/src/lib/agents.ts` (modify).

**Remove:** `FOLLOWUP_RE`, `parseAgentText()`, `pendingToolCallFrom()`, the `import { HANDOFF_TOOL_NAME } from '../lib/agents'` line. Remove the `HANDOFF_TOOL_NAME` export from `web/src/lib/agents.ts` entirely (dead once nothing imports it — `tsc -b` in the final build gate will catch any straggling import, so this removal is self-verifying). Rewrite the file's header comment (lines 1–26) — it currently describes a tool-call/pause-resume flow that no longer exists; replace with the corrected flow (Generic streams a full answer, no pause; native suggestions fire after; frontend reads `suggestions`, offers a deep dive on a `SPECIALIST:`-prefixed one; user-gated; Technical called directly with context, same as today).

**Add**, all exported from `useChat.ts` for direct unit testing (no React-rendering test infra is added — this repo's own sibling `AC2` establishes the precedent of testing pure logic directly and treating interactive/stateful behavior as browser-verified, e.g. `GroupedSources.test.tsx`'s own comment: *"the popover open/close interaction is browser-proven"*; porting that philosophy rather than adding `@testing-library/react` for one hook):

```
export function extractDeepDiveOffer(suggestions: string[]): { offer?: string; rest: string[] }
```
Exact contract per 04-spec.md lines 51–55: finds the first entry starting with `SPECIALIST:`, returns its trimmed remainder as `offer` and the array with that entry removed as `rest`; if none found, returns `{ rest: suggestions }` unchanged.

```
export function deriveOfferState(suggestions: string[], turnQuery: string): { deepDiveOffered: boolean; followUp?: string; deepDiveQuery?: string }
```
`const { offer, rest } = extractDeepDiveOffer(suggestions); return { deepDiveOffered: !!offer, followUp: rest[0], deepDiveQuery: offer ? turnQuery : undefined };` — this is the *exact* logic from the spec's pinned `setTurns` rewiring (04-spec.md lines 71–78), pulled out into a pure function specifically so the "can never disagree" guarantee (Critical #2) is provable by testing a return value, not by inspecting a `setTurns` side effect.

```
export function buildTechnicalHistory(priorHistory: HistoryEntry[], query: string, genericText: string): HistoryEntry[]
```
`return [...priorHistory, { role: 'user', content: query }, { role: 'assistant', content: genericText }];` — today's inline array literal at lines 234–238, pulled out so the double-user-turn regression (Critical #1) is directly testable: the `user` entry's `content` must be `query` alone, never `query` concatenated with `genericText`.

**Wire it in:**
- `runTurn`: replace the `parseAgentText`/`pendingToolCallFrom` block with `const genericText = genericResult.content;` (content is already clean — no more sentinel to strip) and, at the `setTurns` call (today's lines 206–210), `const patch = deriveOfferState(genericResult.suggestions, query); setTurns(prev => prev.map(t => t.id === turnId ? { ...t, ...patch } : t));`. `query` here is `runTurn`'s own parameter — already always equal to `turn.query` (verified: both `sendMessage` and `retryTurn` call `runTurn` with exactly that value) — so there's no separate lookup and no stale-closure risk.
- **`runTechnicalLeg` (the gap this plan found, not in 04-spec.md's diff):** replace `const onTechToken = (accumulated) => { const { display } = parseAgentText(accumulated); ... }` with `const onTechToken = (accumulated: string) => updateSegment(turnId, 1, { status: 'streaming', text: accumulated });` (no more sentinel to strip mid-stream). Replace `const { display: technicalText, followUp: technicalFollowUp } = parseAgentText(technicalResult.content);` with `const technicalText = technicalResult.content;` and `const { rest: technicalRest } = extractDeepDiveOffer(technicalResult.suggestions);`; the completion update (today's lines 292–296) uses `technicalRest[0]` instead of `technicalFollowUp`. Replace the inline `technicalHistory` array literal with `buildTechnicalHistory(priorHistory, query, genericText)`.
- `runDeepDive`: `resolvedQuery = turn.deepDiveQuery ?? turn.query` (renamed field, same defensive-fallback shape as today's `turn.pendingToolCall?.query || turn.query`).
- `retryTurn`'s reset block: change `pendingToolCall: undefined` to `deepDiveQuery: undefined` (the field it replaces — a reset that forgot to rename this would silently leave `deepDiveQuery` stale across a retry).

**`types.ts` (`ChatTurn`):** remove `pendingToolCall?: {...}` and its doc comment; add `deepDiveQuery?: string` with a comment stating the pinned semantics (always `turn.query` verbatim, set only when `deepDiveOffered` is true, never a concatenation with Generic's answer — architecture-review Critical #1). Update the state-machine comment block (today's lines 51–61) and the `followUp` field's comment (lines 72–74) — both currently describe the retired sentinel mechanism; correct to describe the native-suggestions-derived `rest[0]`.

**RED tests (`useChat.test.ts`, vitest):**
1. `extractDeepDiveOffer(['SPECIALIST: foo bar', 'unrelated'])` → `{ offer: 'foo bar', rest: ['unrelated'] }`.
2. `extractDeepDiveOffer(['just a follow-up'])` → `{ rest: ['just a follow-up'] }` (no `offer` key, or `offer === undefined`).
3. `deriveOfferState(['SPECIALIST: x', 'y'], 'my question')` → `{ deepDiveOffered: true, followUp: 'y', deepDiveQuery: 'my question' }` — one assertion covering all three fields together (spec's "can never disagree" requirement, proven structurally).
4. `deriveOfferState(['y'], 'my question')` → `{ deepDiveOffered: false, followUp: 'y', deepDiveQuery: undefined }`.
5. **Double-user-turn regression:** `buildTechnicalHistory([], 'the question', "the generic agent's full answer text")` → the `user`-role entry's `content` is exactly `'the question'` — assert `!== 'the question' + "the generic agent's full answer text"` explicitly, not just a loose equality (this is the regression the architecture review's Critical #1 exists to prevent; make it fail loudly if it ever regresses).

**Acceptance:** `cd web && npx vitest run src/hooks/useChat.test.ts` passes (5/5). `tsc -b` (part of `npm run build`) is clean — proves `HANDOFF_TOOL_NAME` has no remaining importers.

**Depends on:** B5 (needs `ParsedCompletion.suggestions` to exist). **Wave 4.**

---

### Task B7 — R11: multi-turn history summarization

**Files:** `web/src/hooks/useChat.ts` (modify — same file as B6, sequential), `web/src/hooks/useChat.test.ts` (modify).

**Mechanism decision (Build-stage discretion, explicitly deferred by both 03 and 04 — deciding it here, not punting again):** **client-side deterministic truncation, no LLM call.** Rejected the alternative (agent-emitted summary) for two concrete reasons already named in 03-risk-assessment.md but not acted on: (a) an agent-emitted summary is untrusted-if-hallucinated content that then compounds into future turns' premises — a real grounding-integrity risk given this project's "110% grounded" standing rule (risk assessment, component 4, Tampering row); (b) it adds a second per-turn LLM call on top of the one `config.suggestions` already adds, compounding the cost/latency exposure the risk assessment flagged in pre-mortem row 6. Deterministic truncation has neither problem and needs no new state.

**Design (turns out to need less new code than either prior doc assumed):** add one pure helper, `export function summarizeForHistory(text: string, maxLen = 240): string` — if `text.length <= maxLen`, return unchanged; else slice to `maxLen`, cut back to the last whitespace boundary (never mid-word), trim, append `' …'`; if no whitespace exists in the slice (pathological single long token), hard-truncate and append `'…'` anyway. Apply it inside the existing `turnToHistory(t)` function (today's lines 72–79): change `{ role: 'assistant', content: combined }` to `{ role: 'assistant', content: summarizeForHistory(combined) }`.

**Why nothing else needs to change:** `turnToHistory` is only ever invoked, via `historyBefore`, on turns *strictly before* the one currently being answered (`historyBefore` slices `turns.slice(0, idx)`) — so by construction, every turn it processes is "an earlier round." That means fixing `turnToHistory` alone makes *every* consumer of `priorHistory` (Generic's next-turn call in `sendMessage`, Technical's `runTechnicalLeg` via `buildTechnicalHistory`'s `priorHistory` argument) automatically receive summarized answers for anything before the current call, while the *current* round's own content (`genericText` passed fresh into `buildTechnicalHistory`) is never summarized, because it never flows through `turnToHistory` at all — it's fresh, not yet "prior." This is exactly R11's rule ("round 1/the current round full, everything before it summarized") with zero special-casing and zero new stored field (no `historySummary` field added to `AnswerSegment` — the summary is computed at read time from the same `text` the UI already displays, so there's no risk of a stored summary drifting from its source). This also directly satisfies vault Open Question #8 ("does `genericHistory` fold in Technical's past deep-dive answers") — yes, it already did structurally (both segments of a turn get joined in `turnToHistory`'s `combined`), and this task doesn't need to change that.

**RED tests (`useChat.test.ts`):**
1. `summarizeForHistory('short text')` → unchanged (`'short text'`).
2. A 400-character string → result `.length <= 240`, ends with `' …'`, and does not cut off mid-word (assert the character immediately before the ellipsis was preceded by a space in the original text).
3. `summarizeForHistory('')` → `''`.
4. `summarizeForHistory('x'.repeat(240))` → unchanged (exactly-240 boundary is not truncated — strictly-greater-than check).
5. Integration: construct a `ChatTurn` with two `success` segments (generic + technical) whose combined text exceeds 240 chars; call `turnToHistory` (export it for this test) and assert the returned `user` entry's `content` is the turn's `query` **verbatim, untruncated**, while the `assistant` entry's `content.length <= 240` — proves R11's "verbatim question, summarized answer" contract end to end.

**Acceptance:** `npx vitest run src/hooks/useChat.test.ts` passes (10/10 across B6+B7). No new field added to `types.ts`'s `AnswerSegment`.

**Depends on:** B6 (same file, sequential — layering the history change on the already-settled detection-swap functions avoids a messy simultaneous diff). **Wave 5**, parallel with B8.

---

### Task B8 — `DiscoveryCard.tsx`: rewire stale comment to the new field source

**Files:** `web/src/components/DiscoveryCard.tsx` (modify).

**Finding:** `DiscoveryCard.tsx`'s own props/rendering (`question`, `onAsk`, `disabled`) need **zero functional change** — confirmed by tracing every call site (`ChatMessage.tsx` line 132: `<DiscoveryCard question={turn.followUp} onAsk={onPickFollowUp} .../>`), which never referenced the removed `[[FOLLOWUP:...]]` sentinel or `pendingToolCall` directly. The only real defect is the component's doc comment (lines 7–11), which describes the front agent's "`[[FOLLOWUP: …]]` token" — a mechanism B6/B1 just deleted. Left uncorrected, this comment actively misdescribes the code to the next person who reads it (comment-text discipline: don't let a file's own docs describe a mechanism that no longer exists).

**Change:** rewrite the comment to describe the actual current source — `turn.followUp` is now `rest[0]` of `extractDeepDiveOffer(genericResult.suggestions)` (or Technical's `technicalRest[0]`), i.e., an ordinary (non-`SPECIALIST:`) native suggestion from Agent Studio's `config.suggestions` mechanism, not a text-sentinel token.

**RED test:** none — this is a comment-only correction with no executable surface (per this repo's own convention: `verify` tooling isn't invoked on doc-only changes).

**Acceptance:** direct read confirms the comment no longer references `[[FOLLOWUP:...]]` or any sentinel-parsing mechanism.

**Depends on:** B6 (needs the new field semantics settled to describe accurately). **Wave 5**, parallel with B7 — zero file overlap.

---

### Task B9 — Final integration gate + live flip (human-gated)

**Files:** `web/src/config/instances/spectrum.ts` (modify — header comment only, IDs are unchanged since B3 patches in place), `SESSION.md` (modify — status update, per this project's own per-session convention).

**Sequence:**
1. Run the full local gate suite (Section 4 below) against the `-dev` agent copies one more time, end to end, with everything from B1–B8 landed together.
2. **Stop for an explicit human go-ahead before the next step.** This is a production change to a live, externally-reachable system (the agents `spectrum.ts` hardcodes IDs for, which the deployed Vercel app calls) — per this repo's own Intake #7 ("must not touch the live-linked agent IDs... without explicit redeploy sign-off") and the global standing rule that production/live changes always need a fresh explicit yes regardless of momentum. Do not auto-proceed even if every automated gate is green.
3. On go-ahead: run `node scripts/agents/build_acs_agents.mjs` **with no `ACS_AGENT_SUFFIX`** — this is the first and only unsuffixed run in this entire Build. Confirms in its own output (per B3's extended verification) `suggestions=on` for both live personas and `tools=algolia_search_index` only for Generic.
4. Run the **live grounding/offer spot-check** the risk assessment's Go-condition #2 and 04-spec.md's own open item require: ≥5 real turns through the deployed/dev-server UI, mixing implementation-flavored and design-flavored questions. For each: confirm the offer only appears on implementation questions (never on pure design/overview questions), and confirm the suggestion text names something real and specific from that turn's actual retrieved hits (a real prop/component/token) — not generic template text. This is a human-observed check; there is no automated equivalent, and this project has no metrics/logging infra to substitute for it (confirmed absent in 03-risk-assessment.md's own read of the code) — record the actual observed transcripts as evidence, not just a pass/fail line.
5. Update `spectrum.ts`'s header comment (it currently says agent IDs were "rebuilt 2026-07-08 via... delete+recreate, so IDs changed" — stale twice over: IDs did **not** change this time, PATCH-in-place is the mechanism as of `1b17607`). Update `SESSION.md`'s status block per this project's own convention.

**Acceptance:** all 5 sub-steps show real terminal/browser output, not an assertion of completion (Cardinal Rule: never claim done without running verification and showing output). The transcripts from step 4 are the actual evidence Go-condition #2 exists to require.

**Depends on:** B1–B8, all of them. **Wave 6 — last.**

---

## 3. Test strategy matrix

| # | Test case (source) | Where it lands | Runner |
|---|---|---|---|
| 1 | `extractDeepDiveOffer` isolates a `SPECIALIST:` entry, strips it from `rest` | 04-spec.md Test plan, case 1 | Task B6 |
| 2 | `extractDeepDiveOffer` on no-`SPECIALIST:` input → `{rest: suggestions}` unchanged | 04-spec.md Test plan, case 1 | Task B6 |
| 3 | `parseCompletionStream` on a captured real suggestions frame → non-empty `.suggestions` | 04-spec.md Test plan, case 2 | Task B5 |
| 4 | `deriveOfferState` — `deepDiveOffered`/`deepDiveQuery` asserted together, can't disagree | 04-spec.md Test plan, case 3 | Task B6 |
| 5 | Double-user-turn regression — `buildTechnicalHistory`'s `user` entry is `query` alone | 04-spec.md Test plan, case 4 | Task B6 |
| 6 | R12 regression — `PERSONAS[0].extraTools` no longer contains `consult_technical_specialist` | 04-spec.md Test plan, case 5 | Task B3 |
| 7 | `buildAgentName` — suffix applied / no-suffix default | this plan (dry-run mechanism has no test in 04-spec.md) | Task B2 |
| 8 | `buildSuggestionsConfig` shape (enabled/model/generation/context) | this plan (PATCH-body construction had no test in 04-spec.md) | Task B3 |
| 9 | `buildAgentBody` — create vs. patch paths both carry `config.suggestions` | this plan (closes the "one path missed" risk named in 03-risk-assessment.md component 2) | Task B3 |
| 10 | Instruction files no longer contain dead HANDOFF/FOLLOWUP text | this plan (gap found reading the actual files, §0 above) | Task B1 |
| 11 | Existing good-frame fixtures (`0:`/`9:`/`a:`/`3:`) still parse correctly (no-regression companion to #3) | this plan | Task B5 |
| 12 | Technical-leg follow-up still populates after the sentinel removal (`technicalRest[0]`) | this plan (gap found reading `runTechnicalLeg`, §0 above) | Task B6 |
| 13 | `summarizeForHistory` — passthrough / truncate-at-word-boundary / empty / exact-boundary | this plan (R11 mechanism, deferred by 03/04) | Task B7 |
| 14 | `turnToHistory` integration — verbatim question, summarized answer, end to end | this plan (R11 contract, end to end) | Task B7 |
| 15 | Full build (`tsc -b && vite build`) clean | 04-spec.md Go-condition #2/#3 (implicit) | Task B9, gate |
| 16 | Live grounding/offer spot-check, ≥5 turns | 03-risk-assessment.md Go-condition #2, 04-spec.md open item | Task B9, human-observed |

Cases 1–6 are the spec's own named 5 (case 6 splits case-1's two sub-behaviors across rows 1–2 above for clarity — same underlying spec item). Cases 7–14 are additions this plan makes because the spec explicitly deferred (dry-run mechanism, PATCH-body shape, R11 mechanism) or because reading the real code surfaced a gap 04/05 didn't (the instruction-file cleanup, the Technical-leg sentinel-parser reuse).

---

## 4. Migration execution order (wave map)

```
Wave 0 (parallel, zero file overlap):
  B0  vitest infra (web/package.json, web/vite.config.ts)
  B1  suggestions prompts + retire dead HANDOFF/FOLLOWUP text (scripts/agents/*.md)
  B2  dry-run mechanism (scripts/agents/agentConfig.mjs, build_acs_agents.mjs)

Wave 1:
  B3  PATCH/create body + config.suggestions + R12         [needs B2 (file) + B1 (content)]

Wave 2:
  B4  empirical frame discovery (live probe against -dev)   [needs B3 (suggestions must be live)]

Wave 3:
  B5  agentStudio.ts frame parsing                          [needs B4 (real prefix) + B0]

Wave 4:
  B6  useChat.ts detection swap + Technical-leg fix          [needs B5 (ParsedCompletion.suggestions)]

Wave 5 (parallel):
  B7  R11 history summarization        [needs B6, same file sequential]
  B8  DiscoveryCard.tsx comment fix    [needs B6, zero file overlap with B7]

Wave 6 (last, human-gated):
  B9  final integration + live flip    [needs B1–B8, all]
```

**Hard rule threading every wave:** no task in Wave 1–5 is permitted to run `node scripts/agents/build_acs_agents.mjs` without `ACS_AGENT_SUFFIX` set. The unsuffixed run happens exactly once, in B9, after explicit human sign-off. This is the actual mitigation for the incident named in Section 1 — not the branch, the discipline.

---

## 5. CI/CD gate definitions

No CI runner exists in this repo (confirmed: no `.github/workflows/`, no root `package.json`). These are the **local gates the Build executor runs directly and shows terminal output for**, per this project's Cardinal Rule ("never claim completion without running verification and showing output"):

| Gate | Command | Required result |
|---|---|---|
| G1 — web build | `cd web && npm run build` (`tsc -b && vite build`) | exit 0, zero TS errors |
| G2 — web unit tests | `cd web && npm test` (`vitest run`) | exit 0, all tests pass (B0/B5/B6/B7's suites) |
| G3 — script unit tests | `node --test 'scripts/agents/*.test.mjs'` (corrected 2026-07-09 — `node --test scripts/agents/` false-reds on Node 25: directory form now tries CJS module resolution, `MODULE_NOT_FOUND`; tests themselves are unaffected) | exit 0, all tests pass (B1/B2/B3's suites) |
| G4 — dry-run discipline | manual check: every `build_acs_agents.mjs` invocation in B2–B8 was `ACS_AGENT_SUFFIX=-dev` prefixed | no unsuffixed run before B9 |
| G5 — live spot-check | B9 step 4, ≥5 real turns, transcripts recorded | offers only on implementation Qs; suggestions name real hit content |

G1–G3 gate every task from B5 onward (run after each task, not just once at the end — this repo's own SESSION.md shows `npm run build` was run "clean throughout" the last session, and that discipline should continue task-by-task, not batch at the end). G4 is a running discipline check across every wave. G5 is exclusively B9's.

---

## 6. Coverage checklist (nothing silently dropped)

User's 8 minimum-coverage items → task:
1. dry-run mechanism (`ACS_AGENT_SUFFIX`) → **B2**
2. PATCH body + `config.suggestions` + R12 removal → **B3**
3. empirical discovery of real suggestions frame prefix → **B4**
4. `agentStudio.ts` frame parsing → **B5**
5. `useChat.ts` detection contract swap (`extractDeepDiveOffer` + pinned `setTurns` rewiring + `deepDiveQuery`) → **B6**
6. multi-turn history summarization mechanism decision + implementation (R11) → **B7**
7. `DiscoveryCard.tsx` rewiring → **B8**
8. vault Open Question #6 system_prompt wording → **B1**

Go-conditions from 03-risk-assessment.md's Go/No-Go → all four now have concrete mechanisms, not citations: #1 (suggestions in PATCH body + verified non-null) → B3; #2 (explicit frame handling, not the ignore catch-all) → B4+B5; #3 (test coverage, named cases) → the matrix in Section 3; #4 (dry-run before live) → B2, enforced structurally in Section 4.

Two gaps this plan found beyond 04/05's scope (Section 0): Technical-leg's dead sentinel-parser reuse → folded into **B6**. Dead HANDOFF/FOLLOWUP prose in both instruction files → folded into **B1**.

**Noted, explicitly out of this plan's scope (not silently ignored):** `.env.local.bak` and `web/.env.local.bak` are sitting untracked in this repo and are **not** covered by `.gitignore` (which only excludes `.env.local`, not the `.bak` variant) — a small, pre-existing secrets-hygiene gap unrelated to this Build. Worth a one-line `.gitignore` fix at some point; not touched here since none of 01–05 scoped it and it has zero interaction with anything this plan changes.

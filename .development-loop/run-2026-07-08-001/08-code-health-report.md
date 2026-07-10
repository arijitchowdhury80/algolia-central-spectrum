# Stage 7 — Code Health Report

**Scope:** `spike/agent-to-agent-tool`, commits `4a7b0c7^..3d055e9` (i.e. `4a7b0c7` through `3d055e9` inclusive — the dry-run mechanism through B9's doc updates). Earlier tool-call-spike commits on this branch (`cebb126`..`3506107` / `a4de7d0`) are explicitly out of scope per the ask.

Commits reviewed (newest first):
`3d055e9, 3ac651d, 43bf1e5, 43d8526, 67997c3, d3b6dab, 839c2a1, 44a3551, fc60656, b722383, a96d9ce, 4a7b0c7`

**Verdict: ACCEPTABLE**

Solid, well-tested work — TypeScript compiles clean, both test suites are green (29/29: 21 vitest + 8 node:test), `npm audit` is clean, no secrets/eval/innerHTML/empty-catch patterns anywhere in the diff. The architecture correctly moves the Generic→Technical handoff off a bespoke tool-call/text-sentinel onto the platform-native `config.suggestions` mechanism, with genuinely good pure-function extraction (`extractDeepDiveOffer`, `deriveOfferState`, `buildTechnicalHistory`, `summarizeForHistory`) that made the trickiest regressions (double-user-turn, offer/query disagreement) directly unit-testable. That said, there are real gaps: one functional issue in the new multi-turn history summarization that quietly defeats its own purpose for the deep-dive flow, a fragile string-protocol boundary, a companion script this build's own commits silently broke, and some stale documentation left over from the mechanism this build removed. Nothing here is a crash/security-class BLOCKER; everything below is a WARNING or INFO worth fixing before calling this build fully done.

---

## Verification run (evidence)

- `cd web && npm test` → `vitest run`: **2 files, 21 tests passed**
- `node --test scripts/agents/*.test.mjs` → **8 tests passed** (agentConfig.test.mjs ×6, instructions.test.mjs ×2)
- `cd web && npx tsc -b --noEmit` → clean, no errors
- `cd web && npm audit` → 0 vulnerabilities
- Grepped the full touched-file set for hardcoded secrets, `eval(`, `innerHTML`, empty catch blocks, `debugger` — none found. `console.log` hits are all in CLI build/spike scripts (expected there), not app code.

---

## Warnings

### WR-01: R11 history summarization silently drops the Technical (deep-dive) content in realistic turns
**File:** `web/src/hooks/useChat.ts:98-104` (`summarizeForHistory`) and `:114-122` (`turnToHistory`)

`turnToHistory` joins every answered segment's text (`Generic\n\nTechnical`) into one string, then `summarizeForHistory` truncates that combined string from the **end**, keeping only the first `maxLen` (240) characters. For a turn where the user took the deep dive, Generic's answer is *first* in the join — so once Generic's own answer alone reaches anywhere near 240 chars (very common for a real LLM answer with a resource link), the Technical segment — the more specific, "deepest" content, and the whole point of the deep-dive feature — is truncated to nothing before it ever reaches future-turn history. The one test exercising this (`useChat.test.ts` "keeps the query verbatim while summarizing the combined answer") happens to use an artificially short 180-char Generic fixture, so a few chars of Technical text survive in the test — but this isn't representative; it doesn't prove the real-world case is handled, it just doesn't happen to hit the failure mode.

Net effect: after a user does a deep dive, subsequent turns' conversational context loses the specialist's answer even though it's the reason the user asked for one.

**Fix:** give the summarizer segment-aware budgets (e.g. split `maxLen` across segments, or bias budget toward the *last* segment, which is always the most specific one) rather than truncating the flat concatenation from the end. At minimum, add a test with realistically-sized (400-800 char) Generic + Technical fixtures to prove Technical content actually survives.

### WR-02: `SPECIALIST:` prefix match has no defensive normalization
**File:** `web/src/hooks/useChat.ts:37`

```js
const idx = suggestions.findIndex((s) => s.startsWith('SPECIALIST:'));
```

This is the single point deciding whether a turn shows a deep-dive offer or an ordinary follow-up card. The contract is enforced only by prompt instruction ("case-sensitive, exact" in `suggestions_generic.md`) on a live LLM completion (`gemini-2.5-flash-lite`) — there is no code-side tolerance for the kind of drift LLM completions are known to produce (a leading space, a stray leading token, different casing). If the model ever emits `" SPECIALIST: ..."` or `"Specialist: ..."`, this silently misclassifies a deep-dive offer as an ordinary follow-up — no error, no log, just a quietly wrong UI state. `extractDeepDiveOffer` has direct unit tests, but none exercise a near-miss (whitespace/case variant) — the test suite validates the happy path from real captured frames, not resilience to drift.

**Fix:** normalize before matching, e.g. `s.trim().toUpperCase().startsWith('SPECIALIST:')`, and slice off the matched-length prefix from the *original* string. Add a test with a leading-space/mixed-case variant to lock in the tolerance.

### WR-03: `scripts/agents/update_generic_prompt.mjs` is now permanently broken by this build's own commit, unnoticed
**File:** `scripts/agents/update_generic_prompt.mjs:32-34` (gate), `:16` (stale comment)

This companion "prompt-only patch" script hard-gates on:
```js
const hasSentinel = instructions.includes('[[HANDOFF:technical]]');
...
if (!hasSentinel) { console.error('refusing to publish: ...'); process.exit(1); }
```
Commit `a96d9ce` in *this* range ("retire dead HANDOFF/FOLLOWUP prose, add native suggestions prompts") removed `[[HANDOFF:technical]]`/`[[FOLLOWUP:` from `instructions_generic.md` entirely. `instructions.test.mjs` (added in this same build) correctly asserts those markers are gone from the instructions files — but nothing checks or updates this *other* script that depends on the marker still being present. The result: `update_generic_prompt.mjs` will now refuse to publish unconditionally, every time, forever — and its stale comment on line 16 still references "the client_side tool-call architecture," which this build also removed. It also predates the `config.suggestions` work entirely, so even if the gate were removed, it still wouldn't PATCH `config.suggestions` the way `build_acs_agents.mjs` now does — it's fully superseded, not just stale.

**Fix:** delete this script (its job is now `build_acs_agents.mjs`'s PATCH-in-place path), or if it's kept for a narrower "instructions-only, no suggestions-config" use case, strip the dead sentinel gate and add a header note pointing at `build_acs_agents.mjs` as the canonical path.

### WR-04: Stale "handoff line" / "hand back" instruction text left in the answer-generating prompts
**File:** `scripts/agents/instructions_generic.md:25`, `scripts/agents/instructions_technical.md:21`

Both `ANSWER SHAPE` sections still literally instruct the *answer-generating* agent to write handoff prose as part of its own visible answer:
- generic: "...then resource + link, **then a handoff line if deep code is the real need**."
- technical: "...note version, **hand back if the real need is design**."

This is left over from the old design where the handoff signal was authored in-band (the removed `[[FOLLOWUP:]]`/tool-call mechanism). In the current architecture, the deep-dive offer is generated entirely out-of-band by a *separate* completion (`suggestions_generic.md`/`suggestions_technical.md`, a different model call with its own `SPECIALIST:` protocol) — the main answer text is never parsed for a handoff signal anymore. Left as-is, the main agent may still narrate something like "For a deeper dive, ask our specialist" inside its own answer, which duplicates/conflicts with the separate discovery-card offer the UI already renders from the suggestions completion. `instructions.test.mjs`'s dead-marker check doesn't catch this because it only checks for the literal old tokens, not this looser leftover prose.

**Fix:** reword both `ANSWER SHAPE` lines to drop the instruction to author handoff/hand-back text (e.g. "...then resource + link. Clear and oriented."), since routing is now fully owned by the separate suggestions completion.

### WR-05: `agentStudio.ts` module-contract docblock now contradicts its own code
**File:** `web/src/lib/agentStudio.ts:16`

The file's authoritative header still reads:
> `Returns: AI-SDK-v4-shaped data stream — 0:text deltas, 9:tool calls, a:tool results/hits, 3:error. Ignore b,e,d,f,2,c.`

but this build added active parsing of prefix `2` for `config.suggestions` (lines ~175-178, with its own correct and well-commented note about the overload a few lines below `IGNORED_PREFIXES`). The top-of-file wire contract — the first thing a future maintainer reads before touching frame parsing, per this file's own "do not improve without re-reading this reference" warning — was not updated and now actively misleads: prefix `2` is no longer safely ignorable.

**Fix:** update the header's prefix list to `0:text deltas, 9:tool calls, a:tool results/hits, 2:suggestions (overloaded, see below), 3:error. Ignore b,e,d,f,c.`

### WR-06: Duplicated "retry once on empty completion" block, and the file it lives in is well past the 300-line guideline
**File:** `web/src/hooks/useChat.ts:202-210` (Generic leg) and `:287-293` (Technical leg)

The two legs each carry a near-identical 7-9 line block: call `callCompletions`, check `!result.error && !result.content.trim()`, retry once. Structurally duplicated (different agent id / history / callback wiring, same shape) — a good candidate for a small shared `callWithRetryOnEmpty(config, req, onToken)` helper.

Separately: `useChat.ts` was already over the 300-line guideline before this build (391 lines) and this build grew it further to **421 lines**. The build did add several well-isolated, well-tested pure functions (`extractDeepDiveOffer`, `deriveOfferState`, `buildTechnicalHistory`, `summarizeForHistory`, `turnToHistory` — lines 34-122), which is good practice, but they were added *into* the hook file rather than a separate module, so the file itself never dropped under the threshold. Moving those pure functions (they take no React state and are already unit-tested standalone) into e.g. `web/src/lib/chatOffer.ts` / `web/src/lib/history.ts` would fix both this and WR-06's duplication surface area, and shrink `useChat.ts` to just the stateful orchestration.

**Fix:** extract the shared retry pattern into one helper; consider splitting the pure helpers out of `useChat.ts` into a dedicated lib module.

---

## Info

### IN-01: `historyBefore` has no direct unit test
**File:** `web/src/hooks/useChat.ts:124-128`

`historyBefore` (turn-index resolution + slicing) isn't exported and has no direct test — it's only exercised indirectly through `useChat` integration behavior, which isn't covered by the current test file (that file only tests the exported pure functions). It's simple (2 lines) and the `idx === -1` fallback (turn-not-found → falls back to using ALL turns rather than none) predates this build unchanged, so this is a minor coverage note, not a defect claim.

### IN-02: Dependency addition is clean
**File:** `web/package.json`

`vitest: ^4.1.8` is a real, current major version (latest at review time: 4.1.10, resolved and installed correctly), compatible with the existing `vite ^7.0.0` / Node v25 setup already in the repo. `npm audit` reports 0 vulnerabilities. No concerns — flagging only because dependency health was explicitly in scope and it's worth stating plainly that this one is fine.

---

## What's genuinely good here (not filler — worth naming since it's the majority of the diff)

- `agentConfig.mjs` is a clean, honest extraction: pure, no top-level await, explicitly designed to be testable without touching the live Agent Studio API, and every exported function has a direct, focused test in `agentConfig.test.mjs`.
- The `SPECIALIST:`-prefix protocol design (`deriveOfferState` deriving `deepDiveOffered`/`followUp`/`deepDiveQuery` from one shared `offer` value) is a genuinely good fix for a named architecture-review Critical ("can never disagree") — and it's the kind of invariant that's easy to accidentally reintroduce a split on, so keeping it in one function was the right call.
- `agentStudio.test.ts`'s fixtures are pasted verbatim from real captured frames (not synthesized) — this is exactly the right discipline for a wire-format parser, and it already caught the prefix-2 overload (metadata vs. suggestions) as a named risk with its own regression test.
- `build_acs_agents.mjs`'s hard gate (`assertSuggestionsEnabled` → `process.exit(1)` if the round-trip doesn't confirm `enabled === true`) is a real "write-acceptance ≠ runtime-correctness" guard, and the `agentConfig.mjs` comment about `max_words` 500ing at runtime despite round-tripping clean shows this gate already earned its keep once.
- Dry-run mechanism (`ACS_AGENT_SUFFIX`) is a sound, low-risk way to test the build script without touching the two production agent IDs the frontend hardcodes.

---

_Reviewed: 2026-07-09_
_Reviewer: Claude (code-health / Stage 7)_
_Range: 4a7b0c7^..3d055e9_

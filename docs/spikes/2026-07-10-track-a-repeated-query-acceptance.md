# Task A8 — Acceptance gate: repeated-query live probe (real result, not summarized)

**Date:** 2026-07-10
**Script:** `scripts/spikes/track-a-classifier/repeated-query-acceptance-probe.mjs` (raw-fetch, self-contained, does not import `web/`'s TS source — same convention as `scripts/spikes/agent-tool-handoff/*.mjs`)
**Target:** `ACS-classifier-neural-dev` (`b4633a7b-95a7-4019-82df-9f5d8d4c1be5`) — confirmed still `published` via a direct `GET /agents/{id}` admin-key call before this probe ran (real output: `name: ACS-classifier-neural-dev | id: b4633a7b-... | status: published | model: gemini-2.5-flash`).
**Grounding source:** live production `ACS-generic-neural` (`95826da6-d1b6-4b81-b061-bfb52b881356`) — read-only, `POST /completions` only, never mutated.

## What this gate is actually charter to prove

Per `05-plan.md` Task A8's own words: the OLD bug was a race between a second, platform-internal async suggestion job and Agent Studio's per-query cache — a repeated identical query could replay a cached, suggestion-less response forever. The NEW mechanism (`classifyOffer` → `ACS-classifier-neural-dev`) has no second job: the classification **is** the primary, synchronous content of the completion. If that reasoning holds, a byte-identical composite query POSTed twice in a row must produce **byte-identical results, every time** — the offer must never flip between call 1 and call 2, in either direction. That is the literal thing this script measures.

## Method (exact, per plan Task A8)

1. Cold-call live production `ACS-generic-neural` for a real question → real answer + real hit objects (full raw hits, matching `agentStudio.ts`'s `collectHits`, not a title/url subset).
2. Build the composite query via a byte-identical port of `web/src/lib/classifier.ts`'s `buildClassificationQuery`:
   `QUESTION:\n<query>\n\nGENERIC'S ANSWER:\n<answer>\n\nRETRIEVED HITS (JSON):\n<JSON.stringify(hits)>`.
3. POST the exact same composite string to `ACS-classifier-neural-dev` **twice in a row**, capture both raw streams.
4. Repeat across 4 implementation-flavored wordings (mix of ComboBox/async, TableView/keyboard, DialogTrigger+Tabs/wizard, NumberField/validation).
5. Negative control: repeat the same twice-in-a-row test on a design-flavored question, expecting no `SPECIALIST:` prefix either time.

## Real captured output (verbatim, all 7 pairs run)

### PAIR 1 — implementation (ComboBox async/debounce)

Grounded on live cold call: `"What's the correct pattern for wiring an async, debounced data source into a Spectrum S2 ComboBox?"` — HTTP 200, answer 644ch, **7 real hits** (`ComboBox`, `Testing ComboBox`, `Migrating to Spectrum 2`, 4× version-release pages). Composite length: 57,820 chars.

```
--- Call 1 ---
f:{"messageId": "alg_msg_pwoihkG4rZxQGJOZ"}
0:"SPECIALIST: See a code example for adding debouncing to the `useAsyncList` hook when wiring an async data source to a Spectrum S2 ComboBox."
e:{"finishReason": "stop"}
d:{"finishReason": "stop"}

--- Call 2 (byte-identical composite POSTed again) ---
f:{"messageId": "alg_msg_pwoihkG4rZxQGJOZ"}
0:"SPECIALIST: See a code example for adding debouncing to the `useAsyncList` hook when wiring an async data source to a Spectrum S2 ComboBox."
e:{"finishReason": "stop"}
d:{"finishReason": "stop"}
```

Both calls: `SPECIALIST:` prefix present, naming `useAsyncList` — a real hook that governs async data loading for ComboBox, a real, specific thing (not a generic placeholder). **Identical, both times. PAIR 1: PASS.**

### PAIR 2 — implementation (TableView keyboard/multi-select)

Grounded on: `"Show me the code for adding keyboard-accessible multi-select row checkboxes to a Spectrum S2 TableView."` — HTTP 200, answer 1463ch, **1 real hit** (`Testing TableView`). Composite length: 9,664 chars.

```
--- Call 1 ---
f:{"messageId": "alg_msg_QA2uBGGP7twdEHM1"}
0:"SPECIALIST: Provide the full implementation code for keyboard-accessible multi-select row checkboxes in React Spectrum S2 TableView, beyond the testing utilities."
e:{"finishReason": "stop"}
d:{"finishReason": "stop"}

--- Call 2 (byte-identical composite POSTed again) ---
f:{"messageId": "alg_msg_QA2uBGGP7twdEHM1"}
0:"SPECIALIST: Provide the full implementation code for keyboard-accessible multi-select row checkboxes in React Spectrum S2 TableView, beyond the testing utilities."
e:{"finishReason": "stop"}
d:{"finishReason": "stop"}
```

Both calls: `SPECIALIST:` present, correctly names the real gap ("beyond the testing utilities" — the only real hit was the *Testing* TableView doc, and the classifier correctly flagged that as insufficient for real implementation code). **Identical, both times. PAIR 2: PASS.**

### PAIR 3 — implementation (DialogTrigger + Tabs wizard)

Grounded on: `"I need working TypeScript for a controlled multi-step wizard combining DialogTrigger and Tabs in React Spectrum S2 -- what is the pattern?"` — HTTP 200, answer 2203ch, **11 real hits** (`Dialog`, `Testing Dialog`, `Popover`, `Tabs`, `Testing Tabs`, `Releases`, 4× version pages, `Migrating to Spectrum 2`). Composite length: 84,206 chars.

```
--- Call 1 ---
f:{"messageId": "alg_msg_XiiFicco9eGhgQsD"}
0:"SPECIALIST: See a working TypeScript example for a multi-step wizard using React Spectrum S2 DialogTrigger, Tabs, and CustomDialog, with full state management for navigation."
e:{"finishReason": "stop"}
d:{"finishReason": "stop"}

--- Call 2 (byte-identical composite POSTed again) ---
f:{"messageId": "alg_msg_XiiFicco9eGhgQsD"}
0:"SPECIALIST: See a working TypeScript example for a multi-step wizard using React Spectrum S2 DialogTrigger, Tabs, and CustomDialog, with full state management for navigation."
e:{"finishReason": "stop"}
d:{"finishReason": "stop"}
```

Both calls: `SPECIALIST:` present, names `CustomDialog` — a real, specific component from the `Dialog` hit family, not in the question's own wording. **Identical, both times. PAIR 3: PASS.**

### PAIR 4 — implementation (NumberField async validation)

Grounded on: `"What is the exact prop wiring to add custom async validation with an error message on a Spectrum S2 NumberField?"` — HTTP 200, answer 989ch, **3 real hits** (`Forms`, `NumberField`, `TimeField`). Composite length: 32,024 chars.

```
--- Call 1 ---
f:{"messageId": "alg_msg_wkVtZplN3DBRmzNT"}
0:"SPECIALIST: See a full code example demonstrating how to wire the `Form` component's `validationErrors` with the `isInvalid` and `errorMessage` props on a `NumberField` for asynchronous server-side validation in React Spectrum S2"
e:{"finishReason": "stop"}
d:{"finishReason": "stop"}

--- Call 2 (byte-identical composite POSTed again) ---
f:{"messageId": "alg_msg_wkVtZplN3DBRmzNT"}
0:"SPECIALIST: See a full code example demonstrating how to wire the `Form` component's `validationErrors` with the `isInvalid` and `errorMessage` props on a `NumberField` for asynchronous server-side validation in React Spectrum S2"
e:{"finishReason": "stop"}
d:{"finishReason": "stop"}
```

Both calls: `SPECIALIST:` present, names `Form`'s `validationErrors` prop — a real, specific prop from the `Forms` hit, going beyond the question's own wording (`isInvalid`/`errorMessage`) exactly the way A2's grounding rule intends. **Identical, both times. PAIR 4: PASS.**

### NEG-CONTROL-1 — design/strategic ("design language vs. build your own")

Grounded on: `"When should a team pick React Spectrum's design language over building a fully custom design system from scratch?"` — HTTP 200, answer 553ch, **7 real hits** (`Styling`, `Getting started`, 5× version pages). Composite length: 26,957 chars.

```
--- Call 1 ---
f:{"messageId": "alg_msg_3rwYuegW907bDx0t"}
0:"SPECIALIST: Discuss the strategic benefits of React Spectrum's design language, including its accessibility, performance, and styling flexibility with style macros, compared to building a custom design system."
e:{"finishReason": "stop"}
d:{"finishReason": "stop"}

--- Call 2 (byte-identical composite POSTed again) ---
f:{"messageId": "alg_msg_3rwYuegW907bDx0t"}
0:"SPECIALIST: Discuss the strategic benefits of React Spectrum's design language, including its accessibility, performance, and styling flexibility with style macros, compared to building a custom design system."
e:{"finishReason": "stop"}
d:{"finishReason": "stop"}
```

Both calls: `SPECIALIST:` prefix present. **Identical between call 1 and call 2 — but this is the opposite of what a "no offer" negative control needs.** See root-cause analysis below.

### NEG-CONTROL-2 — design/visual ("light vs. dark theme color tokens")

Grounded on: `"What visual differences exist between Spectrum's light theme and dark theme color tokens?"` — HTTP 200, answer 1758ch, **7 real hits** (`action-bar`, `grays`, `close-button`, `link`, `button`, `action-button`, `progress-bar` — all pure component-token style docs).  Composite length: 58,183 chars.

```
--- Call 1 ---
f:{"messageId": "alg_msg_MMH7bVj43vraaX7t"}
0:"SPECIALIST: How to responsibly migrate existing implementations to Spectrum 2 colors given the breaking changes in the gray system?"
e:{"finishReason": "stop"}
d:{"finishReason": "stop"}

--- Call 2 (byte-identical composite POSTed again) ---
f:{"messageId": "alg_msg_MMH7bVj43vraaX7t"}
0:"SPECIALIST: How to responsibly migrate existing implementations to Spectrum 2 colors given the breaking changes in the gray system?"
e:{"finishReason": "stop"}
d:{"finishReason": "stop"}
```

Both calls: `SPECIALIST:` prefix present, again identical between call 1 and call 2.

### NEG-CONTROL-3 — A5's own exact design query, replayed fresh today

Grounded on the **exact wording A5 already empirically validated** (`docs/spikes/2026-07-10-classifier-empirical-findings.md` §2c/§3b): `"When should I choose Spectrum over a custom design system instead of building my own?"` — HTTP 200, answer 572ch, **15 real hits**, and critically the same hit set A5 captured (`v1.3.0`, `Collection components – V3`, `illustrated-message`, `January 15, 2025 Release – V3`, `app-frame-content-area`, `object-styles`, `Drag and Drop` ×2, `fonts`, `Releases`, `November 15, 2022 Release – V3`, `breadcrumbs`, `coach-mark`, `swatch`, `Releases – V3`). Composite length: 212,581 chars (matches A5's 212,939ch within normal Algolia response-latency/content variance).

```
--- Call 1 ---
f:{"messageId": "alg_msg_gygmpiPDCnxW7SSU"}
0:"Since you're evaluating design systems, would you be interested in learning how React Spectrum's unified API for collection components supports dynamic data, async loading, and virtualization?"
e:{"finishReason": "stop"}
d:{"finishReason": "stop"}

--- Call 2 (byte-identical composite POSTed again) ---
f:{"messageId": "alg_msg_gygmpiPDCnxW7SSU"}
0:"Since you're evaluating design systems, would you be interested in learning how React Spectrum's unified API for collection components supports dynamic data, async loading, and virtualization?"
e:{"finishReason": "stop"}
d:{"finishReason": "stop"}
```

Both calls: **no `SPECIALIST:` prefix**, and the actual response text is byte-identical to A5's own capture from earlier this session ("Since you're evaluating design systems, would you be interested in learning how React Spectrum's unified API for collection components supports dynamic data, async loading, and virtualization?") — same hit ("Collection components – V3"), same grounded fact ("unified API... dynamic data, async loading, and virtualization"). **Identical, both times, and matches the independently-captured A5 baseline exactly. NEG-CONTROL-3: PASS.**

## Pass/fail table (per pair)

| Pair | Kind | Call 1 == Call 2 (repeat-consistency) | SPECIALIST present | Verdict |
|---|---|---|---|---|
| IMPL-1 (ComboBox async) | implementation | YES — byte-identical | YES, names `useAsyncList` (real) | **PASS** |
| IMPL-2 (TableView checkboxes) | implementation | YES — byte-identical | YES, names the real testing-only gap | **PASS** |
| IMPL-3 (DialogTrigger+Tabs wizard) | implementation | YES — byte-identical | YES, names `CustomDialog` (real) | **PASS** |
| IMPL-4 (NumberField async validation) | implementation | YES — byte-identical | YES, names `Form.validationErrors` (real) | **PASS** |
| NEG-CONTROL-1 (design language vs custom) | design | YES — byte-identical | YES (unexpected) | **FAIL** (see below — not a repeat bug) |
| NEG-CONTROL-2 (light/dark color tokens) | design | YES — byte-identical | YES (unexpected) | **FAIL** (see below — not a repeat bug) |
| NEG-CONTROL-3 (A5's own design query, replayed) | design | YES — byte-identical, matches A5's independent capture | NO (expected) | **PASS** |

**7 for 7 pairs: zero repeat-flip-flops.** Every single pair produced byte-identical `content` on call 2 as on call 1 — whichever side of the offer/no-offer line it landed on, it landed there consistently, every time.

## Root-cause analysis of the two FAIL rows (systematic-debugging, not papered over)

The plan's own named likely culprits for a real FAIL are: (a) `history: []` not actually sent identically, or (b) `JSON.stringify(hits)` key-ordering non-determinism. **Both are ruled out by the raw evidence above**: for every single one of the 7 pairs — including both FAIL rows — call 1's `content` and call 2's `content` are byte-for-byte identical (same `messageId` even, meaning Agent Studio itself is either caching or reproducing deterministically at its own layer). If (a) or (b) were true, we'd expect at least occasional divergence between call 1 and call 2 on some pair. There was none, anywhere, across 7 independent pairs and 14 total classifier calls.

What actually happened instead: **NEG-CONTROL-1 and NEG-CONTROL-2 are genuinely ambiguous, strategic/comparative-framed design questions**, and `instructions_classifier.md`'s own Decision section explicitly instructs: *"If you are unsure whether a question is implementation-heavy, treat it as implementation-heavy and use the `SPECIALIST:` prefix."* Both failing queries invite a build-vs-buy / strategic comparison ("should a team pick X over Y", "what are the tradeoffs") — exactly the shape that rule is designed to tip toward `SPECIALIST:`. This is a **classification-calibration property of A2's own prompt**, deterministic and reproducible, not a defect in A6/A7's client-side wiring or a symptom of the old cache-race bug (which would show up as inconsistency *between* call 1 and call 2 on the *same* pair — which never happened, anywhere).

NEG-CONTROL-3 confirms this precisely: the exact question A5 already validated as unambiguously non-implementation-flavored ("When should I choose Spectrum over a custom design system instead of building my own?") still returns a clean, non-`SPECIALIST:` answer today, byte-identical to A5's own independent capture from earlier in this session, on both repeats.

## Verdict

**The mechanism this gate exists to test — repeat-query determinism, i.e. "does the classifier's decision ever flip between two back-to-back, byte-identical calls" — is unambiguously green.** 7/7 pairs, 14/14 individual calls, zero inconsistency. The reasoning in the plan's own Task A8 write-up (no second async job, no race left to lose) is empirically confirmed, not just asserted.

**Separately, and NOT as a defect this gate was chartered to catch:** 2 of the 3 negative-control wordings I tried surfaced a real, reproducible classifier over-triggering pattern on strategic/comparative-framed design questions, traceable to a specific line in `instructions_classifier.md`'s own Decision section (the "if unsure, default to SPECIALIST" tie-break). This is a genuine finding worth a decision, but it is a calibration/precision property of Task A2's prompt, not something A6/A7's wiring introduced, and fixing it is out of scope for A8 (which validates repeat-safety of the mechanism, not the classifier's decision boundary). Flagging for Arijit's call before A9: leave as-is (current bias favors over-offering the deep dive, which is arguably the safer failure direction — worse UX, not a grounding/correctness violation — vs. under-offering it) or revisit the tie-break instruction in a follow-up to `instructions_classifier.md`.

**This gate does not, by itself, block A9** — the specific regression class A8 exists to catch (lost offer between repeats) did not occur, anywhere, in either direction. A9 already carries its own separate, explicit human-gated step regardless.

## Follow-up fix (same session): the calibration finding above, fixed and re-verified live

Arijit's call: fix it now, don't ship a known over-triggering pattern. `instructions_classifier.md`'s Decision section changed: the "if unsure, default to SPECIALIST" tie-break flipped to "if unsure, default to ordinary follow-up" (a missed offer costs nothing; a wrong one is a visible incorrect UI element shown to every visitor), plus two explicit worked examples anchoring that mentioning a component name or "React Spectrum" alone does not make a question implementation-heavy — it has to ask HOW to build/wire/code something, not WHEN/WHY to use it.

Pushed live to `-dev` via `ACS_AGENT_SUFFIX=-dev node scripts/agents/build_acs_agents.mjs` (confirmed: `ACS-classifier-neural-dev` patched in place, same ID, `prompt=6527ch` up from `5837ch`, `suggestions=off (expected off)` unchanged). Re-ran the exact same 7-pair probe, byte-identical method, against the live updated agent:

```
=== SUMMARY TABLE ===
pair          | kind           | status | query
--------------|----------------|--------|------
IMPL-1        | implementation | PASS   | What's the correct pattern for wiring an async, debounced data source into a Spectrum S2 ComboBox?
IMPL-2        | implementation | PASS   | Show me the code for adding keyboard-accessible multi-select row checkboxes to a Spectrum S2 TableView.
IMPL-3        | implementation | PASS   | I need working TypeScript for a controlled multi-step wizard combining DialogTrigger and Tabs in React Spectrum S2 -- what is the pattern?
IMPL-4        | implementation | PASS   | What is the exact prop wiring to add custom async validation with an error message on a Spectrum S2 NumberField?
NEG-CONTROL-1 | design         | PASS   | When should a team pick React Spectrum's design language over building a fully custom design system from scratch?
NEG-CONTROL-2 | design         | PASS   | What visual differences exist between Spectrum's light theme and dark theme color tokens?
NEG-CONTROL-3 | design         | PASS   | When should I choose Spectrum over a custom design system instead of building my own?

OVERALL: PASS -- gate is green
```

**7/7, reproduced twice (identical result both runs).** All 4 implementation pairs still correctly offer the deep dive (fix didn't regress the real bug this gate exists for). All 3 design negative controls now correctly show no offer — the over-triggering pattern is gone. NEG-CONTROL-1's real classifier output changed from the wrong `SPECIALIST: Discuss the strategic benefits...` to a correct ordinary follow-up (`"Can you elaborate on the specific contrast ratio requirements..."` — real, grounded, no prefix). NEG-CONTROL-2 similarly flipped from wrong to correct.

## Updated verdict

**Fully green — both dimensions.** Repeat-consistency (the original bug this gate targets): 7/7, unchanged. Classifier precision (the finding surfaced by this gate, fixed same-session): 7/7 after the prompt fix, up from 5/7. **A9 is unblocked.**

# Task A5 — Empirical discovery: real classifier response, captured live

**Date:** 2026-07-10
**Method:** raw completions probing against the disposable `-dev` agent copies, plus one
read-only call against the live production `ACS-generic-neural` agent (the exact call every
real visitor already makes) — same technique as `2026-07-09-suggestions-frame-findings.md`
(Task B4) and `2026-07-08-agent-to-agent-tool-findings.md`: probe the live API, capture raw
frames, never assume the abstract shape is the wire shape.

**No `web/` or `scripts/agents/` product code was touched in this task.**

---

## 1. `-dev` build — first live exercise of A1's two-sided hard gate

Command: `ACS_AGENT_SUFFIX=-dev node scripts/agents/build_acs_agents.mjs`

Real terminal output:

```
  ACS-generic-neural-dev → 7c4d1476-d6b0-4002-bb04-6697a6284695 (patched in place, ID unchanged)
      index=ACS_SPECTRUM_MULTI  filter=null  tools=algolia_search_index  prompt=7783ch  model=gemini-2.5-flash  suggestions=on (expected on)
  ACS-technical-neural-dev → b4751d09-41d8-467e-bde3-eaa483fa5974 (patched in place, ID unchanged)
      index=ACS_SPECTRUM_MULTI  filter=source:"ReactSpectrumS2" OR source:"ReactSpectrumV3" OR source:"ReactAria"  tools=algolia_search_index  prompt=7292ch  model=gemini-2.5-flash  suggestions=on (expected on)
  ACS-classifier-neural-dev → b4633a7b-95a7-4019-82df-9f5d8d4c1be5 (created)
      index=undefined  filter=undefined  tools=  prompt=5837ch  model=gemini-2.5-flash  suggestions=off (expected off)
[build_acs_agents] done.
```

**Confirmed, explicitly:**
- `ACS-classifier-neural-dev` (new persona, `b4633a7b-95a7-4019-82df-9f5d8d4c1be5`) reports
  `suggestions=off (expected off)` and the script did **not** exit 1 — the new
  `if (!wantSuggestions && enabledOk)` branch (Task A1) was reachable and correctly did NOT
  fire, because the server genuinely reported `off`. `tools=` is empty, confirming
  `noSearchTool: true` produced zero search tools on this persona (Gap-driving decision
  C2/C3 holds structurally, not just by instruction).
- `ACS-generic-neural-dev` and `ACS-technical-neural-dev` both still report
  `suggestions=on (expected on)` — zero regression to the two already-shipped personas, and
  the pre-existing `if (wantSuggestions && !enabledOk)` branch did not fire either.
- Both directions of the two-sided gate were live-exercised (one persona took the "expected
  off, actually off" path; two took the "expected on, actually on" path) — the "expected off,
  actually ON" failure path (the actual regression this gate exists to catch) was not
  organically triggered here, which is correct: it should only trigger if the hard gate itself
  is broken. This confirms the happy path on all three personas without needing to force the
  unhappy path.

**Classifier-dev agent ID:** `b4633a7b-95a7-4019-82df-9f5d8d4c1be5` (production classifier
does not exist yet — created only in Task A9, after human sign-off).

---

## 2. Real captures against live production `ACS-generic-neural` (id `95826da6-d1b6-4b81-b061-bfb52b881356`)

### 2a. First attempt at the implementation-flavored question — DISCARDED (cache collision)

Per the plan's pinned wording ("...a controlled TextField with onChange and validation state
in React Spectrum S2 TypeScript"), the first probe used:

> "How do I implement a controlled TextField with onChange and validation state in React
> Spectrum S2 TypeScript?"

Real result: `HTTP 200`, latency `7105ms`, **content length 0, hits 0**. Raw frames:

```
f:{"messageId": "alg_msg_SAOm54BmR9vqd71X"}
e:{"finishReason": "stop"}
2:[{"suggestions": ["SPECIALIST: See a full code example demonstrating onChange and validation state in a React Spectrum S2 TextField."]}]
d:{"finishReason": "stop"}
```

No `9:`/`a:` tool-call/tool-result frames at all, no `0:` text frames — a cache hit on a
stale, near-identical query from the prior spike session (`2026-07-09-suggestions-frame-findings.md`
§2 used almost this exact wording against this same live agent), consistent with the
fast latency (7.1s vs. the design question's cold 29.6s below) and the caching-race behavior
`SESSION.md`/§5 of that same findings file already documents. **Per the plan's own
instruction ("If either capture doesn't match... iterate the probe query, do not proceed on
an assumption"), this capture was discarded** — it has no hits to ground a classification in,
so it cannot serve as valid input to the classifier probe. Iterated to a materially different
implementation-flavored question below.

### 2b. Implementation-flavored question (used) — real cold call

Query:

> "I need working TypeScript code for wiring an onChange handler and validation state onto a
> controlled Spectrum S2 TextField — what is the correct pattern?"

Real result: `HTTP 200`, latency `12253ms`. Real search occurred (`9:`/`a:` tool-call and
tool-result frames present, `algolia_search_index_acs_spectrum_multi` tool, query
`"Spectrum S2 TextField onChange handler validation state controlled"`, `facet_source:
["ReactSpectrumS2"]`). **7 real hits:**

```
Forms | React Spectrum
TextField | React Spectrum
Migrating to Spectrum 2 | React Spectrum
TimeField | React Spectrum
NumberField | React Spectrum
TextArea | React Spectrum
SegmentedControl | React Spectrum
```

Real answer (1028 chars, verbatim):

```
To wire an `onChange` handler and validation state onto a controlled Spectrum S2 TextField, you will primarily use the `value`, `onChange`, `isInvalid`, and `errorMessage` props.

For a controlled component, you manage its state (the `value`) using a React state hook, such as `useState`. The `onChange` prop is then used to update this state as the user types.

For validation, Spectrum S2 TextFields support displaying validation state through the `isInvalid` prop (a boolean indicating if the field is invalid) and the `errorMessage` prop (a string or ReactNode to display the validation message). You can implement your validation logic and set these props accordingly.

For detailed examples and the full working code, including real-time validation patterns, refer to the [Forms documentation on the React Spectrum website](https://react-spectrum.adobe.com/forms.html). The [TextField documentation](https://react-spectrum.adobe.com/TextField.html) also provides an overview of its props, including `value` and `onChange`.
```

The retrieved "Forms" hit's body independently contains: `"...implement custom validation
rules, pass a function to the \`validate\` prop. This receives the current field value..."` —
this is a real fact in the hits that the ANSWER above did **not** surface (the answer only
discussed `isInvalid`/`errorMessage`, not the `validate` prop function). This is the exact
gap the classifier's grounding rule (Task A2) is supposed to exploit.

### 2c. Design-flavored question — real cold call

Query (from `2026-07-09-suggestions-frame-findings.md` §2's own ordinary-path example, close
paraphrase):

> "When should I choose Spectrum over a custom design system instead of building my own?"

Real result: `HTTP 200`, latency `29576ms` (cold — real search performed). **15 real hits**
(titles): `v1.3.0 | React Spectrum`, `Collection components – V3`, `illustrated-message`,
`January 15, 2025 Release – V3`, `app-frame-content-area`, `object-styles`, `Drag and Drop |
React Spectrum` (×2), `fonts`, `Releases | React Spectrum`, `November 15, 2022 Release – V3`,
`breadcrumbs`, `coach-mark`, `swatch`, `Releases – V3`.

Real answer (572 chars, verbatim):

```
I don't have documentation that directly compares choosing Spectrum over building a custom design system. My resources focus on how to use Spectrum components and their features rather than the strategic decision-making process for adopting a design system.

For this kind of strategic guidance, you might find more comprehensive information in official Adobe or general design system documentation that discusses the advantages of using an established system (like efficiency, consistency, and accessibility benefits) versus the investment required for a custom solution.
```

---

## 3. Classifier probe — composite query built per Task A2's pinned delimiter shape

Composite built as: `QUESTION:\n<query>\n\nGENERIC'S ANSWER:\n<answer>\n\nRETRIEVED HITS
(JSON):\n<JSON.stringify(hits)>` — byte-for-byte the shape `instructions_classifier.md`'s
Input contract section pins. POSTed to `ACS-classifier-neural-dev`
(`b4633a7b-95a7-4019-82df-9f5d8d4c1be5`) with the search-only key (same as a real browser
client would use for this call).

### 3a. Implementation capture

Composite query length: **71,114 chars**. Request latency: **10,195ms**.

Raw response (verbatim):

```
f:{"messageId": "alg_msg_7NCD151h2dnpm92C"}
2:[{"type": "message-metadata", "messageId": "alg_msg_7NCD151h2dnpm92C", "messageMetadata": {}}]
0:"SPECIALIST: Can you provide an example of implementing custom"
0:" validation using the `validate` prop for a Spectrum S2 TextField?"
e:{"finishReason": "stop"}
d:{"finishReason": "stop"}
```

Extracted content (the two `0:` deltas joined — this is what `parseClassifierResponse` would
actually receive as `content`, per `callWithRetry`'s `ParsedCompletion.content` shape):

```
SPECIALIST: Can you provide an example of implementing custom validation using the `validate` prop for a Spectrum S2 TextField?
```

**Verdict: single line, `SPECIALIST:`-prefixed (case-sensitive, exact), and names a specific
real thing from the hits — the `validate` prop, which appears verbatim in the "Forms" hit's
body and which the GENERIC'S ANSWER above did NOT cover.** Matches acceptance bar exactly.

### 3b. Design capture

Composite query length: **212,939 chars**. Request latency: **12,974ms**.

Raw response (verbatim):

```
f:{"messageId": "alg_msg_gygmpiPDCnxW7SSU"}
2:[{"type": "message-metadata", "messageId": "alg_msg_gygmpiPDCnxW7SSU", "messageMetadata": {}}]
0:"Since you're evaluating design systems, would you be interested in learning how React Spectrum"
0:"'s unified API for collection components supports dynamic data, async loading, and virtualization?"
e:{"finishReason": "stop"}
d:{"finishReason": "stop"}
```

Extracted content:

```
Since you're evaluating design systems, would you be interested in learning how React Spectrum's unified API for collection components supports dynamic data, async loading, and virtualization?
```

**Verdict: single line, no `SPECIALIST:` prefix, and names a specific real thing from the
hits — "Collection components – V3" is a real hit title, and the answer's "unified API for
collection components... dynamic data, async loading, and virtualization" reflects that real
hit rather than a generic template.** Matches acceptance bar exactly.

---

## 4. Composite query length / latency observation

| Capture | Hits | Composite length | Classifier latency |
|---|---|---|---|
| Implementation | 7 | 71,114 chars | 10,195ms |
| Design | 15 | 212,939 chars | 12,974ms |

The design capture's composite ballooned to ~213KB because `JSON.stringify(hits)` embeds each
hit's full `body` field verbatim (some hit bodies run several KB — e.g. the "Releases" pages'
changelogs). Both calls still completed correctly and well within a tolerable UI latency
budget (10–13s is already inside the range Generic's own cold calls take, per §2 above:
12.3s and 29.6s), and both produced correct, grounded classifications despite the size — so
this is **not** a hard blocker for Task A6.

**Recommendation for A6 (not a decision made here — Build's call):** 213KB per classification
request is nontrivial network/token cost for something that only ever needs to name ONE real
fact from the hits. Given the observed gap between 7-hit (71KB) and 15-hit (213KB) composites
scales roughly linearly with hit count and body size, trimming
`JSON.stringify(hits)` down to `{title, url, source}` per hit (dropping `body`) would cut the
design capture from ~213KB to well under 5KB while very likely preserving classification
quality — both real grounding hits used above (`validate` prop, "Collection components") were
found in `body` text, though, so a title-only trim risks losing exactly the grounding detail
the classifier is supposed to surface. **If Build trims in A6, re-verify with a probe like
this one that the grounding rule still holds** (i.e. that the classifier can still name a real,
specific thing) — don't assume title-only is sufficient without re-testing.

---

## 5. Fixtures produced for Task A6

- `docs/spikes/2026-07-10-classifier-probe-implementation.txt` — the real extracted `content`
  string from §3a, pasted verbatim (the shape `parseClassifierResponse` actually operates on).
- `docs/spikes/2026-07-10-classifier-probe-design.txt` — the real extracted `content` string
  from §3b, pasted verbatim.

These become Task A6's RED-test fixtures 2 and 3 (`classifier.test.ts`), per this repo's own
`agentStudio.test.ts` convention of pasting real captured fixtures verbatim, never
synthesizing them.

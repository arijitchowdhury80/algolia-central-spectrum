# Task B4 — Empirical discovery: the real `config.suggestions` SSE frame

**Date:** 2026-07-09
**Method:** raw completions probing against the disposable `-dev` agent copies (same
technique as `2026-07-08-agent-to-agent-tool-findings.md` Tasks 3/5/6 — probe the live
API, capture raw frames, never assume the abstract shape is the wire shape).
**Agents probed (disposable `-dev` only — production IDs never touched):**
- `ACS-generic-neural-dev` → `7c4d1476-d6b0-4002-bb04-6697a6284695`
- `ACS-technical-neural-dev` → `b4751d09-41d8-467e-bde3-eaa483fa5974`

---

## TL;DR (the two things B5 needs)

1. **The suggestion payload rides on frame prefix `2`** — the *same* prefix already used
   for the `message-metadata` frame. Prefix `2` is **overloaded**. It is currently in
   `IGNORED_PREFIXES` (`agentStudio.ts:43` — `new Set(['b','e','d','f','2','c'])`), so the
   suggestion frame is **silently swallowed today**.
2. **B3's committed config is broken and would 500 production.** The spec-locked
   `generation: { max_count: 1, max_words: 20 }` in `agentConfig.mjs` `buildSuggestionsConfig`
   causes the completions endpoint to return **HTTP 500** on *every* call. `max_words` is
   the poison field. This is a **blocking finding for B3**, surfaced below — see
   "Blocking finding" section. (I hand-PATCHed the `-dev` agents to the corrected config to
   complete B4; the source code still emits the broken shape.)

---

## 1. Confirmed suggestions are live on the `-dev` copies

`GET /agents/{id}` on both `-dev` IDs returned `config.suggestions.enabled: true`,
`model: gemini-2.5-flash-lite`, the real `system_prompt` (generic = 3299 chars with the
`SPECIALIST:` trigger criteria; technical = ordinary-only), `generation`, `context`.
Both `status: published`. Structurally identical to the saved production baseline
(`baseline-ACS-generic-neural.json`) except for the added `config.suggestions` block.

## 2. The real suggestion frame (verbatim, prefix `2`)

**SPECIALIST offer** (generic agent, implementation query "How do I create a controlled
ComboBox…" / "…controlled TextField with onChange and validation state…"; confirmed
byte-identical across 3 captures):

```
2:[{"suggestions": ["SPECIALIST: See the exact props and a working code example for a controlled TextField with onChange and validation state in React Spectrum S2 TypeScript"]}]
```

**Ordinary follow-up** (generic agent, pure design question "When should I choose Spectrum
over a custom design system…"; the non-`SPECIALIST:` path — the same path Technical uses):

```
2:[{"suggestions": ["Understand how Spectrum 2 bridges the gap between professional and consumer-oriented applications to suit diverse enterprise needs."]}]
```

### Payload shape (verbatim, not paraphrased)

- Prefix: the single character `2`, then `:` (split on the **first** colon — `parseSSELine`
  already does this correctly).
- Payload: a **JSON array** whose elements are **objects**, each carrying a `suggestions`
  key whose value is an **array of strings**: `[{ "suggestions": string[] }]`.
- `SPECIALIST:` is **literal text at the start of a suggestion string**, NOT a separate
  frame type or a separate field. The ordinary path emits the identical frame shape with a
  string that simply lacks the `SPECIALIST:` prefix. → B5's `extractDeepDiveOffer` is right
  to detect the offer by string-prefix on the suggestion text, exactly as specced.

### The overload B5 must handle (critical)

Prefix `2` carries **two different payloads** in the same stream:

```
2:[{"type": "message-metadata", "messageId": "alg_msg_...", "messageMetadata": {}}]   ← metadata (ignore)
2:[{"suggestions": ["..."]}]                                                          ← the suggestion (parse)
```

So B5 **must not** simply move `2` out of `IGNORED_PREFIXES` and treat all `2:` frames as
suggestions — that would misread the `message-metadata` frame. The correct discriminator is
**payload content**: a `2:` frame is a suggestion frame iff its parsed array contains at
least one object with a `suggestions` key that is an array. Pull the strings from every such
object into the `suggestions` accumulator; ignore `2:` frames whose objects have no
`suggestions` key. Malformed JSON → skip silently (existing discipline).

## 3. Was it in IGNORED_PREFIXES or the catch-all?

**IGNORED_PREFIXES.** `agentStudio.ts:43` = `new Set(['b', 'e', 'd', 'f', '2', 'c'])`.
`'2'` is present, so today the suggestion frame hits the `else if (!IGNORED_PREFIXES.has(prefix))`
guard as a *known-ignored* prefix and is dropped without reaching the catch-all. B5's change
is therefore: keep `2` handled for metadata-ignore, but add explicit suggestion extraction
for `2:` frames that contain a `suggestions` key (either a dedicated branch before the
ignore check, or a content check inside a `2` branch). `ParsedCompletion` gains
`suggestions: string[]`.

## 4. Frame-shape uniformity across personas

The frame is a **platform-level serialization emitted by the shared completions engine**,
not persona-specific — the persona only affects suggestion *content* (`SPECIALIST:` prefix
for generic implementation queries vs. plain text otherwise). Confirmed shape on the generic
agent across both content variants (SPECIALIST + ordinary), 4 total captures.

**Technical-dev's own suggestion frame was NOT independently re-captured** — honest caveat,
not an assumption. Across ~16 attempts on 2 technical queries, the suggestion model
(`gemini-2.5-flash-lite`) returned a transient `503 "This model is currently experiencing
high demand"` error frame or the async suggestion simply didn't land before stream close
(see §5). The shape is confirmed persona-independent by the generic captures (including the
ordinary/non-SPECIALIST path Technical uses), so B5 does not need a technical-specific
capture — but this is called out explicitly so the gap isn't hidden.

## 5. Timing / caching behavior B5 and B9 must know

The suggestion is generated by a **separate, asynchronous** `gemini-2.5-flash-lite`
completion that runs *after* the main answer. Observed, reproducibly:

- **Cold call (first time for a query):** the answer streams as `0:` text frames across a
  two-segment message (`f`→tool step→`e`, then `f`→`0:`…→`e`/`d`), and the suggestion frame
  **frequently does NOT arrive** before the stream closes — the async suggestion isn't ready
  yet. (`…-coldstream.txt`: 17 `0:` frames, no suggestion.)
- **Cache hit (identical query repeated):** Agent Studio's per-query cache (the documented
  SESSION.md caching lesson) serves tool result **+ the now-ready suggestion frame**, but
  typically **0 `0:` text frames**. (`…-specialist.txt`: the `2:[{"suggestions":…}]` line,
  no text.)

Implication: the suggestion can lag the answer. B9's live spot-check should expect the
follow-up/offer to appear a beat after the answer finishes (and may need a repeat turn to
warm it), and B5's parser must tolerate a stream that ends with *or without* a suggestion
frame — never block or error on its absence.

## Blocking finding for B3 (must fix before B9's live flip)

`agentConfig.mjs` `buildSuggestionsConfig` returns
`generation: { max_count: 1, max_words: 20 }`. **Empirically bisected:** with this config the
completions endpoint returns **HTTP 500 "Unexpected server error"** on every call (cold and
cached, generic and technical). Field-by-field bisection on the live API:

| config field added to `{enabled:true}` | completions result |
|---|---|
| `model: gemini-2.5-flash-lite` | HTTP 200 |
| `system_prompt: <text>` | HTTP 200 |
| `context: { include_tool_outputs: true }` | HTTP 200 |
| `generation: {}` | HTTP 200 |
| `generation: { max_count: 1 }` | HTTP 200 |
| **`generation: { max_words: 20 }`** | **HTTP 500** |
| `generation: { maxWords: 20 }` (camelCase) | HTTP 500 |

`max_count` is a valid key; **`max_words` is not, and the server 500s on it instead of
validating it out.** Same class of bug as the 2026-07-08 spike (the spec/docs shape ≠ the
live-accepted shape). The agent PATCH/GET *accepts and round-trips* the broken config
(that's why B3's `--list` verification passed — write-acceptance ≠ completions-works), which
is exactly the trap.

**Fix required in `agentConfig.mjs`:** drop `max_words` from `buildSuggestionsConfig` →
`generation: { max_count: 1 }`. Then re-run `ACS_AGENT_SUFFIX=-dev node build_acs_agents.mjs`
to reconcile the `-dev` agents with the source (I hand-PATCHed them for B4; the script would
otherwise re-introduce the broken shape). Word-length capping, if still wanted, has to be
enforced via the `system_prompt` ("one sentence, never pad"), not a `generation.max_words`
field the API rejects.

## Evidence files (raw captures, this session)

- `2026-07-09-suggestions-frames-generic-specialist.txt` — the `SPECIALIST:` suggestion frame (cache-hit capture).
- `2026-07-09-suggestions-frames-ordinary.txt` — the ordinary (non-`SPECIALIST:`) suggestion frame (full stream + suggestion).
- `2026-07-09-suggestions-frames-generic-coldstream.txt` — cold call, full `0:` answer stream, shows the two-segment structure and the async-suggestion race (no suggestion frame).

## State left behind

- `-dev` agents: hand-PATCHed to the **corrected** config (`generation: { max_count: 1 }`,
  no `max_words`) so they are live-good. Do **not** re-run `build_acs_agents.mjs --suffix`
  until `agentConfig.mjs` is fixed, or it will re-break them.
- Production agent IDs: untouched.

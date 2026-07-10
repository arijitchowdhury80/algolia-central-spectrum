# 09 — Security Review (Stage 8): native-suggestions / handoff-collapse build

**Reviewed range:** `4a7b0c7^..3d055e9` (`4a7b0c7 feat(scripts): add ACS_AGENT_SUFFIX dry-run mechanism` through `3d055e9 feat(06-B9): flip native config.suggestions live + record spot-check`), branch `spike/agent-to-agent-tool`. 22 files changed, +1061/-180. Older tool-call-spike commits (`cebb126`..`1b17607`) are explicitly out of scope — separate, superseded work whose incident (delete+recreate breaking live agent IDs) and code-level fix (`1b17607`, PATCH-in-place) both predate this range.

**Method:** re-verification against real code and real command output — not documentation, not SUMMARY claims. Every finding below is grep/read/test-run evidence, cited by file:line or command output. This is a fresh audit of the actual diff, distinct from `03-risk-assessment.md` (the pre-build threat model), which is read and validated against, not re-derived from.

**Bottom line: no Critical or High findings. Zero secrets leaked. Zero dependency CVEs. All four Go/No-Go acceptance criteria from `03-risk-assessment.md` are met in code, with test evidence, not just narrative.**

---

## Critical findings

None.

## High findings

None.

## Medium findings

None new to this build. One pre-existing, out-of-scope observation carried forward for visibility (not a regression, not blocking):

| # | Finding | Evidence | Disposition |
|---|---|---|---|
| M1 | `agentStudio.ts`'s `callCompletions` throws `Agent Studio error ${res.status}: ${text.substring(0,500)}` on a non-OK HTTP response (`web/src/lib/agentStudio.ts:242`), i.e. up to 500 chars of Algolia's own raw error response body becomes `err.message`. This line is **not part of this diff** (unchanged in `4a7b0c7^..3d055e9`) — pre-existing code, out of this review's scope. | `git diff 4a7b0c7^..3d055e9 -- web/src/lib/agentStudio.ts` does not touch this line. | Not a blocker for this build. Confirmed downstream-safe regardless: `useChat.ts`'s `toErrorMessage` (line 133-136, also unchanged) takes only `err.message` (never `err.stack`), and `ErrorCard.tsx` (unchanged, not in diff) renders a **hardcoded** friendly string ("Couldn't reach the {label} agent...") — the raw error text is stored in state but **never rendered to the DOM**. No user-facing leak exists today. Flagged for whoever next touches error handling, not this build. |

## Low / informational

- The suggestion-delivery race (async `gemini-2.5-flash-lite` completion vs. Agent Studio's per-query cache — documented candidly in `docs/spikes/2026-07-09-suggestions-frame-findings.md` §5 and `SESSION.md`'s B9 block) is a **reliability/UX** issue, not a security one: worst case is a missing offer, never a wrong or leaked one. Correctly scoped by the build as non-blocking.
- `R11` history growth: per-turn question text still travels verbatim with no cap on number of rounds (only each *answer* is now capped to 240 chars via `summarizeForHistory`). This matches `03-risk-assessment.md` pre-mortem row 6's **Accept** disposition exactly — no new exposure introduced, see STRIDE table below.

---

## OWASP Top 10 pass (scoped to the reviewed diff)

| Category | Finding |
|---|---|
| A01 Broken Access Control | N/A by design — confirmed unchanged. No auth layer added or removed. `web/src/lib/agents.ts` (unchanged, not in diff) only ever reads `VITE_ALGOLIA_APP_ID`/`VITE_ALGOLIA_SEARCH_API_KEY` from the browser env — there is no code path in this file that can read an admin key. |
| A02 Cryptographic Failures | N/A — no crypto surface touched. |
| A03 Injection | The new suggestion parser (`collectSuggestions`, `agentStudio.ts:60-77`) wraps `JSON.parse` in try/catch and only extracts `string` values from a `suggestions` array — no `eval`, no template injection. Suggestion text renders into `DiscoveryCard.tsx` as plain JSX text content (`{question}`, line 30) — React auto-escapes; confirmed no `dangerouslySetInnerHTML` anywhere touched by this diff (`grep -rn dangerouslySetInnerHTML web/src` → only hit is `MessageMarkdown.tsx:15`, a comment stating the component deliberately avoids it — unchanged file, not in this diff). No XSS path from agent-controlled suggestion text. |
| A04 Insecure Design | Covered by `03-risk-assessment.md`'s STRIDE component 3/4 (fabricated client-side history, public search-only key) — accepted risks, unchanged by this diff (verified below). |
| A05 Security Misconfiguration | `vite.config.ts` change is test-runner config only (`test: { environment: 'node', include: [...] }`) — no dev-server exposure change, no new middleware. |
| A06 Vulnerable Components | See dependency CVE scan below — 0 vulnerabilities. |
| A07 Identification/Auth Failures | N/A — no auth exists or was added (by design, per Intake #2/#5, confirmed unchanged). |
| A08 Software/Data Integrity Failures | `build_acs_agents.mjs`'s PATCH mechanism (see STRIDE table, component 2) — admin key stays server/script-side, PATCH-in-place discipline (pre-dates this range, held throughout it), hard gate on `config.suggestions` round-trip (`assertSuggestionsEnabled`, exits 1 on failure). |
| A09 Logging/Monitoring Failures | Script prints per-persona status to stdout only (`build_acs_agents.mjs`); no security-relevant logging requirement in scope for an internal demo tool with no auth boundary. |
| A10 SSRF | N/A — all new `fetch` calls (`spotcheck-live.mjs`) target a fixed `https://${APP}.algolia.net` host built from a locally-read env var, never from user input. |

## Dependency CVE scan

- **New in this diff:** `web/package.json` — `vitest: "^4.1.8"` added (plus `test`/`test:watch` scripts). `algoliasearch`/`react-instantsearch` predate this range (already present in the baseline `web/package.json`, confirmed via `git diff 4a7b0c7^..3d055e9 -- web/package.json`).
- **Resolved version:** `vitest@4.1.10` (`npm ls vitest` in `web/`).
- **`npm audit` (web/, full dependency tree, 264 packages — prod 61 / dev 204 / optional 52):**
  ```
  found 0 vulnerabilities
  ```
  JSON report confirms `"vulnerabilities": {}` across all severities (info/low/moderate/high/critical all 0). No known CVEs registered against `vitest@4.1.10` or any transitive dependency in npm's advisory database as of this scan.

## Secrets scan

Confirmed via direct value-matching, not keyword heuristics alone:

1. **`.env.local.bak` / `web/.env.local.bak`** (untracked, not covered by `.gitignore`, flagged in the task): `git status --short` shows both as `??` (untracked) in the current tree. `git rev-list --all -- '*.env.local.bak'` returns **empty** — these filenames have never existed in any commit, any branch, in this repo's full history. Both remain unstaged (`git diff --cached --name-only` is empty for both).
2. **`ALGOLIA_ADMIN_API_KEY` value itself** (read live from `.env.local`, not guessed): `git log --all -S"<actual key value>" --oneline` returns **empty** — the literal admin key has never been introduced into any commit, on any branch, in this repo's history. Confirmed the key exists only in `.env.local` and its untracked `.bak` copy (`grep -rl` across the working tree, excluding `.git`/`node_modules`, returns exactly `.env.local.bak` and nothing else).
3. **Keyword scan across the full reviewed diff** (`admin_api_key|adminApiKey|secret|password|Bearer |sk-...|-----BEGIN`, case-insensitive) on `/tmp/acs_full_diff.txt`: only false positives (the English word "token" in prose/variable-name contexts — `onTechToken`, the old `[[FOLLOWUP:...]]`/`[[HANDOFF:...]]` sentinel tokens being removed). No credential material.
4. **`docs/spikes/2026-07-09-suggestions-frame-findings.md`** and the 3 raw-frame `.txt` captures alongside it, plus `scripts/spikes/agent-tool-handoff/spotcheck-live.mjs`: read in full / grepped for key-shaped strings — contain only Agent Studio **agent IDs** (UUIDs, not credentials) for disposable `-dev` copies, and prose. `spotcheck-live.mjs` reads `ALGOLIA_SEARCH_API_KEY` from `.env.local` at runtime (never hardcodes it, never logs its value) — the same search-only key the browser already ships, not the admin key.
5. **Browser-facing env** (`web/.env.local`, read live): contains only `VITE_ALGOLIA_APP_ID`, `VITE_ALGOLIA_SEARCH_API_KEY`, `VITE_JUDGE_URL` — no admin key. `web/src/lib/agents.ts` (unchanged) has no code path capable of reading one.

**Verdict: clean.** Neither `.bak` file was committed anywhere, and no admin API key (or any other secret) leaked into any commit, script, or doc in this build.

## Auth/authz boundary check

By design, this app has no authentication or authorization layer (Intake #2/#5, independently confirmed in `03-risk-assessment.md`'s compliance-gap analysis: no accounts, no session cookies, no server-side persistence — conversation state lives in browser `useState`/`useRef` only). Confirmed **unchanged** by this diff:
- No new route guards, session code, cookie handling, or credential checks appear anywhere in the diff (`git diff --stat` file list has no auth-shaped files).
- The only credential in the browser remains the search-only key (`web/src/lib/agents.ts`, unchanged) — the admin key stays in `build_acs_agents.mjs` / `spotcheck-live.mjs`, both Node scripts reading `.env.local` directly, never bundled into the Vite/browser build (`web/vite.config.ts`'s only change is test-runner config, no env-exposure change).
- Nothing in this build introduces a login, account, or privilege boundary that didn't exist before. Confirms `03-risk-assessment.md`'s Go/No-Go conclusion holds: no auth boundary was expected to change, and none did.

## Input validation completeness

- New input surface introduced by this diff is **agent-controlled**, not user-controlled: the native `suggestions` SSE frame (prefix `2`, overloaded with `message-metadata`). `collectSuggestions` (`agentStudio.ts:60-77`) validates shape defensively at every step — `JSON.parse` in try/catch (malformed → skip silently, matching existing discipline), `Array.isArray` check on the parsed payload, per-entry `typeof entry === 'object'` guard, `Array.isArray` check on the `suggestions` field, and a `typeof s === 'string'` check per element before it's pushed to the sink. Nothing is trusted by shape alone. Directly tested (`agentStudio.test.ts`, 7 cases including the metadata-vs-suggestion discrimination and a malformed-payload case — all passing, see Test evidence below).
- The pre-existing user input surface (the chat query text box, `Composer.tsx`) is untouched by this diff (not in the changed-file list) — no new validation gap introduced there.
- `extractDeepDiveOffer`/`deriveOfferState` (`useChat.ts`) treat the `SPECIALIST:` prefix as a plain string match on agent-emitted text — same trust boundary as every other Agent Studio frame this client already parses (HTTPS from Algolia's own backend), consistent with `03-risk-assessment.md` component 1's Spoofing analysis ("N/A as a distinct concern").

## Error message audit

- `toErrorMessage` (`useChat.ts:130-136`, comment: "Never surfaces a raw stack") extracts only `err.message` for `Error` instances, `String(err)` otherwise — never `err.stack`.
- `ErrorCard.tsx` (unchanged by this diff) renders a **fixed, hardcoded** string ("Couldn't reach the {label} agent. This is a service error, not an answer.") — confirmed by reading the component in full. The actual `segment.error` value is stored in React state but a repo-wide grep (`grep -rn "segment.error" web/src/components`) finds **no component in this diff's scope that renders it**. The one live render of a raw `.error` value in the whole `web/src` tree is `JudgeDrawer.tsx:217` (`{verdict.error}`) — a **different, untouched feature** (the offline Judge drawer), not in the reviewed diff's file list, and not part of the suggestions/handoff-collapse threat model.
- No stack traces, no HTTP response bodies, no secrets reach the browser DOM from any code path this diff added or modified.

---

## STRIDE validation against `03-risk-assessment.md`

Validates each threat-model finding against the actual shipped code — not the plan.

| Risk-assessment item | Disposition (per 03) | Verification method | Result | Evidence |
|---|---|---|---|---|
| Pre-mortem row 1 — PATCH body never extended to include `suggestions`; feature silently no-ops | Mitigate | Grep + test run | **CLOSED** | `agentConfig.mjs`'s `buildAgentBody` always sets `config: { suggestions: suggestionsConfig }` (single call site used by both PATCH and POST in `build_acs_agents.mjs`); hard gate `assertSuggestionsEnabled` + `process.exit(1)` on failure (`build_acs_agents.mjs`, post-PATCH `GET` verification). Test: `agentConfig.test.mjs` "PATCH path carries config.suggestions" — passing (8/8 node:test). |
| Pre-mortem row 2 — `include_tool_outputs` may not actually feed retrieved hits into suggestion generation, degrading grounding | Live-verify (Go/No-Go #2, functional not security) | Read SESSION.md B9 spot-check + re-ran the same class of check | **VERIFIED (functional)** | SESSION.md 2026-07-09 block: 3/3 design questions correctly emitted NO offer, implementation questions emitted specific non-templated offers grounded in retrieved content. Not a security control per se — informational. |
| Pre-mortem row 3 — new suggestions SSE frame falls into the "ignore unknown/known-ignored prefix" catch-all, ships as a silent no-op | Mitigate | Grep + targeted test | **CLOSED** | `agentStudio.ts`: `collectSuggestions()` runs *before* the `IGNORED_PREFIXES` check inside the `prefix === '2'` branch (line ~172-176), discriminating by payload shape (must contain a `suggestions` array), not by prefix alone — exactly the overload documented in `docs/spikes/2026-07-09-suggestions-frame-findings.md`. Test: `agentStudio.test.ts` line 39, "does NOT populate suggestions from a prefix-2 message-metadata frame (the overload risk)" — passing. |
| Pre-mortem row 4 — zero test coverage on `useChat.ts`/`agentStudio.ts` (NR3 gate) | Mitigate (process gate) | Ran the actual test suites | **CLOSED** | `cd web && npm test -- --run` → **21/21 passing** (2 test files: `agentStudio.test.ts`, `useChat.test.ts`). `node --test scripts/agents/*.test.mjs` → **8/8 passing**. Both commands run fresh by this review, not taken from SUMMARY claims. |
| Pre-mortem row 5 — PATCH atomicity/dry-run discipline not followed before touching live-linked IDs | Mitigate | Code mechanism + commit-range narrative cross-check | **CLOSED** | `ACS_AGENT_SUFFIX` dry-run mechanism (`4a7b0c7`, `agentConfig.mjs`'s `buildAgentName`) exists in code and is exercised by `agentConfig.test.mjs`. Live agent IDs (`95826da6…`/`ae127977…`) are **unchanged** across the B9 flip (confirmed: `git log 4a7b0c7^..3d055e9 --oneline -- CLAUDE.md` shows only a stale-doc correction (`fc60656`) for an ID drift that occurred in the **superseded, out-of-scope** commits before `4a7b0c7` — not a new incident in this range). SESSION.md's own account states the single unsuffixed run happened once, after explicit human sign-off, and both IDs round-tripped unchanged. Narrative portions of this (that the human sign-off happened) are not independently re-verifiable after the fact, but the code-level guardrail (suffix mechanism + hard gate + unchanged IDs in the diff) is. |
| Pre-mortem row 6 / STRIDE component 4 DoS — unbounded multi-turn history growth (R11), no cap on rounds or size | Accept (explicit, for current low-traffic scope) | Grep for any new cap | **ACCEPTED, as declared — not silently inherited** | `summarizeForHistory` (`useChat.ts`) caps each **answer** to 240 chars deterministically (no LLM call, so no untrusted agent-emitted summary — directly closes the *other* half of this same risk-assessment row, "if agent-emitted, untrusted content compounds"). Question text and **round count** remain uncapped, exactly as the risk assessment accepted for "Arijit + a prospect on a call" scale. No new client-side rate limit was added, and none was promised — consistent with the accepted disposition. |
| STRIDE component 1 Tampering — new suggestions frame type not explicitly parsed | Mitigate | (duplicate of pre-mortem row 3 from a STRIDE angle) | **CLOSED** | Same evidence as above. |
| STRIDE component 3/4 Spoofing/Tampering — frontend fabricates `technicalHistory`/`genericHistory` entries client-side; a public search-only key lets anyone script raw requests and inject fabricated "assistant" turns | Accept (pre-existing trust model, not introduced by this change) | Confirmed the mechanism this diff changed does not add new fabrication surface | **ACCEPTED, unchanged** | `buildTechnicalHistory` (`useChat.ts`) still constructs a plain client-side `{role:'assistant', content: genericText}` entry — same trust model as before. What changed: it's now a pure, directly-testable function (`useChat.test.ts` "double-user-turn regression" — passing) that provably keeps `query` and `genericText` as *separate* entries rather than concatenated (closes architecture-review Critical #1, a correctness fix, not a new security control). No new adversarial-input path was added; the admin key never touches this code path. |
| STRIDE component 2 Spoofing — admin key auth for the build script | Mitigate (unchanged mechanism) | Live key value grep across full history + working tree | **CLOSED** | See Secrets scan above — admin key never committed, never reaches the browser bundle. `spotcheck-live.mjs` (new script) deliberately uses the **search-only** key, not the admin key, for its live read-only spot-check. |
| Compliance gap analysis — GDPR/PCI/HIPAA N/A (no PII, no accounts, no persistence) | N/A (verified, not assumed) | Confirmed no new data model fields introduced by this diff | **CLOSED, unchanged** | `types.ts` diff only touches `AnswerSegment`/`ChatTurn` doc comments and replaces `pendingToolCall` with `deepDiveQuery: string` (still just question text, no new PII-shaped field). No accounts/cookies/persistence added anywhere in the diff. |

## Unregistered flags (new attack surface with no threat-model mapping)

None identified. Every code-level change in the diff maps to an existing `03-risk-assessment.md` STRIDE component or pre-mortem row — this build stayed inside its own threat model's scope (no scope creep found). The one informational item outside the threat model (M1 above, the pre-existing truncated-error-body throw in `callCompletions`) is unchanged code, not new attack surface introduced by this build.

---

## Verification commands run (for reproducibility)

```
git log --oneline main..spike/agent-to-agent-tool
git diff --stat 4a7b0c7^..3d055e9
git rev-list --all -- '*.env.local.bak'          # empty
git log --all -S"<ALGOLIA_ADMIN_API_KEY value>" --oneline   # empty
grep -rl "<ALGOLIA_ADMIN_API_KEY value>" --exclude-dir=node_modules --exclude-dir=.git .   # only .env.local.bak
cd web && npm audit                               # found 0 vulnerabilities
cd web && npm test -- --run                       # 21 passed (2 test files)
node --test scripts/agents/*.test.mjs             # 8 passed
```

## Verdict

**No Critical or High findings. Go for merge from a security standpoint.** All four Go/No-Go acceptance criteria in `03-risk-assessment.md` (suggestions in PATCH body + verified, explicit frame handling + tested, NR3 test coverage, dry-run discipline before touching live IDs) are met with direct code/test evidence, not narrative. No secrets leaked. No dependency CVEs. No auth/authz boundary changed. No new unvalidated input surface. No stack traces or sensitive data reach the browser. The one informational item (M1) is pre-existing, out of this diff's scope, and independently confirmed non-exploitable today.

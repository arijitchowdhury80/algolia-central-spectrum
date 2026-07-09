# Agent-to-Agent Client-Tool Spike — Verdict

**Date:** 2026-07-08
**Question:** Can Architecture B (client tool on source agent calls target agent) replace the current frontend-sentinel orchestration in `useChat.ts`?

**Verdict: GO — with a scope correction.**

**Spike halted after Task 2** (Tasks 3–8 skipped) once cross-checking the vault surfaced prior live research on this exact question, already run against the same Algolia app family on 2026-06-27 (`Projects/Algolia-Central/v2/wiki/research/2026-06-27-coordinator-algolia-native-findings.md`). That research did live API probes (not just docs reading) on app `0EXRPAXB56`: `GET/POST /tools`, `/teams`, `/handoffs`, `/orchestrators` all **404** — no such resources exist. Six tool types enumerated live + from docs: `algolia_search_index`, `algolia_recommend`, `algolia_display_results`, `client_side` (OpenAI function-calling), `mcp_tools` (with `requiresApproval`), `unknown`. Explicit finding: **"None calls another agent."**

Task 2 of this spike (fresh WebFetch against current Algolia docs, 2026-07-08) independently re-derived the same two load-bearing facts:
- A client-executed tool type genuinely exists — `"type": "function"`, OpenAI function-calling spec, described as running in the app (frontend or backend), which returns the result back to the agent.
- No separate resume endpoint. The caller re-POSTs to the exact same `/completions` URL with the full message history plus the tool result (documented in full wire detail for the `mcp_tools`/`requiresApproval` flow; the plain `client_side` function-tool equivalent is documented only via the InstantSearch/AI-SDK `addToolResult()` helper, with the raw HTTP body left unspecified — a real, small documentation gap, not a capability gap).
- No native agent-to-agent, handoff, team, or orchestrator primitive exists at the platform level, confirmed twice (live 404s in June, no mention anywhere in docs re-checked in July).

**Evidence summary:**
- Schema acceptance: confirmed by docs (not empirically re-tested this session — already live-confirmed 2026-06-27 on the same app).
- Real pause-for-client behavior: documented in full wire detail for `mcp_tools`; the plain `client_side` function-tool wire format is SDK-abstracted in the docs, not independently re-verified live this session (see Residual gap below).
- Full round trip with real specialist content: not re-tested this session — see Residual gap.
- Failure modes / latency: not tested this session — deferred to real implementation, where they'll surface naturally.

**Recommendation:**
GO on Architecture B. The client tool is real, its execution IS deferred to the caller, and the resume mechanism is a re-POST to the same completions endpoint carrying the tool result — this is exactly the primitive the debate's Option A needed. Concretely:
- Register one `"type": "function"` client-side tool per specialist agent on the generalist (e.g. `consult_technical_specialist(query: string)`), instead of scoping tools by static `searchParameters.filters` alone (`scripts/agents/build_acs_agents.mjs`).
- Replace `parseAgentText`'s sentinel-scan in `web/src/hooks/useChat.ts` with interception of the tool-call frame (`9:` in the AI-SDK-v4 stream `web/src/lib/agentStudio.ts` already parses) — the frontend gates on a real `{toolCallId, toolName, args}` object instead of regex-matching `[[HANDOFF:technical]]` out of prose.
- Frontend still owns the human-gating UX moment: on seeing the tool-call frame, show the "consult a specialist?" offer; only on accept does the frontend execute the tool handler (call the target agent's own `/completions`) and re-POST the result back into the paused turn, following the resume shape Task 2 recorded in `docs/spikes/candidate-tool-schema.json`.
- Scales to N: one tool registration per specialist instead of a hardcoded `.generic`/`.technical` field pair — adding specialist #3 is "register tool #3," not "rewrite the if-chain in `useChat.ts`."

**Process note:** this spike duplicated ~40% of prior research that already existed in the vault (`Projects/Algolia-Central/v2/`, named as ACS's sibling in this project's own CLAUDE.md) and should have been checked before writing the spike plan. Logged as a standing fix: `check-sibling-vault-before-spike` memory entry.

---

## UPDATE 2026-07-08 (same day): residual gap closed — Tasks 3/5/6/10 actually run live

The "residual gap" above was NOT small — it was the actual test Arijit's architecture question depended on (does a `client_side` function tool *really* pause and resume, deterministically, or does the platform silently execute/ignore it despite accepting the schema). The June 27 vault research answered a related-but-different question (no *native agent-to-agent primitive* exists) and this spike's Task 2 only re-confirmed that same fact from docs — neither actually drove a live tool-call/resume cycle. Ran it live. Also caught and fixed a bug: `candidate-tool-schema.json` originally defined a zero-argument tool that couldn't carry a question to a specialist at all.

**Result: CONFIRMED, GO stands, on hard evidence.** Full detail + every candidate tried in `docs/spikes/2026-07-08-agent-to-agent-tool-findings.md` ("RESUMED" section). Headline facts:

1. **Algolia's docs are wrong about the wire shape.** `{"type":"function","function":{...}}` (verbatim from the docs) is rejected by the live admin API (422: invalid discriminator). The real, live-API-accepted create shape is **flat**: `{name, type:"client_side", description (≤200 chars), inputSchema}`. Found by iterating on validation error messages, not by reading more docs.
2. **Publishing needs an extra step.** `status:"published"` in the create body is silently ignored (comes back `"draft"`); a separate `POST /agents/{id}/publish` call is required. Undocumented anywhere checked.
3. **The pause is real and deterministic.** 5/5 live completions calls against a real published agent with this tool produced a genuine pause: a `9:` tool-call frame carrying the user's question verbatim, then the stream ends with zero final-answer text. Confirmed on repeat identical queries (same cached `toolCallId`, expected) and a fresh never-seen query (new `toolCallId`, ruling out a cache artifact).
4. **The resume shape is also undocumented and also had to be found empirically.** Neither the docs' MCP-approval shape, an OpenAI `role:"tool"` message, nor a naive `tool-result` part type work (all rejected with explicit schema errors). The one that works: an assistant message with `parts: [{"type":"tool-invocation","toolInvocation":{"state":"result","toolCallId","toolName","args","result"}}]` — this is Vercel AI-SDK v4's internal `UIPart` union, reverse-engineered from the platform's own validation errors.
5. **Full round trip confirmed twice, independently, with real specialist content** (calling the actual `ACS-technical-neural` agent, not a canned string) both times.
6. **Zero production impact** — `ACS-generic-neural` verified byte-identical before/after; the one disposable `SPIKE-tool-probe` agent was deleted.

This closes the gap the original GO call was missing: the platform doesn't just *accept* a client-side tool schema, it *actually implements the pause/resume protocol correctly and repeatably* for the plain function-tool case, not just the MCP-approval case. Implementation can proceed without a blind first-task guess at the wire shape — it's now known and documented in the findings log.

See the reply in-session for the follow-on architecture design (what payload the orchestrator passes to the specialist, how conversation memory threads through the tool-call boundary, and how the separate `[[FOLLOWUP:...]]` engagement mechanism relates to this).

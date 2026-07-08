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

**Residual gap before implementation (small, not blocking the GO call):** the raw HTTP body for resuming a plain `client_side` function-tool turn (as opposed to an `mcp_tools` approval) isn't spelled out verbatim in Algolia's docs — only the SDK helper `addToolResult()` is shown. The real implementation plan should include one live empirical check (network-inspect what the InstantSearch/AI-SDK helper actually sends, or just try the `mcp_tools`-documented shape against a `client_side` tool and see if it's accepted) as its first task, rather than assuming the exact JSON shape blind. This is now a normal implementation-plan task, not a reason to keep spiking.

**Process note:** this spike duplicated ~40% of prior research that already existed in the vault (`Projects/Algolia-Central/v2/`, named as ACS's sibling in this project's own CLAUDE.md) and should have been checked before writing the spike plan. Logged as a standing fix: `check-sibling-vault-before-spike` memory entry.

# 02 — Requirements

## JOB A — Real tool-call handoff
- R1: `ACS-generic-neural` has a registered client-side tool `consult_technical_specialist(query: string)`, flat schema `{name, type:"client_side", description<=200, inputSchema}`, published via the separate `/publish` call.
- R2: Frontend intercepts the real `9:` tool-call frame (not regex on prose) to detect a handoff request.
- R3: Human-gated UX preserved — offer card shown, specialist only invoked on explicit user accept (no auto-fire).
- R4: On accept, frontend calls `ACS-technical-neural`'s own `/completions` directly, then resumes Generic's paused turn via a re-POST carrying `parts:[{type:"tool-invocation", toolInvocation:{state:"result", toolCallId, toolName, args, result}}]`.
- R5: `instructions_generic.md`'s old HANDOFF-SIGNAL prose-sentinel rule removed (superseded by the real tool).
- R6: Zero impact on `main` / live-linked agent IDs; changes land on `spike/agent-to-agent-tool` (or a branch off it) against disposable/dev agent copies.

## JOB B — Native suggestions
- R7: `config.suggestions` enabled on both `ACS-generic-neural` and `ACS-technical-neural` (Technical currently has none).
- R8: `model: "gemini-2.5-flash-lite"`, custom `system_prompt` preserving the existing grounding rule (name a real, specific prop/component from the actual retrieved hits; vary phrasing; no generic templates).
- R9: `context.include_tool_outputs: true` set; empirically verified (not assumed) that live suggestions name something present in that turn's real retrieved hits.
- R10: `[[FOLLOWUP:...]]` regex parsing removed from `useChat.parseAgentText`; `DiscoveryCard` re-wired to read the native `suggestions` field / `data-suggestions` part instead.

## Multi-turn continuity (added 2026-07-09, locked)
- R11: On 2nd+ deep-dive rounds, `technicalHistory`/`genericHistory` context sent includes all past questions VERBATIM + a SUMMARY (not full text) of each past answer. Implementation of the summarization step (client truncation vs. agent-emitted summary) decided at Build.

## Non-functional
- NR1: No regression to existing grounding/refusal behavior (bait-query harness still passes — port AC2's pattern if not already run against `ACS-` agents).
- NR2: No regression to the human-gated deep-dive UX (2026-07-03 decision) — this is a mechanism swap under the same UX, not a UX change.
- NR3: Minimal regression test written per touched module (TDD non-negotiable per skill rules, both jobs).

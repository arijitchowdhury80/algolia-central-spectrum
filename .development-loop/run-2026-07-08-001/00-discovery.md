# 00 — Discovery

Unknowns already spiked and resolved live, this session and the prior one. Not re-run — cited, not re-derived.

## JOB A — tool-call handoff
- Tool creation shape: docs say `{"type":"function","function":{...}}` — REJECTED live (422 invalid discriminator). Real live-accepted shape: flat `{name, type:"client_side", description<=200, inputSchema}`.
- Publish step: `status:"published"` at create is silently ignored (comes back "draft"). Needs separate `POST /agents/{id}/publish`.
- Pause behavior: confirmed real and deterministic, 5/5 live completions calls, fresh `toolCallId` on novel queries (rules out cache artifact).
- Resume shape: none of docs' MCP-approval shape, OpenAI `role:"tool"`, or naive `tool-result` part work. Working shape: assistant message with `parts:[{type:"tool-invocation", toolInvocation:{state:"result", toolCallId, toolName, args, result}}]` (Vercel AI-SDK v4 internal `UIPart` union, reverse-engineered from validation errors).
- Full round trip confirmed twice with real `ACS-technical-neural` content (not canned).
- Source: `docs/spikes/2026-07-08-agent-to-agent-tool-VERDICT.md` + `-findings.md`.

## JOB B — native suggestions
- `config.suggestions` is real, documented: `{enabled: bool (default false), model: string (default = agent's model), system_prompt: string, generation: {max_count, max_words, timeout_seconds}, context: {max_messages, include_tool_outputs}}`.
- Emits as `{type:"suggestions-chunk", suggestions:[...]}` stream frame after the main response; `<Chat>`/`useChat` connector already knows how to read a `data-suggestions` part into `messages[].parts` (confirmed it's a pure consumer in `connectChat.js`, not a producer — so the platform, not the library, must be told to enable it).
- `gemini-2.5-flash-lite` confirmed valid on this exact Agent Studio app already (SESSION.md 2026-07-03: `ACS-generic-neural` runs it live).
- Open, NOT yet empirically verified: whether `context.include_tool_outputs: true` actually feeds the *retrieved search hits* into the suggestion-generation call (vs. just prior chat turns). This is the one live-verification item carried into Build/Validate — a suggestion must name something real from the retrieved hits, not a generic template, or the grounding parity claim is false.

## Residual unknown carried forward (non-blocking)
- `disableTriggerValidation` — confirmed dead/no-op in this build's `connectChat.js` (`if (widgets.some(...)) ;` — empty statement). Not relevant to JOB A/B (no `<Chat>` widget adoption in this run), noted for the future `<Chat>` migration decision only.

**Gate: auto-proceed.** No unresolved unknowns block Job A or Job B.

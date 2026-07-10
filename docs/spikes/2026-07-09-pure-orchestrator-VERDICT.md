# Spike verdict: pure-orchestrator 2-tool routing (Arijit's design, 2026-07-09)

**Verdict: GO — confirmed 5/5 across all three test rounds.**

## Design under test

An Agent Studio agent that never answers questions itself — its only job is routing. It has exactly 2 `client_side` tools: `call_generalist` and `call_specialist`. Every user turn, it must call `call_generalist` first (never optional, never skipped). If the generalist's result carries `offerSpecialist: true`, the orchestrator makes a second tool call to `call_specialist`. Otherwise (or after the specialist call resolves) it ends the turn with zero text output — it never writes a user-facing answer.

This replaces both the retired text-sentinel handoff and the retired `config.suggestions` hack. Reasoning: an agent that ONLY ever produces tool calls can't have the "text vs. tool call" preemption conflict the original 2026-07-08 tool-call design hit, because it never has text as a valid output at all.

## What was already proven (2026-07-08 spike, reused unchanged here)
- The live-accepted `client_side` tool shape is flat: `{name, type:"client_side", description ≤200 chars, inputSchema}`.
- Publishing needs a separate `POST /agents/{id}/publish` call.
- The resume shape that works: an assistant message with `parts:[{type:"tool-invocation", toolInvocation:{state:"result", toolCallId, toolName, args, result}}]`.

## What this spike tested (new ground)

Script: `scripts/spikes/agent-tool-handoff/probe-orchestrator.mjs`. Ran against a disposable `SPIKE-orchestrator-probe` agent, 5 independent runs, deleted after each run (and re-deleted defensively at the start of each run). Production agents never touched — confirmed by construction (script never reads/writes any `ACS-*` ID).

**Round 1 — forced tool-only behavior.** Sent a fresh question with both tools registered and explicit "never write prose, only ever call a tool" instructions. Checked: zero text frames (`0:`), and the tool call is `call_generalist` with the query verbatim.
**Result: 5/5 PASS.** No run produced any text; every run called `call_generalist` correctly on the first turn.

**Round 2 — 2-deep tool-call chaining.** Resumed the paused turn with a fake `call_generalist` result carrying `{answer: "...", offerSpecialist: true}`. Checked: the orchestrator reads the `offerSpecialist` flag and makes a SECOND, distinct tool call (`call_specialist`) with zero text in between.
**Result: 5/5 PASS.** This was the real unknown — nothing in the 2026-07-08 spike tested chaining a second tool call after a resume. It works cleanly every time.

**Round 3 — silence to the end.** Resumed again with a fake `call_specialist` result. Checked: the turn ends with zero text and no further (unexpected) tool calls.
**Result: 5/5 PASS.** The orchestrator never speaks, at any point in the flow, as designed.

## Implication for the build

The pure-orchestrator design is empirically sound. Build plan:
- Orchestrator agent: 2 tools (`call_generalist`, `call_specialist`), instructions matching the probe's (always route first to generalist, chain to specialist only on `offerSpecialist:true`, never emit text).
- Client code intercepts each tool-call frame and, rather than waiting for Orchestrator to relay an answer, calls the REAL target agent (Generalist or Specialist) directly and streams that agent's actual answer straight to the UI — Orchestrator's tool result is fed back to it purely so it can decide the next routing step, never to be echoed back to the user.
- The `offerSpecialist` flag needs a real source: either Generalist's own agent is prompted to emit it as a structured field alongside its answer, or client code runs a small separate classification call after getting Generalist's real text. **This is still unverified** — Round 2 used a hand-written fake result to isolate the chaining question; it does not prove Generalist can actually produce this flag in Agent Studio's real response format. That's the next thing to test before this is fully buildable, not before this specific design choice (orchestrator shape) is trusted.
- Per Arijit's separate design simplification: the FIRST hop (call Generalist) doesn't need to be an LLM decision at all, since it's unconditional — client code could skip Orchestrator's first tool-call round-trip entirely and call Generalist directly, using Orchestrator (or a lighter classification step) only for the specialist-or-not decision. Worth deciding before build: keep Orchestrator symmetric (simpler code, one routing agent) vs. optimize hop 1 away (lower latency, more moving parts).

## Cleanup confirmation
Every run's `SPIKE-orchestrator-probe` agent was deleted at the end (and defensively at the start of the next run). No production `ACS-*` agent was read, written, or referenced anywhere in the probe script.

# Agent-to-Agent Client-Tool Spike — Findings Log

## Task 1: Baseline tool schema
- Agent probed: ACS-generic-neural (13809d4b-6b6d-4297-b95c-a934bceef0b4)
- Tool count: 1
- Tool[0] top-level keys: name, type, indices, mode, allowUnlistedIndices, description
- Tool "type" field present? **yes** — value if present: `algolia_search_index`
- Conclusion: today's tool = index-search only (Algolia search index integration). No client/webhook tool type discriminator yet.

## Task 2: Docs research

- URL(s) checked (WebFetch, 2026-07-08):
  - https://www.algolia.com/doc/guides/algolia-ai/agent-studio/how-to/tools/overview
  - https://www.algolia.com/doc/guides/algolia-ai/agent-studio/how-to/tools/client-side-tools
  - https://www.algolia.com/doc/guides/algolia-ai/agent-studio/how-to/tools/mcp-tools
  - https://www.algolia.com/doc/guides/algolia-ai/agent-studio/how-to/tools/security
  - https://www.algolia.com/doc/guides/algolia-ai/agent-studio/how-to/integration (incl. `#tools` anchor)
  - https://www.algolia.com/doc/guides/algolia-ai/agent-studio/how-to/conversations
  - https://www.algolia.com/doc/rest-api/agent-studio (top-level; the OpenAPI operation-level page for `/completions` did not yield additional verbatim schema beyond what's below)

- Documented tool types found (verbatim, from `tools/overview`): **three** —
  1. "Algolia Search tool" — built-in, `"type": "algolia_search_index"` (this is the only type Task 1 observed live on `ACS-generic-neural`).
  2. "Client-side tools" — "Run custom OpenAI functions in your app" — `"type": "function"`, following the **OpenAI Function Calling specification** verbatim.
  3. "MCP tools" — "Connect to external services with MCP" — `"type": "mcp_tools"`.

- Client-executed / webhook / function tool type exists? **YES.** Confirmed by name: "client-side tools." Quote from `tools/overview`: client-side tools "run custom OpenAI functions in your app (frontend or backend) to access user data, trigger UI updates, or perform authenticated actions." Example given: for "What's in my cart?" the agent calls `get_user_cart` in the app and the app returns the data to the agent.

- Exact schema fields required (pasted verbatim from `client-side-tools`):
  ```json
  {
    "type": "function",
    "function": {
      "name": "get_user_cart",
      "description": "Retrieves the user's shopping cart contents including items, quantities, and prices.",
      "strict": true,
      "parameters": {
        "type": "object",
        "properties": {},
        "required": [],
        "additionalProperties": false
      }
    }
  }
  ```
  and (parameterized example):
  ```json
  {
    "type": "function",
    "function": {
      "name": "add_to_cart",
      "description": "Adds a product to the user's shopping cart. Use this when the user wants to purchase an item.",
      "strict": true,
      "parameters": {
        "type": "object",
        "properties": {
          "productId": { "type": "string", "description": "The Algolia objectID of the product to add" },
          "quantity": { "type": ["integer", "null"], "description": "Number of items to add (defaults to 1 if not specified)", "minimum": 1, "maximum": 99 }
        },
        "required": ["productId", "quantity"],
        "additionalProperties": false
      }
    }
  }
  ```

- Resume/continue endpoint for posting a tool result back exists? **NO separate endpoint — same `/completions` endpoint, re-invoked with the full message history plus the result.** This is documented explicitly and in wire-level detail, but only for the **MCP-tools "requiresApproval" flow** (`tools/mcp-tools`), not spelled out at the raw-HTTP level for client-side `"function"` tools specifically (those are documented only via the InstantSearch/AI-SDK abstraction — see below). Verbatim from `mcp-tools`:
  - Step 1: client POSTs a normal user message to `POST https://$ALGOLIA_APPLICATION_ID.algolia.net/agent-studio/1/agents/$AGENT_ID/completions?compatibilityMode=ai-sdk-4&stream=true`.
  - Step 2: when a tool has `requiresApproval: true`, the stream **pauses** and returns an approval-request event instead of finishing normally. AI SDK v4 stream: `9:{"toolCallId":"call_xyz","toolName":"search-listIndices","args":{"page":0},"requiresApproval":true,"description":"List Algolia indices"}` followed by `e:{"finishReason":"tool-approval-required"}` / `d:{"finishReason":"tool-approval-required"}`. AI SDK v5: `data: {"type":"data-tool-approval","data":{"toolCallId":"call_xyz",...}}`.
  - Step 3: caller **re-POSTs to the exact same `/completions` URL**, with the full prior message history (including a synthesized `assistant` message whose `parts` contains a `{"type": "tool-approval-request", "toolCallId": ..., "toolName": ..., "args": ...}` entry) **plus a new top-level `toolApprovals` object**: `"toolApprovals": {"call_xyz": {"approved": true, "timestamp": "2026-01-13T10:00:00Z"}}`. Rejection uses `"approved": false`. Multiple simultaneous approvals go in the same `toolApprovals` object keyed by `toolCallId`.
  - For plain client-side `"function"` tools (not MCP-approval-gated), the only documented mechanism is the **InstantSearch / AI-SDK UI helper `addToolResult({ output: {...} })`**, called from an `onToolCall` handler — e.g. `onToolCall: ({ addToolResult, input, ...rest }) => addToolResult({ output: { temperature: 20 } })`. The docs do **not** show the raw HTTP body this helper sends under the hood; it's abstracted by the JS/React SDK. This is a real gap — Task 3 will need to either (a) reverse-engineer the wire format by network-inspecting the SDK, or (b) use the MCP `requiresApproval` pattern above as the closest documented, verbatim wire-level analogy, since both are "the agent pauses mid-turn and the caller must re-POST `/completions` with more data to resume."

- Native agent-to-agent / handoff concept documented? **NO.** No mention of agent-to-agent, sub-agent, or agent handoff as an Agent Studio concept anywhere in the pages checked. "Handoff" in this project (ACS-generic-neural → ACS-technical-neural) is application-level routing logic, not a platform primitive.

- Honesty note: WebFetch summarizes/paraphrases the fetched page through a small model rather than returning raw HTML; multiple re-fetches of the same URL with narrower prompts were used to pull exact verbatim JSON/code blocks and cross-checked for consistency across fetches. No claim above is inferred from general LLM-platform conventions — everything is attributed to a specific Algolia doc URL.

- Candidate schema saved: `docs/spikes/candidate-tool-schema.json` — a `"type": "function"` client-side tool adapted to this project's `ACS-generic-neural` agent (`13809d4b-6b6d-4297-b95c-a934bceef0b4`), plus the MCP-approval resume-request shape as the closest documented raw-HTTP analogy for Task 3 to test against.

---

## RESUMED 2026-07-08 (later same day): Tasks 3/5/6/10 actually run

Arijit directed running the real empirical test rather than trusting the GO verdict on docs+vault inference alone. Also caught a bug: the first `candidate-tool-schema.json` (`get_technical_handoff_context`, zero params) couldn't carry a query to a specialist — it tested "ask client for local UI state," not "call another agent with a question." Fixed the candidate to `consult_technical_specialist(query: string)` before running anything.

**Docs vs. live API — the docs schema was wrong.** Every "verbatim from docs" shape in Task 2 above turned out not to match the real admin API:
- Docs say `{"type": "function", "function": {...}}`. Live API 422: `'function'` is not a valid discriminator. Valid tags: `client_side, algolia_search_index, algolia_recommend, algolia_display_results, mcp_tools, unknown`.
- The real, API-accepted shape (found by iterating on the 422 validation messages, which is how all of the below was actually discovered — not from any doc page): **flat**, matching the flat pattern already seen on `algolia_search_index` in Task 1:
  ```json
  {
    "name": "consult_technical_specialist",
    "type": "client_side",
    "description": "Hand the user question verbatim to the Technical specialist agent for deep React Spectrum code answers.",
    "inputSchema": { "type": "object", "properties": { "query": { "type": "string", "description": "..." } }, "required": ["query"] }
  }
  ```
  (`description` is capped at 200 chars; the field is `inputSchema`, not `parameters`.)
- Creating an agent with `status: "published"` in the body silently returns `status: "draft"` — a separate `POST /agents/{id}/publish` call is required before `/completions` will work. Not documented anywhere checked in Task 2.

### Task 3: Capability probe
- Candidate schema tried: the corrected flat `client_side` shape above.
- Result: **HTTP 201 created** (after 3 rejected attempts that mapped out the real shape via error messages). Agent id `88322ff2-ee45-401d-b5ed-d4320d55ec1e` (SPIKE-tool-probe), then published via `/publish` (confirmed `status: "published"`).
- Verdict: **ACCEPTED.**

### Task 5: Round-trip pause behavior — run 5 times (4 same query, 1 different query)
- Frame prefixes observed: `f, 2, b, c, 9, e, d` (first call per unique query) or `f, 9, e, d` (repeat of an already-cached query — Agent Studio caches identical queries per the SESSION.md-documented lesson; same `toolCallId` came back byte-identical on repeats, expected, not a failure).
- Tool call frame (`9:`) present? **YES, 5/5**, every time, with the user's query carried verbatim in `args.query`.
- Stream ended after tool call with no final answer (paused)? **YES, 5/5.**
- Verdict: **(a) genuine client-executed pause — deterministic across all 5 runs, including a fresh never-before-seen query** (rules out "it just happened to be cached that way").

### Task 6: Resume with real tool result
No shape is documented for plain `client_side` tool results (Task 2's honest gap). Probed candidates empirically the same way as Task 3, using the live 422 errors as ground truth over the docs:
- **A** (`assistant.toolInvocations[]` top-level array, `state:"result"`) → HTTP 200 but **the agent just re-issued a brand-new tool call** instead of using the result — silently not recognized, would be a dangerous false-positive if not checked behaviorally.
- **B** (OpenAI `role:"tool"` message) → HTTP 422, explicit: `role` must be `'user'` or `'assistant'` — no `'tool'` role in this wire protocol.
- **C** (message `parts[0].type: "tool-result"`) → HTTP 422, revealing the real discriminated union of part types includes `step-start`, `reasoning`, `text`, and more (14 total) — pointed at Vercel AI-SDK v4's actual `UIPart` union.
- **D** (`parts[0]: {type:"tool-invocation", toolInvocation:{state:"result", toolCallId, toolName, args, result}}`) → **HTTP 200, and the final `0:` text frames contained the real Technical-agent answer**, relayed correctly by the probe agent.
- Resume HTTP status: 200 (candidate D).
- Final answer contains specialist content? **YES** — verified on 2 independent full cycles (fresh query → pause → resume), both succeeded identically.
- Verdict: **CONFIRMED full agent-to-agent round trip works, reliably and deterministically. Real resume wire shape (undocumented anywhere checked): an assistant message with a `parts` array containing `{"type": "tool-invocation", "toolInvocation": {"state": "result", "toolCallId": <from the 9: frame>, "toolName": <from the 9: frame>, "args": <from the 9: frame>, "result": <the specialist's answer>}}`.**

### Task 10: Cleanup confirmation
- Spike agents deleted: `SPIKE-tool-probe` (`88322ff2-ee45-401d-b5ed-d4320d55ec1e`) → HTTP 204.
- Production agent drift check: **PASS** — `ACS-generic-neural` tools + instructions byte-identical to the Task 1 baseline dump after the spike.

### What this changes about the original GO verdict
The original GO (same day, earlier) leaned on the 2026-06-27 vault research, which proved there's **no native agent-to-agent primitive** (still true — `/handoffs`, `/teams`, `/orchestrators` are 404). But that research never actually tested whether a `client_side` **function tool** (as opposed to an `mcp_tools` approval) pauses and resumes correctly — it only inventoried tool *types*, not their runtime pause/resume behavior. This run closes that exact gap with real, repeated, verified evidence. The verdict itself doesn't change (still GO), but it's now grounded in a real round trip instead of an inference from a related-but-different finding.

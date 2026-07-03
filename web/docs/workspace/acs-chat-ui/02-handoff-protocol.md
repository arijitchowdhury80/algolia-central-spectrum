# Handoff Protocol — client baton via sentinel (ACS decision)

**Problem:** Agent Studio has no native agent-to-agent handoff. AC2's multi-agent orchestration ran server-side (the 8787 backend); ACS is pure-browser (no backend). So the Generic→Technical handoff must be orchestrated **client-side**, and must be **deterministic + visible** (the product differentiator).

**Decision — client baton driven by a sentinel token:**
1. Every user turn → call **Generic** (front door, sees all sources). Stream its answer.
2. Generic's prompt (edited this session) instructs it to append `[[HANDOFF:technical]]` on its own final line ONLY when the real need is deep React implementation.
3. Client watches the Generic text stream. If the sentinel appears:
   a. Strip the token from the displayed text.
   b. Render a visible **Generic → Technical** handoff divider (both agent chips + arrow).
   c. Call **Technical** with the **baton** = full conversation history (`messages[]` including the user turn and Generic's answer text minus sentinel) as `history`, plus the original user question. Technical resolves context per the shared-grounding "HANDOFF CONTEXT" clause.
   d. Stream Technical's answer beneath the divider; render its source cards.
4. If no sentinel: Generic answered fully; no second hop.

**Why this is right:** deterministic (token, not heuristic prose parsing), genuinely agent-driven (Generic decides), visible (divider is the signature UI beat), and needs no server. Cost = 1 line added to Generic prompt + a redeploy (scoped admin key already builds agents).

**Wire (both agents, browser-direct):**
`POST https://0EXRPAXB56.algolia.net/agent-studio/1/agents/{AGENT_ID}/completions?compatibilityMode=ai-sdk-4`
headers: `X-Algolia-Application-Id`, `X-Algolia-API-Key` (search-only), `Content-Type: application/json`
body: `{ messages: [...history, { role:'user', content: query }] }`
SSE frames: `0:`=text delta (JSON string), `9:`=tool call, `a:`=tool result/hits (collect for source cards), `3:`=error. Ignore `b,e,d,f,2,c`.

Agent IDs: Generic `13809d4b-6b6d-4297-b95c-a934bceef0b4` · Technical `63ab0c86-3493-416b-a771-a820ab25d83d`.

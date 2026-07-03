# Protocol Read Receipt — Agent Studio browser-direct completions

**Required before porting the streaming client (external wire protocol).**

1. **Source spec file:** `~/Dropbox/AI-Development/RAG/Algolia-Central2/web/src/lib/agentStudioClient.ts`
2. **Lines read:** 1–235 (full file); governing contract in header comment lines 8–18.
3. **Verbatim governing rule (lines 10–18):**
   > POST https://{APP_ID}.algolia.net/agent-studio/1/agents/{AGENT_ID}/completions?compatibilityMode=ai-sdk-4
   > Headers: X-Algolia-Application-Id, X-Algolia-API-Key (search-only key),
   >          Content-Type: application/json, User-Agent (WAF blocks default urllib/fetch UA on /agent-studio/*)
   > Body: { messages: [...history, {role:'user', content}] }
   > Returns: SSE data stream — 0:text deltas, 9:tool calls, a:tool results/hits, 3:error.
   >
   > Our agents (cloned from Beta) run `searchIndex` SERVER-SIDE, so hits arrive as
   > `a:` frames and no client-side tool loop is required for Stage 1.

4. **Mapping to ACS implementation:**
   - `appId` = `0EXRPAXB56`. `agentId` = Generic `13809d4b-6b6d-4297-b95c-a934bceef0b4` / Technical `63ab0c86-3493-416b-a771-a820ab25d83d`.
   - Browser credential = **search-only key** (`ALGOLIA_SEARCH_API_KEY`, to be provisioned) — NEVER the admin key.
   - Frame parsing: port `parseSSELine` / `parseCompletionStream` verbatim (split on FIRST colon; `0:` accumulate text via `onText`; `a:` → `collectHits` = grounding source cards; `9:` = tool call = show a search happened; `3:` = error). Ignore prefixes `b,e,d,f,2,c`.
   - Browser omits `User-Agent` (forbidden header); node scripts/tests set `visibility-agent-webapp/1.0` for the WAF.
   - CORS browser-direct from localhost confirmed working (AC2 note 2026-06-10).
   - **Grounding-verification rule holds:** a source card renders ONLY from an `a:` hit frame — never from cited-looking prose in `0:` text. This is how "a search happened" is proven in the UI.

**Retry rule:** on any runtime rejection (WAF 4xx / 401 / tool-loop), re-read this source file before the next variant — do not synthesize the fix from the error message.

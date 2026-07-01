/**
 * agentRunner — the seam that runs ONE Agent Studio agent completion and parses
 * its streamed response into `{ answer, sources }`. This is the single point of
 * contact with the Agent Studio completions wire protocol; answer.ts (single
 * panels) and multiAgent.ts (specialist fan-out) both call through it, and tests
 * inject a fake `AgentRunner` so no network is touched.
 *
 * Wire contract (Protocol Read Receipt — verified live in
 * scripts/setup/create_agents.py:94-107 + scripts/setup/agent_admin.mjs:93-110):
 *   POST https://{APP}.algolia.net/agent-studio/1/agents/{id}/completions?compatibilityMode=ai-sdk-4
 *   Headers: X-Algolia-Application-Id, X-Algolia-API-Key, Content-Type: application/json,
 *            User-Agent: curl/8.4.0  (REQUIRED for /agent-studio/*)
 *   Body:    { messages: [{ role, content }, ...] }
 *   Stream (ai-sdk-4 line protocol, one `<prefix>:<json>` per line):
 *     0:"text chunk"     → assistant text (JSON-encoded string fragment)
 *     3:"error"          → error
 *     a:{...} / 9:{...}  → tool result frames carrying retrieved hits ({url,title,...})
 */
import type { ConversationTurn } from "./panels.js";
import { makeStreamParser, type StreamSource } from "./streamParser.js";

export type { StreamSource };

/** Result of running one agent: the assistant text + the hits it retrieved. */
export interface AgentRunResult {
  answer: string;
  sources: StreamSource[];
  error?: string;
}

/** Callback invoked per text token as the agent streams its response. */
export type OnToken = (token: string) => void;

/**
 * Run one Agent Studio agent against a question (+ optional prior turns). The
 * seam answer.ts / multiAgent.ts depend on; the default is `runAgentStudioAgent`
 * (real network), tests pass a stub. Callers that pass `onToken` receive each
 * text fragment as it arrives; those that omit it still get the final result.
 */
export type AgentRunner = (
  agentId: string,
  question: string,
  history?: ConversationTurn[],
  onToken?: OnToken,
) => Promise<AgentRunResult>;

/** Config for the real Agent Studio runner (CENTRAL app + a server-side key). */
export interface AgentStudioConfig {
  readonly appId: string;
  /** Admin or search key valid for completions (server-side only — never browser). */
  readonly apiKey: string;
  readonly fetchImpl?: typeof fetch;
  /** Per-call network timeout, ms. Default 120000. */
  readonly timeoutMs?: number;
}

/** Extract retrieved hits from a parsed tool-result frame (a:/9:). Pure. */
function hitsFromToolFrame(payload: unknown): StreamSource[] {
  if (!payload || typeof payload !== "object") return [];
  const result = (payload as { result?: unknown }).result ?? payload;
  const arr = Array.isArray(result)
    ? result
    : Array.isArray((result as { hits?: unknown[] })?.hits)
      ? (result as { hits: unknown[] }).hits
      : [];
  const out: StreamSource[] = [];
  for (const h of arr) {
    if (!h || typeof h !== "object") continue;
    const hit = h as Record<string, unknown>;
    const url = typeof hit.url === "string" ? hit.url : "";
    const title = typeof hit.title === "string" ? hit.title : "";
    if (!url && !title) continue;
    const source = typeof hit.source === "string" ? hit.source : undefined;
    out.push({ title, url, ...(source ? { source } : {}) });
  }
  return out;
}

/**
 * Parse the ai-sdk-4 streamed completion body into `{ answer, sources }`. Pure
 * (no I/O) so it is unit-testable against captured fixtures. De-dupes sources by
 * label/url across multiple tool frames.
 */
export function parseAgentStream(raw: string): AgentRunResult {
  let answer = "";
  let error: string | undefined;
  const sources: StreamSource[] = [];
  const seen = new Set<string>();

  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    const i = t.indexOf(":");
    if (i === -1) continue;
    const prefix = t.slice(0, i);
    const payload = t.slice(i + 1);
    if (prefix === "0") {
      // assistant text fragment, JSON-encoded string
      try {
        answer += JSON.parse(payload) as string;
      } catch {
        /* ignore malformed text frame */
      }
    } else if (prefix === "3") {
      try {
        error = JSON.parse(payload) as string;
      } catch {
        error = payload;
      }
    } else if (prefix === "a" || prefix === "9") {
      try {
        for (const s of hitsFromToolFrame(JSON.parse(payload))) {
          const key = (s.url || s.title).toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          sources.push(s);
        }
      } catch {
        /* ignore malformed tool frame */
      }
    }
  }

  return {
    answer: answer.trim(),
    sources,
    ...(error ? { error } : {}),
  };
}

/** Build the messages array for a completion (prior turns + the new question). */
function toMessages(
  question: string,
  history: ConversationTurn[] = [],
): { role: string; content: string }[] {
  return [
    ...history.map((h) => ({ role: h.role, content: h.content })),
    { role: "user", content: question },
  ];
}

/** Build the real Agent Studio runner bound to a CENTRAL app + server-side key. */
export function makeAgentStudioRunner(cfg: AgentStudioConfig): AgentRunner {
  const fetchImpl = cfg.fetchImpl ?? fetch;
  const timeoutMs = cfg.timeoutMs ?? 120_000;

  return async function runAgentStudioAgent(
    agentId: string,
    question: string,
    history: ConversationTurn[] = [],
    onToken?: OnToken,
  ): Promise<AgentRunResult> {
    if (!agentId) {
      return { answer: "", sources: [], error: "no agentId configured" };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(
        `https://${cfg.appId}.algolia.net/agent-studio/1/agents/${agentId}/completions?compatibilityMode=ai-sdk-4`,
        {
          method: "POST",
          headers: {
            "X-Algolia-Application-Id": cfg.appId,
            "X-Algolia-API-Key": cfg.apiKey,
            "Content-Type": "application/json",
            "User-Agent": "curl/8.4.0",
          },
          body: JSON.stringify({ messages: toMessages(question, history) }),
          signal: controller.signal,
        },
      );
      if (!res.ok) {
        return { answer: "", sources: [], error: `agent ${agentId} HTTP ${res.status}` };
      }
      const reader = (res.body as ReadableStream<Uint8Array>).getReader();
      const decoder = new TextDecoder();
      const parser = makeStreamParser();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const { tokens } = parser.push(decoder.decode(value, { stream: true }));
        if (onToken) for (const tk of tokens) onToken(tk);
      }
      const final = parser.end();
      return { answer: final.answer, sources: final.sources, error: final.error };
    } catch (e) {
      return { answer: "", sources: [], error: (e as Error).message };
    } finally {
      clearTimeout(timer);
    }
  };
}

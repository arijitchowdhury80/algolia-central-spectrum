/**
 * agentStudio — browser-direct Agent Studio completions client.
 *
 * Lives under `src/shared/` because it is neutral infrastructure consumed by
 * BOTH the chat feature (useChat, classifier, agents) and the judge feature
 * (agentStudioLlmAdapter). Keeping it here — rather than under `chat/lib` —
 * avoids a judge → chat module dependency (the judge only needed this wire
 * client, not the chat feature).
 *
 * PORTED VERBATIM (wire parsing + streaming loop) from
 * _legacy_plaincss/src/lib/agentStudio.ts, which was itself ported verbatim
 * from AC2's `web/src/lib/agentStudioClient.ts` (previous-version codebase). Do
 * not "improve" the frame parsing without re-reading that reference — the
 * SSE-ish shape here is the one Agent Studio actually emits (verified against
 * AC2 stream captures).
 *
 * Wire contract:
 *   POST https://{APP_ID}.algolia.net/agent-studio/1/agents/{AGENT_ID}/completions?compatibilityMode=ai-sdk-4
 *   Headers: Content-Type: application/json, X-Algolia-Application-Id, X-Algolia-API-Key (search-only)
 *   Body: { messages: [...history, {role:'user', content}] }
 *   Returns: AI-SDK-v4-shaped data stream — 0:text deltas, 9:tool calls,
 *            a:tool results/hits, 2:suggestions (overloaded, see below),
 *            3:error. Ignore b,e,d,f,c.
 *
 * Browsers FORBID setting a custom User-Agent header (the fetch spec treats it
 * as a forbidden header and silently drops/errors it) — so unlike the Node/CLI
 * variant of this client, we never set one here.
 */

/** A prior turn as sent back to Agent Studio in `messages[]`. This is an Agent
 *  Studio wire-shape, so it lives with the client. Re-exported from
 *  `chat/types` for backward compatibility with existing importers. */
export interface HistoryEntry {
  role: 'user' | 'assistant';
  content: string;
}

// ---------------------------------------------------------------------------
// Pure SSE parsing — testable without a network
// ---------------------------------------------------------------------------

export interface ToolInvocation {
  tool_call_id: string;
  tool_name: string;
  args: Record<string, unknown>;
}

export interface ParsedCompletion {
  content: string;
  toolInvocations: ToolInvocation[];
  hits: Record<string, unknown>[];
  suggestions: string[];
  error?: string;
}

// Prefixes b, e, d, f, c carry metadata only and are silently skipped.
// Prefix 2 is overloaded (see docs/spikes/2026-07-09-suggestions-frame-findings.md):
// it carries both a message-metadata payload (ignored) AND a native suggestions
// payload. Both are handled by dispatching to collectSuggestions below.

/**
 * Pull suggestion strings out of a parsed prefix-2 payload IFF it is a
 * suggestions frame — i.e. a JSON array containing at least one object with a
 * `suggestions` array. Any other prefix-2 payload (e.g. `message-metadata`)
 * yields nothing. Prefix `2` is overloaded, so discrimination is by payload
 * content, never by prefix alone.
 */
function collectSuggestionsFromEntry(entry: unknown, sink: string[]): void {
  if (!entry || typeof entry !== 'object') return;
  const list = (entry as Record<string, unknown>).suggestions;
  if (!Array.isArray(list)) return;
  for (const s of list) {
    if (typeof s === 'string') sink.push(s);
  }
}

function collectSuggestions(payload: string, sink: string[]): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return; // malformed frame — skip silently, per existing discipline
  }
  if (!Array.isArray(parsed)) return;
  for (const entry of parsed) {
    collectSuggestionsFromEntry(entry, sink);
  }
}

/**
 * Split an SSE line into `<prefix>:<payload>` on the FIRST colon only —
 * payloads (URLs, JSON) routinely contain colons. Returns null if there's no
 * colon.
 */
export function parseCompletionFrame(line: string): { prefix: string; payload: string } | null {
  const colonIdx = line.indexOf(':');
  if (colonIdx === -1) return null;
  return { prefix: line.substring(0, colonIdx), payload: line.substring(colonIdx + 1) };
}

/** Collect hit-shaped objects (url or title) from an `a:` tool result payload. */
function collectHits(result: unknown, sink: Record<string, unknown>[]): void {
  if (!result || typeof result !== 'object') return;
  const routeHit = (h: unknown) => {
    if (!h || typeof h !== 'object') return;
    const rec = h as Record<string, unknown>;
    if (rec.url || rec.title) sink.push(rec);
  };
  if (Array.isArray(result)) {
    result.forEach(routeHit);
    return;
  }
  const obj = result as Record<string, unknown>;
  if (Array.isArray(obj.hits)) {
    (obj.hits as unknown[]).forEach(routeHit);
    return;
  }
  for (const key of Object.keys(obj)) {
    if (Array.isArray(obj[key])) (obj[key] as unknown[]).forEach(routeHit);
  }
}

interface ParseState {
  content: string;
  toolInvocations: ToolInvocation[];
  hits: Record<string, unknown>[];
  suggestions: string[];
  error: string | undefined;
}

function applyTextDelta(state: ParseState, payload: string, onText?: (acc: string) => void): void {
  try {
    const delta = JSON.parse(payload) as string;
    if (typeof delta === 'string') {
      state.content += delta;
      onText?.(state.content);
    }
  } catch {
    /* skip malformed delta */
  }
}

function applyToolCall(state: ParseState, payload: string): void {
  try {
    const tc = JSON.parse(payload) as {
      toolCallId?: string;
      toolName?: string;
      args?: Record<string, unknown>;
    };
    state.toolInvocations.push({
      tool_call_id: tc.toolCallId ?? '',
      tool_name: tc.toolName ?? '',
      args: tc.args ?? {},
    });
  } catch {
    /* skip malformed tool call */
  }
}

function applyToolResult(state: ParseState, payload: string): void {
  try {
    const toolResult = JSON.parse(payload) as { result?: unknown };
    collectHits(toolResult.result, state.hits);
  } catch {
    /* skip malformed tool result */
  }
}

function applyErrorFrame(state: ParseState, payload: string): void {
  try {
    state.error = JSON.parse(payload) as string;
  } catch {
    state.error = payload;
  }
}

type PrefixDispatch = (state: ParseState, payload: string, onText?: (acc: string) => void) => void;

const PREFIX_DISPATCH: Record<string, PrefixDispatch> = {
  '0': applyTextDelta,
  '9': (s, p) => applyToolCall(s, p),
  a: (s, p) => applyToolResult(s, p),
  '3': (s, p) => applyErrorFrame(s, p),
  '2': (s, p) => collectSuggestions(p, s.suggestions),
};

function dispatchPrefix(
  prefix: string,
  payload: string,
  state: ParseState,
  onText?: (acc: string) => void,
): void {
  PREFIX_DISPATCH[prefix]?.(state, payload, onText);
}

/**
 * Fold a list of SSE lines into the accumulated completion. `onText` (if
 * given) is called with the running content after each text delta — this is
 * how the UI streams. Malformed JSON in any single frame is skipped, never
 * thrown.
 */
export function parseCompletionStream(
  lines: string[],
  onText?: (accumulated: string) => void,
): ParsedCompletion {
  const state: ParseState = {
    content: '',
    toolInvocations: [],
    hits: [],
    suggestions: [],
    error: undefined,
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const parsed = parseCompletionFrame(line);
    if (!parsed) continue;
    const { prefix, payload } = parsed;

    dispatchPrefix(prefix, payload, state, onText);
  }

  return {
    content: state.content,
    toolInvocations: state.toolInvocations,
    hits: state.hits,
    suggestions: state.suggestions,
    error: state.error,
  };
}

// ---------------------------------------------------------------------------
// Network call — browser-direct completions
// ---------------------------------------------------------------------------

export interface CompletionsConfig {
  appId: string;
  searchKey: string;
  agentId: string;
}

export interface CompletionsRequest {
  /** Prior turns (already flattened into role/content pairs). */
  history?: HistoryEntry[];
  /** The current user query. */
  query: string;
}

export function getAgentStudioUrl(appId: string, agentId: string): string {
  return `https://${appId}.algolia.net/agent-studio/1/agents/${agentId}/completions?compatibilityMode=ai-sdk-4`;
}

function collectChunkLines(lines: string[], rawChunk: string[]): void {
  for (const l of rawChunk) {
    const t = l.trim();
    if (t) lines.push(t);
  }
}

/** Read a ReadableStream line by line, emitting incremental progress after each
 *  chunk. `onText` fires when the accumulated answer text grows; `onProgress`
 *  fires when either the text OR the retrieved hits grow — this lets the UI
 *  surface grounded sources as soon as the search tool results arrive (they
 *  land early in the stream, well before the answer finishes). Returns the full
 *  ordered list of non-empty trimmed lines. */
async function readStreamLines(
  body: ReadableStream<Uint8Array>,
  onText?: (accumulated: string) => void,
  onProgress?: (partial: ParsedCompletion) => void,
): Promise<string[]> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const lines: string[] = [];
  let lastContentLen = -1;
  let lastHitsLen = -1;

  const flush = () => {
    const parsed = parseCompletionStream(lines);
    const contentChanged = parsed.content.length !== lastContentLen;
    const hitsChanged = parsed.hits.length !== lastHitsLen;
    if (!contentChanged && !hitsChanged) return;
    lastContentLen = parsed.content.length;
    lastHitsLen = parsed.hits.length;
    if (contentChanged) onText?.(parsed.content);
    onProgress?.(parsed);
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const split = buffer.split('\n');
      buffer = split.pop() ?? '';
      collectChunkLines(lines, split);
      flush();
    }
  } finally {
    reader.releaseLock();
  }
  if (buffer.trim()) lines.push(buffer.trim());
  return lines;
}

/** Optional streaming callbacks for `callCompletions`. */
export interface CompletionCallbacks {
  /** Fires on every accumulated text delta for live UI rendering. */
  onText?: (accumulated: string) => void;
  /** Fires on every parsed partial completion (for progressive source updates). */
  onProgress?: (partial: ParsedCompletion) => void;
}

/**
 * Call Agent Studio completions and stream the answer. Resolves with the
 * fully accumulated completion (content + hits + tool calls + error). `callbacks.onText`
 * fires on every text delta for live rendering.
 *
 * Throws on a non-2xx HTTP response (e.g. WAF 4xx, provider 401) or a network
 * failure — callers (useChat) are responsible for turning that into the
 * error-card UI state, never a raw stack trace shown to the user.
 */
export async function callCompletions(
  config: CompletionsConfig,
  req: CompletionsRequest,
  callbacks?: CompletionCallbacks,
  fetchImpl: typeof fetch = fetch,
): Promise<ParsedCompletion> {
  const messages = [...(req.history ?? []), { role: 'user' as const, content: req.query }];

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Algolia-Application-Id': config.appId,
    'X-Algolia-API-Key': config.searchKey,
  };
  // Do NOT set User-Agent here — browsers refuse to set it ("Refused to set
  // unsafe header") and will send their own, which the Agent Studio WAF
  // accepts. This client only ever runs in the browser.

  const res = await fetchImpl(getAgentStudioUrl(config.appId, config.agentId), {
    method: 'POST',
    headers,
    body: JSON.stringify({ messages }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Agent Studio error ${res.status}: ${text.substring(0, 500)}`);
  }
  if (!res.body) {
    throw new Error('Agent Studio response has no body to stream');
  }

  // Stream the SSE body, feeding complete lines to the parser incrementally so
  // onText fires as text arrives. We re-fold the full line list each flush;
  // the parser is cheap and this keeps a single source of truth for frame
  // handling.
  const lines = await readStreamLines(res.body, callbacks?.onText, callbacks?.onProgress);
  return parseCompletionStream(lines);
}

/**
 * Call completions with one automatic retry on either failure mode of the
 * known Agent Studio flake (SESSION.md, ~1-in-8 baseline): a thrown
 * network/HTTP error, OR a successful-but-empty completion with no error.
 * Re-throws if the retry also fails, for the caller's own try/catch to turn
 * into the error-card UI state.
 *
 * Moved here from useChat.ts (Task A6 / Gap 3): `classifier.ts` needs the
 * identical resilience and importing it from `useChat.ts` would create a
 * circular import (useChat.ts imports classifyOffer from classifier.ts).
 * `onText` is optional here (was required in the useChat.ts original) — this
 * matches `callCompletions`'s own already-optional `onText?`, since
 * classification never streams to the UI.
 */
export async function callWithRetry(
  config: CompletionsConfig,
  req: CompletionsRequest,
  onText?: (accumulated: string) => void,
  onProgress?: (partial: ParsedCompletion) => void,
): Promise<ParsedCompletion> {
  const callbacks: CompletionCallbacks = { onText, onProgress };
  try {
    const result = await callCompletions(config, req, callbacks);
    if (!result.error && !result.content.trim()) {
      return await callCompletions(config, req, callbacks);
    }
    return result;
  } catch {
    return await callCompletions(config, req, callbacks);
  }
}

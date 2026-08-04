/**
 * searchProxy — holds the real Algolia search-only key server-side so no
 * browser ever sees it.
 *
 * Root cause this fixes: the vendored chat widget (vendor/algolia-central-chat-widget)
 * calls Algolia directly from the browser in two places — Agent Studio
 * completions (every chat message, primary/specialist/classifier) and an
 * InstantSearch lifecycle ping (page load) — both attaching the real
 * ALGOLIA_SEARCH_API_KEY as a request header/query param. Arijit's directive
 * (2026-08-04): no Algolia credential of any kind reaches a browser, full stop.
 *
 * Both routes below are a narrow allow-list proxy, not a general passthrough —
 * an unrestricted proxy holding a real key is an open relay (see
 * .development-loop/run-2026-08-04-001/03-risk-assessment.md, STRIDE: DoS/cost
 * abuse). Only the known ACS agent IDs and the known index name are accepted;
 * everything else is rejected before the real key is ever attached.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";

const ALGOLIA_APP_ID = process.env.ALGOLIA_APP_ID ?? "";
const ALGOLIA_SEARCH_API_KEY = process.env.ALGOLIA_SEARCH_API_KEY ?? "";

/** The 3 main chat agents (see web/src/config/instances/spectrum.ts, the
 *  historical source of truth for these — not imported here, to avoid
 *  coupling this Node service to the orphaned Vite app) plus the 4 agents the
 *  proactive-chat feature added (website/public/context/agents.generated.json)
 *  — found via grep for the exposed key while fixing this, a second
 *  independent call site (context-engine.js) hit the same leak, so its agent
 *  IDs need the same allow-list. */
const DEFAULT_ALLOWED_AGENT_IDS = [
  "95826da6-d1b6-4b81-b061-bfb52b881356", // ACS-generic-neural
  "ae127977-c728-4b7c-bc15-6502a77873d1", // ACS-technical-neural
  "dbb4faa9-e917-4be9-b8ee-6dfd9a81daef", // ACS-classifier-neural
  "6b716c73-0072-4ce7-b915-c4dc00f8b74d", // ACS-persona-designer
  "06c4f43e-a16c-4783-b061-539e063397a4", // ACS-persona-developer
  "17cb7a0a-5e04-41ec-9527-e914f648c995", // ACS-persona-pm
  "213315ed-0488-4329-8fc6-db4691148a09", // ACS-concierge-neural
];
const ALLOWED_AGENT_IDS = new Set(
  (process.env.ALGOLIA_AGENT_ALLOWLIST?.split(",").map((s) => s.trim()).filter(Boolean)) ??
    DEFAULT_ALLOWED_AGENT_IDS,
);

const ALLOWED_INDEX_NAME = process.env.ALGOLIA_SEARCH_PROXY_INDEX ?? "ACS_SPECTRUM_MULTI";

function assertConfigured(): void {
  if (!ALGOLIA_APP_ID || !ALGOLIA_SEARCH_API_KEY) {
    throw new Error(
      "searchProxy: ALGOLIA_APP_ID / ALGOLIA_SEARCH_API_KEY must be set server-side — " +
        "this proxy exists specifically so the browser never holds them.",
    );
  }
}

/** Generic error response — never relay the real upstream body (it can echo
 *  request headers, and Algolia error payloads have in the past included
 *  enough of the request to be worth not trusting blindly). */
function sendProxyError(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: message }));
}

/**
 * POST {base}/agent-studio/1/agents/:agentId/completions
 *
 * Streams the Agent Studio SSE response back to the client as it arrives —
 * this is the live chat answer, buffering it would reintroduce the streaming
 * latency the product depends on. Mirrors the exact path shape
 * vendor/.../chat-central/src/shared/agentStudio.ts:getAgentStudioUrl builds,
 * so the widget's VITE_AGENT_PROXY_URL override needs no other client change.
 */
export async function handleAgentStudioProxy(
  req: IncomingMessage,
  res: ServerResponse,
  agentId: string,
): Promise<void> {
  try {
    assertConfigured();
  } catch (err) {
    sendProxyError(res, 500, (err as Error).message);
    return;
  }

  if (!ALLOWED_AGENT_IDS.has(agentId)) {
    sendProxyError(res, 403, `agentId not allowed: ${agentId}`);
    return;
  }

  let body = "";
  for await (const chunk of req) body += chunk;

  const url = new URL(req.url ?? "", "http://internal");
  const compatibilityMode = url.searchParams.get("compatibilityMode") ?? "ai-sdk-5";

  let upstream: Response;
  try {
    upstream = await fetch(
      `https://${ALGOLIA_APP_ID}.algolia.net/agent-studio/1/agents/${agentId}/completions?compatibilityMode=${compatibilityMode}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Algolia-Application-Id": ALGOLIA_APP_ID,
          "X-Algolia-API-Key": ALGOLIA_SEARCH_API_KEY,
        },
        body,
      },
    );
  } catch {
    sendProxyError(res, 502, "search proxy: upstream request failed");
    return;
  }

  if (!upstream.ok || !upstream.body) {
    // Log server-side for diagnosis; never forward upstream's body to the client.
    console.error(`[searchProxy] Agent Studio upstream error ${upstream.status} for agent ${agentId}`);
    sendProxyError(res, upstream.status || 502, "search proxy error");
    return;
  }

  res.writeHead(upstream.status, {
    "Content-Type": upstream.headers.get("content-type") ?? "text/event-stream",
  });
  Readable.fromWeb(upstream.body as import("stream/web").ReadableStream<Uint8Array>).pipe(res);
}

/**
 * POST {base}/1/indexes/*<slash>/queries  (literal path — Algolia's multi-query
 * endpoint puts the index name in the body, not the URL; see
 * vendor/.../algolia-chat/node_modules/algoliasearch/dist/lite/builds/browser.js,
 * `requestPath = "/1/indexes/*<slash>/queries"`).
 *
 * This is the InstantSearch lifecycle ping (hitsPerPage:0, no real results
 * consumed) — buffered is fine, it's not on any latency-sensitive path.
 */
export async function handleInstantSearchProxy(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    assertConfigured();
  } catch (err) {
    sendProxyError(res, 500, (err as Error).message);
    return;
  }

  let raw = "";
  for await (const chunk of req) raw += chunk;

  let parsed: { requests?: Array<{ indexName?: string }> };
  try {
    parsed = JSON.parse(raw || "{}");
  } catch {
    sendProxyError(res, 400, "search proxy: invalid JSON body");
    return;
  }

  const requests = parsed.requests ?? [];
  const disallowed = requests.find((r) => r.indexName !== ALLOWED_INDEX_NAME);
  if (disallowed) {
    sendProxyError(res, 403, `indexName not allowed: ${disallowed.indexName ?? "(missing)"}`);
    return;
  }

  let upstream: Response;
  try {
    upstream = await fetch(`https://${ALGOLIA_APP_ID}-dsn.algolia.net/1/indexes/*/queries`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Algolia-Application-Id": ALGOLIA_APP_ID,
        "X-Algolia-API-Key": ALGOLIA_SEARCH_API_KEY,
      },
      body: raw,
    });
  } catch {
    sendProxyError(res, 502, "search proxy: upstream request failed");
    return;
  }

  if (!upstream.ok) {
    console.error(`[searchProxy] InstantSearch upstream error ${upstream.status}`);
    sendProxyError(res, upstream.status, "search proxy error");
    return;
  }

  const json = await upstream.text();
  res.writeHead(upstream.status, { "Content-Type": "application/json" });
  res.end(json);
}

export const __testing = { ALLOWED_AGENT_IDS, ALLOWED_INDEX_NAME };

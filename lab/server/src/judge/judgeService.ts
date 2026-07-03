/**
 * judgeService — a focused, standalone HTTP service exposing ONLY the judge.
 *
 * PORTED (adapted doc comment only — logic verbatim) from AC2
 * lab/server/src/judge/judgeService.ts. AC2 frames this as sharing a handler
 * with a full lab webserver; ACS has no full webserver in this port (the eval
 * pipeline — agentRunner/brain/orchestrate/multiAgent/panels/answer.ts/etc. —
 * was explicitly excluded), so this IS the judge for the ACS chat UI: any
 * downstream app or agent POSTs an answer (+ its sources) and gets back the
 * 4-dimension verdict.
 *
 * ── Contract ────────────────────────────────────────────────────────────────
 * POST /api/judge
 *   Request (application/json):
 *     {
 *       "question": "the user question the answers respond to",   // required
 *       "panels": [                                               // required, non-empty
 *         {
 *           "panelId": "P1",                  // stable id echoed back on the verdict
 *           "label": "optional human label",
 *           "answer": "the answer text to score",
 *           "sources": [                      // the sources the answer was allowed to use
 *             { "id": "S1", "title": "...", "url": "...", "text": "body for grounding" }
 *           ],
 *           "generatedFollowUp": "optional generated follow-up question to score"
 *         }
 *       ],
 *       "followUp": "optional 2nd turn (enables the engagement dimension)",
 *       "isRefusalTest": false,               // true when a clean refusal is correct
 *       "rounds": 1                           // optional; live default is 1 (indicative)
 *     }
 *
 *   Response — one JSON blob (default), or SSE when Accept: text/event-stream:
 *     {
 *       "rounds": 1,
 *       "panels": [
 *         {
 *           "panelId": "P1",
 *           "dims": { "grounding": n, "coverage": n, "depth": n, "relevance": n }, // each 1–10
 *           "dimensions": [ { "id","label","score" } ],
 *           "synthesizedScore": n, "composite": n,    // the Confidence composite (0–10)
 *           "preGateScore": n,
 *           "gateTripped": bool,                       // grounding hard-gate
 *           "borderline": bool,
 *           "flaggedClaims": [ { "claim","reason","certainty" } ],  // certainty 0–1
 *           "perJudge": [ { "role","score","note" } ],
 *           "followUpQuality": n?,                      // only when generatedFollowUp present
 *           "rationale": "...",
 *           "error": "..."?                             // set if THIS panel failed (others ok)
 *         }
 *       ],
 *       "deltas": { "multiLift": n }?                  // P4 − P3 when both such panels judged
 *     }
 *   SSE events: `phase` (once) → `panel` (one per panel as it resolves) → `result`
 *     (the full blob, last) → `error` (only on mid-stream failure).
 *
 * GET /health → { ok: true }
 *
 * AUTH/RATE-LIMIT: opt-in. LAB_API_KEY (unset = open), RATE_LIMIT (<=0 =
 * disabled). Binds $PORT (default 8788, matching AC2's judge-only port so the
 * two can run side-by-side without a collision). The verdict is INDICATIVE
 * (fast model, 1 round).
 *
 * DEPLOYMENT: an always-on Node process (the judge is 30–90s and needs a
 * server-side LLM key — not a fit for Vercel serverless). The provider + key
 * are resolved from ACS's root .env.local by the shared adapters
 * (activeJudgeLlm/provider). Default provider is GEMINI (GOOGLE_API_KEY);
 * set JUDGE_PROVIDER=openai to use OPENAI_API_KEY instead.
 */
import { createServer } from "node:http";
import { handleJudge } from "./judgeHandler.js";
import { API_KEY_HEADER, isAuthorized, clientIp, RateLimiter } from "../auth.js";

// Default 8788 (one above a hypothetical full lab server's 8787) so both can run locally.
const PORT = Number(process.env.PORT ?? 8788);

// Both protections opt-in (see auth.ts): LAB_API_KEY unset ⇒ OPEN; RATE_LIMIT<=0 ⇒ off.
const LAB_API_KEY = process.env.LAB_API_KEY;
const RATE_LIMIT = Number(process.env.RATE_LIMIT ?? 30);
const RATE_WINDOW_MS = Number(process.env.RATE_WINDOW_MS ?? 60_000);
const limiter = new RateLimiter(RATE_LIMIT, RATE_WINDOW_MS);

const server = createServer(async (req, res) => {
  // Permissive CORS — search-only data, local dev tool.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", `Content-Type, ${API_KEY_HEADER}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Gate the cost-bearing route (judge spends LLM tokens = money): rate-limit then
  // shared key. /health stays open for uptime checks. No-op until LAB_API_KEY is set.
  if (req.method === "POST" && (req.url ?? "").startsWith("/api/")) {
    const ip = clientIp(req.headers, req.socket.remoteAddress ?? undefined);
    if (!limiter.check(ip)) {
      res.writeHead(429, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "rate limit exceeded — slow down" }));
      return;
    }
    if (!isAuthorized(req.headers[API_KEY_HEADER], LAB_API_KEY)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
  }

  if (req.method === "POST" && (req.url ?? "").startsWith("/api/judge")) {
    let body = "";
    for await (const chunk of req) body += chunk;
    const wantsStream = (req.headers.accept ?? "").includes("text/event-stream");
    await handleJudge(body, wantsStream, res);
    return;
  }

  if (req.method === "GET" && (req.url ?? "") === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  res.writeHead(404);
  res.end("not found");
});

server.listen(PORT, () => {
  console.log(`[judge-service-acs] listening on :${PORT}  (POST /api/judge · GET /health)`);
  console.log(
    `[judge-service-acs] auth ${LAB_API_KEY ? "ENABLED (x-lab-key required)" : "OPEN (no LAB_API_KEY set)"} · rate-limit ${
      RATE_LIMIT > 0 ? `${RATE_LIMIT}/${RATE_WINDOW_MS}ms per IP` : "disabled"
    }`,
  );
});

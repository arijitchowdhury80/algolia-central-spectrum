/**
 * judgeService — a focused, standalone HTTP service exposing ONLY the judge.
 *
 * PORTED (adapted doc comment only — logic verbatim) from AC2
 * lab/server/src/judge/judgeService.ts. AC2 frames this as sharing a handler
 * with a full lab webserver; ACS has no full webserver in this port (the eval
 * pipeline — agentRunner/brain/orchestrate/multiAgent/panels/answer.ts/etc. —
 * was explicitly excluded), so this IS the judge for the ACS chat UI: any
 * downstream app or agent POSTs an answer (+ its sources) and gets back the
 * single-dimension (Usefulness) + corroboration-gate verdict (Phase 2 rebuild).
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
 *           "dims": { "usefulness": n },              // the ONE scored dim, 1–10 (Phase 2 rebuild)
 *           "dimensions": [ { "id","label","score" } ],
 *           "synthesizedScore": n, "composite": n,    // the Confidence composite (0–10)
 *           "preGateScore": n,
 *           "gateTripped": bool,                       // corroboration gate (>= 2 distinct judges)
 *           "borderline": bool,                        // solo flag exists, but didn't cap
 *           "corroboratedClusters": [ { "representativeClaim","judgeIds","maxCertainty","violations" } ],
 *           "soloFlags": [ { "representativeClaim","judgeIds","maxCertainty","violations" } ],
 *           "flaggedClaims": [ { "claim","reason","certainty","judgeIds","sourceId?","excerpt?","excerptVerified?" } ],
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
 * GET /health → { ok: true, sha, builtAt } — sha/builtAt are baked into the
 *   Docker image at build time (GIT_SHA/BUILT_AT env, see buildInfo.ts +
 *   deploy/vps-judge/Dockerfile); "unknown" outside a built image (local dev).
 *   This is the one-curl check for deployment skew.
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
import { handleGround } from "./groundHandler.js";
import {
  API_KEY_HEADER,
  API_KEY_HEADER_ALT,
  isAuthorized,
  clientIp,
  RateLimiter,
} from "../auth.js";
import { healthPayload } from "../buildInfo.js";

// Default 8788 (one above a hypothetical full lab server's 8787) so both can run locally.
const PORT = Number(process.env.PORT ?? 8788);

// Both protections opt-in (see auth.ts): LAB_API_KEY unset ⇒ OPEN; RATE_LIMIT<=0 ⇒ off.
const LAB_API_KEY = process.env.LAB_API_KEY;
const RATE_LIMIT = Number(process.env.RATE_LIMIT ?? 30);
const RATE_WINDOW_MS = Number(process.env.RATE_WINDOW_MS ?? 60_000);
const limiter = new RateLimiter(RATE_LIMIT, RATE_WINDOW_MS);

/**
 * `/api/ground` gets its OWN, far higher limit.
 *
 * The 30/min limit exists to stop someone looping the endpoint and running up
 * an LLM bill. `/api/ground` spends nothing — it is a string search, measured at
 * 4-18ms — so metering it against a spend budget protects nothing and costs
 * something real: the client treats a 429 as "no fast route available" and
 * silently falls back to waiting ~30s for the LLM panel.
 *
 * That is not hypothetical. Measured on 2026-07-29: the 31st call in a minute
 * returned 429, and the badge sat on "scoring…" for the full panel duration
 * with no error shown anywhere. A user asking a handful of questions in quick
 * succession would have hit it.
 *
 * Still limited, because it is CPU over a megabyte of source text and should not
 * be a free denial-of-service. Override with GROUND_RATE_LIMIT.
 */
const GROUND_RATE_LIMIT = Number(process.env.GROUND_RATE_LIMIT ?? 600);
const groundLimiter = new RateLimiter(GROUND_RATE_LIMIT, RATE_WINDOW_MS);

const server = createServer(async (req, res) => {
  // Permissive CORS — search-only data, local dev tool.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  // Both accepted key headers must be allow-listed here, or the browser blocks
  // the preflight before the request ever reaches the auth check above.
  res.setHeader(
    "Access-Control-Allow-Headers",
    `Content-Type, ${API_KEY_HEADER}, ${API_KEY_HEADER_ALT}`,
  );

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Gate the cost-bearing route (judge spends LLM tokens = money): rate-limit then
  // shared key. /health stays open for uptime checks. No-op until LAB_API_KEY is set.
  if (req.method === "POST" && (req.url ?? "").startsWith("/api/")) {
    const ip = clientIp(req.headers, req.socket.remoteAddress ?? undefined);
    // Meter each route against what it actually costs: LLM spend for /api/judge,
    // CPU only for /api/ground.
    const isGround = (req.url ?? "").startsWith("/api/ground");
    const activeLimiter = isGround ? groundLimiter : limiter;
    if (!activeLimiter.check(ip)) {
      res.writeHead(429, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "rate limit exceeded — slow down" }));
      return;
    }
    if (
      !isAuthorized(req.headers[API_KEY_HEADER], LAB_API_KEY, req.headers[API_KEY_HEADER_ALT])
    ) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
  }

  // Fast path FIRST: /api/ground spends no tokens and answers in single-digit
  // milliseconds, so it must not be shadowed by the /api/judge branch below.
  if (req.method === "POST" && (req.url ?? "").startsWith("/api/ground")) {
    let body = "";
    for await (const chunk of req) body += chunk;
    handleGround(body, res);
    return;
  }

  if (req.method === "POST" && (req.url ?? "").startsWith("/api/judge")) {
    // Timed separately from parsing: this is the client UPLOADING the body,
    // which on a real panel is over a megabyte of source text. Server-side
    // stage timings that start after the body has arrived cannot see it, and
    // that blind spot is part of why the browser saw times the server did not.
    const readStartedAt = Date.now();
    let body = "";
    for await (const chunk of req) body += chunk;
    const readMs = Date.now() - readStartedAt;
    const wantsStream = (req.headers.accept ?? "").includes("text/event-stream");
    await handleJudge(body, wantsStream, res, undefined, readMs);
    return;
  }

  if (req.method === "GET" && (req.url ?? "") === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(healthPayload()));
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

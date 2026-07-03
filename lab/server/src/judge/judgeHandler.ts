/**
 * judgeHandler — the SHARED `POST /api/judge` request logic. In AC2 this is
 * shared between the full lab webserver and the judge-only service; in ACS
 * there is no full webserver (that pipeline was explicitly excluded from this
 * port — see lab/server's deliverable notes), so this is consumed only by
 * judgeService.ts (HTTP) and judgeCli.ts (stdin/stdout).
 *
 * PORTED VERBATIM from AC2 lab/server/src/judge/judgeHandler.ts (imports only
 * ../activeJudgeLlm.js and ./liveJudge.js — both ported alongside this file).
 *
 *   POST /api/judge  { question, panels:[{panelId,answer,sources,generatedFollowUp?}],
 *                      followUp?, isRefusalTest?, rounds? }
 *     -> LiveJudgeResult { rounds, panels:[LiveJudgeVerdict], deltas? }
 *
 * Two response modes (the client chooses via the Accept header):
 *   - Accept: text/event-stream -> SSE:
 *       event: phase   data: { phase:"judging", panels, provider, model, rounds }
 *       event: panel   data: <LiveJudgeVerdict>     (one per panel, as it resolves)
 *       event: result  data: <LiveJudgeResult>      (the full result, last)
 *       event: error   data: { error }              (only on mid-stream failure)
 *   - otherwise -> one JSON blob: <LiveJudgeResult> (back-compat).
 *
 * Each LiveJudgeVerdict carries the 4-dimension Confidence breakdown
 * (grounding / coverage / depth / relevance, each 1-10), the composite
 * (`synthesizedScore` / `composite`), the grounding gate (`gateTripped`), and
 * the flagged claims with per-claim `certainty`. The on-screen verdict is
 * INDICATIVE (fast model, 1 round).
 *
 * The handler is transport-thin: it owns parse -> validate -> resolve
 * provider -> judge -> respond, but takes the already-read request body
 * string and the raw node res, so callers wire CORS/auth/rate-limit
 * themselves.
 */
import type { ServerResponse } from "node:http";
import { makeActiveJudgeLlm } from "../activeJudgeLlm.js";
import {
  judgeLive,
  makeLlmScorer,
  makeFollowUpScorer,
  DEFAULT_LIVE_ROUNDS,
  type LiveJudgeRequest,
} from "./liveJudge.js";

/**
 * Run the judge for one already-read request body and write the response.
 *
 * @param body      The raw POST body (JSON string of a LiveJudgeRequest).
 * @param wantsStream  True to emit SSE; false for a single JSON blob.
 * @param res       The node response to write to (headers not yet sent).
 * @param log       Optional logger (defaults to console.log); pass () => {} to silence.
 */
export async function handleJudge(
  body: string,
  wantsStream: boolean,
  res: ServerResponse,
  log: (msg: string) => void = console.log,
): Promise<void> {
  try {
    const judgeReq = JSON.parse(body || "{}") as LiveJudgeRequest;
    if (!judgeReq.question || !judgeReq.question.trim()) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "question is required" }));
      return;
    }
    if (!Array.isArray(judgeReq.panels) || judgeReq.panels.length === 0) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "panels is required and must be non-empty" }));
      return;
    }
    // fastLive: the on-screen verdict is indicative -> use the fast model.
    const { llm, provider, model } = await makeActiveJudgeLlm({ fastLive: true });
    const followUpScorer = makeFollowUpScorer(llm);
    const rounds = judgeReq.rounds ?? DEFAULT_LIVE_ROUNDS;
    log(
      `[judge-api] judging ${judgeReq.panels.length} panel(s) on ${provider}/${model}, rounds=${rounds}, stream=${wantsStream}`,
    );
    const judgeT0 = Date.now();
    const logDone = () =>
      log(`[judge-api] done in ${((Date.now() - judgeT0) / 1000).toFixed(1)}s`);

    if (wantsStream) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      const send = (event: string, data: unknown) =>
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      send("phase", { phase: "judging", panels: judgeReq.panels.length, provider, model, rounds });
      const out = await judgeLive(judgeReq, makeLlmScorer(llm), {
        onPanel: (verdict) => send("panel", verdict),
        followUpScorer,
      });
      send("result", out);
      res.end();
      logDone();
      return;
    }

    const out = await judgeLive(judgeReq, makeLlmScorer(llm), { followUpScorer });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(out));
    logDone();
  } catch (e) {
    if (wantsStream && res.headersSent) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: (e as Error).message })}\n\n`);
      res.end();
    } else {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: (e as Error).message }));
    }
  }
}

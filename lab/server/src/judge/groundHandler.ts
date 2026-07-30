/**
 * groundHandler — the FAST path: the grounding verdict, with no LLM at all.
 *
 * WHY THIS ENDPOINT EXISTS (traced, 2026-07-28)
 * --------------------------------------------
 * A full /api/judge request was traced stage by stage on a real ACS panel:
 *
 *   llm:judge:skeptic     18,581ms   prompt 150,565 chars
 *   llm:judge:referee     31,614ms   prompt 150,369 chars
 *   llm:judge:advocate    19,423ms   prompt 150,486 chars
 *   verifyExcerpts             0ms
 *   detGround                  8ms   <-- decides what the chip says
 *   llm:synthesizer        1,667ms
 *   total                 33,321ms
 *
 * The chip shows `Grounded` / `N unverified claims`, and that verdict comes from
 * `detGround` — 8 milliseconds, deterministic, no model. The three LLM judges
 * produce the composite and the advisory findings, neither of which the chip
 * asserts. So the user was waiting 33 seconds for output that is not what they
 * were being shown.
 *
 * This endpoint returns just that verdict. Same function, same inputs, same
 * result as the one inside /api/judge — `deterministicGrounding` is pure, so
 * there is no risk of the fast path and the full path disagreeing.
 *
 * Cost: zero. No tokens are spent here.
 */
import type { ServerResponse } from "node:http";
import { deterministicGrounding, markSince, resetTrace } from "@lab/judge";
import { buildLiveArtifact, type LiveJudgeRequest } from "./liveJudge.js";

/** One panel's grounding verdict — a strict subset of the /api/judge shape, so a
 *  client can render it with the same code that renders the full verdict. */
export interface GroundPanelResult {
  panelId: string;
  grounded: boolean;
  termsChecked: number;
  unsupportedTerms: { term: string; kind?: string }[];
  groundingMode: "deterministic";
}

export interface GroundResult {
  panels: GroundPanelResult[];
}

/** Pure: compute the grounding verdict for every panel in a request. */
export function groundPanels(req: LiveJudgeRequest): GroundResult {
  return {
    panels: req.panels.map((panel) => {
      const artifact = buildLiveArtifact(req, panel);
      const det = deterministicGrounding(artifact.content, artifact.sources);
      return {
        panelId: panel.panelId,
        grounded: det.grounded,
        termsChecked: det.checked,
        unsupportedTerms: [...det.unsupported],
        groundingMode: "deterministic" as const,
      };
    }),
  };
}

/**
 * Handle POST /api/ground. Validates like /api/judge so a client gets the same
 * errors for the same mistakes, then answers from pure computation.
 */
export function handleGround(
  body: string,
  res: ServerResponse,
  log: (msg: string) => void = console.log,
): void {
  try {
    resetTrace();
    const startedAt = Date.now();
    const req = JSON.parse(body || "{}") as LiveJudgeRequest;

    if (!req.question || !req.question.trim()) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "question is required" }));
      return;
    }
    if (!Array.isArray(req.panels) || req.panels.length === 0) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "panels is required and must be non-empty" }));
      return;
    }

    const out = groundPanels(req);
    markSince("ground:total", startedAt, { panels: out.panels.length });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(out));
    log(
      `[ground-api] ${out.panels.length} panel(s) in ${Date.now() - startedAt}ms (no LLM)`,
    );
  } catch (e) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: (e as Error).message }));
  }
}

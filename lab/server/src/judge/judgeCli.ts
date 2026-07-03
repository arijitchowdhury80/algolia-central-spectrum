/**
 * judgeCli — run the "Confidence" judge from the command line.
 *
 * PORTED VERBATIM from AC2 lab/server/src/judge/judgeCli.ts (imports only
 * ../activeJudgeLlm.js and ./liveJudge.js — both ported alongside this file).
 * An agent or a human pipes one request JSON in and gets the 4-dimension
 * verdict JSON back on stdout. Same core, provider, and request/response
 * shapes as the HTTP service — just a process instead of a socket.
 *
 *   Input (a LiveJudgeRequest) — from stdin OR --file <path>:
 *     { "question": "...",
 *       "panels": [ { "panelId":"P1", "answer":"...",
 *                     "sources":[ { "id":"S1","title":"...","text":"..." } ],
 *                     "generatedFollowUp":"..."? } ],
 *       "followUp"?: "...", "isRefusalTest"?: false, "rounds"?: 1 }
 *
 *   Output (a LiveJudgeResult) — pretty JSON on stdout:
 *     { "rounds", "panels":[ { panelId, dims{grounding,coverage,depth,relevance},
 *       synthesizedScore, composite, gateTripped, flaggedClaims[{claim,reason,certainty}],
 *       perJudge, followUpQuality?, rationale } ], "deltas"? }
 *
 * Exit code 0 on success, non-zero on any error (bad JSON, missing fields, LLM
 * failure). Progress + errors go to stderr so stdout stays parseable JSON.
 *
 * The provider LLM (Gemini/OpenAI) + key are resolved from ACS's root
 * .env.local by the shared adapters (activeJudgeLlm → provider → config).
 * REQUIREMENT: a working GOOGLE_API_KEY (or OPENAI_API_KEY, with
 * JUDGE_PROVIDER=openai) must be present in .env.local.
 *
 *   Usage:
 *     cat request.json | npm run judge:cli
 *     npm run judge:cli -- --file path/to/request.json
 */
import { readFileSync } from "node:fs";
import { makeActiveJudgeLlm } from "../activeJudgeLlm.js";
import {
  judgeLive,
  makeLlmScorer,
  makeFollowUpScorer,
  DEFAULT_LIVE_ROUNDS,
  type LiveJudgeRequest,
} from "./liveJudge.js";

/** Read the request JSON from --file <path> or stdin. */
async function readRequest(argv: string[]): Promise<string> {
  const fileFlag = argv.indexOf("--file");
  if (fileFlag !== -1) {
    const path = argv[fileFlag + 1];
    if (!path) throw new Error("--file requires a path argument");
    return readFileSync(path, "utf8");
  }
  // stdin
  let body = "";
  for await (const chunk of process.stdin) body += chunk;
  return body;
}

async function main(): Promise<void> {
  const raw = await readRequest(process.argv.slice(2));
  if (!raw.trim()) {
    throw new Error("no request JSON on stdin (or pass --file <path>)");
  }

  let req: LiveJudgeRequest;
  try {
    req = JSON.parse(raw) as LiveJudgeRequest;
  } catch (e) {
    throw new Error(`request is not valid JSON: ${(e as Error).message}`);
  }
  if (!req.question || !req.question.trim()) {
    throw new Error("question is required");
  }
  if (!Array.isArray(req.panels) || req.panels.length === 0) {
    throw new Error("panels is required and must be non-empty");
  }

  // fastLive: the CLI verdict is indicative (matches the live HTTP service).
  const { llm, provider, model } = await makeActiveJudgeLlm({ fastLive: true });
  const followUpScorer = makeFollowUpScorer(llm);
  const rounds = req.rounds ?? DEFAULT_LIVE_ROUNDS;
  process.stderr.write(
    `[judge-cli] judging ${req.panels.length} panel(s) on ${provider}/${model}, rounds=${rounds}\n`,
  );

  const t0 = Date.now();
  const out = await judgeLive(req, makeLlmScorer(llm), { followUpScorer });
  process.stderr.write(`[judge-cli] done in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

  process.stdout.write(JSON.stringify(out, null, 2) + "\n");
}

main().catch((e) => {
  process.stderr.write(`[judge-cli] error: ${(e as Error).message}\n`);
  process.exit(1);
});

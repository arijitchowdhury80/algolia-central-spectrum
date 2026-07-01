# ACS eval harness (ported @lab/judge)

Scores the ACS agents (Generic / Technical) with AC2's provider-agnostic judge
(blind Skeptic/Referee/Advocate panel + grounding hard-gate).

```bash
npm install
npx tsx src/runner.ts                    # both agents, all questions
npx tsx src/runner.ts ACS-technical-neural
```
Reads `../../.env.local` (`ALGOLIA_APP_ID`, `ALGOLIA_ADMIN_API_KEY`, `GOOGLE_API_KEY`).

## STATUS: harness PORTED + RUNS; scores NOT yet meaningful (two open issues)

- ✅ **Ported + runs end-to-end** (askAgent → judge panel: Skeptic/Referee/Advocate → grounding
  gate → synthesis → summary). Two full runs, exit 0, no crashes. The runner now captures the
  retrieved **body** from the agent's tool frames and feeds it to the judge (capped 1200 ch/source).
- ⚠️ **Scores are uniformly ~1/10 and NOT trustworthy — a scoring/parse-mapping bug, not the agents.**
  Evidence it's a wiring bug, not the corpus/agents: (a) answers are visibly correct + grounded;
  (b) BAIT-1, a question the agent CORRECTLY refuses, scores 0.00 (a clean refusal should score HIGH);
  (c) feeding real bodies vs. titles barely moved the mean (1.15 → 1.04) — so it's NOT the source text.
  Most likely the judges' parsed dimension scores aren't mapping onto `weightedScore` as expected
  (parse fallback to min, or a field-name mismatch between the gemini-flash judge output and
  `parseJudgeOutput`). **NEXT: a dedicated debug pass** — dump `judgments[].dimensions[].score` +
  the raw judge output for one artifact (probe must live INSIDE lab/eval as ESM; use an ABSOLUTE
  env path) and confirm parse vs. genuine-low.
- ⚠️ **P2b calibration gates trust regardless** (standing gate from AC2). Even once the scoring bug
  is fixed, every number is INDICATIVE until the judge is calibrated (Spearman ≥ 0.7 vs human ranks).

## Files
- `src/runner.ts` — the eval loop. `src/questions.json` — Spectrum question set (+1 refusal bait).
- `src/{gemini,openai,agentRunner,streamParser,panels}.ts` — ported providers/runner (from AC2 lab/server).
- `../judge/` — the ported `@lab/judge` package (unchanged from AC2).

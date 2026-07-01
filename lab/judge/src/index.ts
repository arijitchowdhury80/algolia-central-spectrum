/**
 * @lab/judge — provider-agnostic AI Judge.
 *
 * Blind multi-perspective scoring (Skeptic / Referee / Advocate) on a weighted
 * rubric, reconciled by a Chief Synthesizer, with a grounding hard-gate.
 *
 * The only seam to the outside world is an injected `LlmComplete` function. No
 * vendor SDK is imported anywhere in this package.
 */
export * from "./types.js";
export {
  ALGOLIA_ANSWER_RUBRIC,
  DEFAULT_JUDGES,
  DEFAULT_GATE,
  DEFAULT_SYNTHESIS,
  DEFAULT_JUDGE_CONFIG,
  applicableDimensions,
} from "./rubric.js";
export {
  BLINDING_INSTRUCTION,
  CITATION_IS_NOT_EVIDENCE,
  JUDGE_OUTPUT_CONTRACT,
  buildJudgePrompt,
  buildSynthesisPrompt,
  renderExpectedCoverage,
} from "./prompt.js";
export { extractJsonObject, parseJudgeOutput } from "./parse.js";
export { weightedAggregate, toFinalScale } from "./aggregate.js";
export {
  verifiedGatingViolations,
  evaluateHardGate,
  applyGate,
} from "./gate.js";
export {
  consensusScore,
  stdDev,
  synthesize,
  multiRoundStats,
  aggregateRounds,
  DEFAULT_GATE_VOTE_THRESHOLD,
  DEFAULT_GATE_CLEAN_THRESHOLD,
} from "./synthesis.js";
export { judgeArtifact, judgeArtifactMultiRound } from "./judge.js";
export {
  claimSimilarity,
  clusterRoundViolations,
  evaluateClaimGate,
  DEFAULT_CLAIM_GATE,
} from "./claimGate.js";
export { spearman, averageRanks, runCalibration } from "./calibration.js";
export type {
  CalibrationItem,
  CalibrationPerItem,
  CalibrationResult,
  CalibrationDiagnostics,
} from "./calibration.js";
export type {
  ClaimCluster,
  ClaimGateConfig,
  ClaimGateOutcome,
  ClusterOptions,
} from "./claimGate.js";

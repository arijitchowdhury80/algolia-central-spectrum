/**
 * @confidence-engine — provider-agnostic AI Judge (vendored).
 *
 * Blind multi-perspective scoring (Skeptic / Referee / Advocate) on a weighted
 * rubric, reconciled by a Chief Synthesizer, with a grounding hard-gate.
 *
 * The only seam to the outside world is an injected `LlmComplete` function.
 *
 * Public surface — only the symbols consumed by this repo's judge wrappers are
 * re-exported here. All other engine functions remain accessible within the
 * engine package but are not part of the external API.
 */
export { DEFAULT_JUDGE_CONFIG } from './rubric.js';
export { aggregateRounds, DEFAULT_GATE_VOTE_THRESHOLD } from './synthesis.js';
export { judgeArtifact } from './judge.js';
export type { Artifact, Judgment, LlmComplete, Temperament } from './types.js';

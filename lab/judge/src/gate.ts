import type {
  GateOutcome,
  GroundingViolation,
  HardGateConfig,
  Judgment,
} from "./types.js";

/**
 * Collects the grounding violations that count as VERIFIED for gating purposes:
 * raised by a gating temperament (default: the Skeptic) AND at or above the
 * required confidence threshold.
 *
 * Pure.
 */
export function verifiedGatingViolations(
  judgments: readonly Judgment[],
  gate: HardGateConfig,
): GroundingViolation[] {
  const gating = new Set(gate.gatingTemperaments);
  const out: GroundingViolation[] = [];
  for (const j of judgments) {
    if (!gating.has(j.temperament)) continue;
    for (const v of j.groundingViolations) {
      // Only CONTRADICTED/fabricated claims cap the score. "unverifiable" claims
      // (not found in thin/partial sources) lower the grounding dimension but must
      // NOT trip the hard gate — else thin live sources slam everything to the cap.
      if (v.kind === "unverifiable") continue;
      if (v.certainty >= gate.verifiedConfidence) out.push(v);
    }
  }
  return out;
}

/**
 * The HARD GATE. If grounding gating is enabled and a verified violation exists,
 * the final score is capped at `gate.cap` regardless of prose quality.
 *
 * `preGateScore` is the consensus score (0-10) before gating. The returned
 * outcome reports whether the gate tripped and which violations triggered it;
 * applying the cap is done by the synthesizer using this outcome.
 *
 * Pure: no I/O, deterministic.
 */
export function evaluateHardGate(
  judgments: readonly Judgment[],
  gate: HardGateConfig,
): GateOutcome {
  if (!gate.groundingGateEnabled) {
    return {
      tripped: false,
      cap: gate.cap,
      triggeringViolations: [],
      explanation: "Grounding hard-gate disabled.",
    };
  }

  const triggering = verifiedGatingViolations(judgments, gate);
  if (triggering.length === 0) {
    return {
      tripped: false,
      cap: gate.cap,
      triggeringViolations: [],
      explanation: "No verified grounding violation from a gating judge.",
    };
  }

  return {
    tripped: true,
    cap: gate.cap,
    triggeringViolations: triggering,
    explanation:
      `Grounding hard-gate TRIPPED: ${triggering.length} verified unsupported ` +
      `claim(s) flagged by a gating judge (>= ${gate.verifiedConfidence} confidence). ` +
      `Final score capped at ${gate.cap}/10 regardless of prose quality.`,
  };
}

/**
 * Applies a gate outcome to a pre-gate score: returns the lower of the score and
 * the cap when tripped, otherwise the score unchanged. Pure.
 */
export function applyGate(preGateScore: number, gate: GateOutcome): number {
  if (!gate.tripped) return preGateScore;
  return Math.min(preGateScore, gate.cap);
}

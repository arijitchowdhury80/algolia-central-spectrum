import { claimSimilarity } from "./claimGate.js";
import type { DeterministicGrounding } from "./detGround.js";
import type {
  CorroboratedCluster,
  GateOutcome,
  GroundingViolation,
  HardGateConfig,
  Judgment,
} from "./types.js";

/**
 * Phase 2 corroboration gate. Replaces the Phase 1 single-temperament gate
 * (evaluateHardGate): the real bug was a SOLO Skeptic flag capping a
 * high-quality answer (9/9/9 → 3.10). The fix corroborates across the THREE
 * DISTINCT JUDGES — a claim must be independently flagged by
 * `gate.corroborationThreshold` (2 of 3) judges to cap the score. A lone flag
 * is surfaced as a "borderline" note and changes no number.
 */

/** One judge's flag, tagged with which judge raised it (for corroboration counting). */
interface TaggedFlag {
  readonly judgeId: string;
  readonly v: GroundingViolation;
}

/**
 * Gate-eligibility of a single violation (spec §3.2, amended 2026-07-28). A
 * violation is gate-eligible iff ALL of:
 *   1. kind === "contradicted", OR kind === "unverifiable" when
 *      `gate.gateOnUnverifiable` is set (see the field docs — this was
 *      unconditionally excluded while the harness truncated sources to 3,500
 *      chars and made supported claims look unverifiable; that defect is fixed).
 *   2. certainty >= the bar for its kind (`unverifiableConfidence` for absence,
 *      which is held higher because absence is weaker evidence than
 *      contradiction; `verifiedConfidence` otherwise).
 *   3. Excerpt integrity: excerpt === "" (pure fabrication, nothing to quote)
 *      OR excerptVerified === true. A non-empty excerpt that FAILS
 *      verification is demoted — not gate-eligible.
 * Corroboration across judges is applied by the caller, not here.
 * Pure.
 */
export function gateEligibleFlags(
  judgments: readonly Judgment[],
  gate: HardGateConfig,
): TaggedFlag[] {
  const out: TaggedFlag[] = [];
  for (const j of judgments) {
    for (const v of j.groundingViolations) {
      if (v.kind === "unverifiable") {
        if (!gate.gateOnUnverifiable) continue;
        const bar = gate.unverifiableConfidence ?? gate.verifiedConfidence;
        if (v.certainty < bar) continue;
      } else if (v.certainty < gate.verifiedConfidence) {
        continue;
      }
      const excerpt = v.excerpt ?? "";
      if (excerpt !== "" && v.excerptVerified !== true) continue; // demoted
      out.push({ judgeId: j.judgeId, v });
    }
  }
  return out;
}

interface MutableClusterAcc {
  representativeClaim: string;
  judgeIds: Set<string>;
  maxCertainty: number;
  violations: GroundingViolation[];
}

/**
 * Clusters gate-eligible flags across ALL judges by claimSimilarity >=
 * gate.claimSimThreshold; counts DISTINCT judgeIds per cluster. Flags are
 * iterated in [skeptic, referee, advocate] judge order for determinism (falls
 * back to encounter order for any other judgeIds); each flag attaches to the
 * most-similar existing cluster >= threshold, else seeds a new one. Multiple
 * near-duplicate flags from the SAME judge count that judge once. Pure.
 */
function clusterGateEligibleFlags(
  flags: readonly TaggedFlag[],
  gate: HardGateConfig,
): CorroboratedCluster[] {
  const JUDGE_ORDER = ["skeptic", "referee", "advocate"];
  const ordered = [...flags].sort((a, b) => {
    const ia = JUDGE_ORDER.indexOf(a.judgeId);
    const ib = JUDGE_ORDER.indexOf(b.judgeId);
    return (ia === -1 ? JUDGE_ORDER.length : ia) - (ib === -1 ? JUDGE_ORDER.length : ib);
  });

  const clusters: MutableClusterAcc[] = [];
  for (const { judgeId, v } of ordered) {
    let best: MutableClusterAcc | undefined;
    let bestSim = gate.claimSimThreshold;
    for (const c of clusters) {
      const sim = claimSimilarity(v.claim, c.representativeClaim);
      if (sim >= bestSim) {
        bestSim = sim;
        best = c;
      }
    }
    if (best) {
      best.judgeIds.add(judgeId);
      best.maxCertainty = Math.max(best.maxCertainty, v.certainty);
      best.violations.push(v);
    } else {
      clusters.push({
        representativeClaim: v.claim,
        judgeIds: new Set([judgeId]),
        maxCertainty: v.certainty,
        violations: [v],
      });
    }
  }

  return clusters.map((c) => ({
    representativeClaim: c.representativeClaim,
    judgeIds: [...c.judgeIds],
    maxCertainty: c.maxCertainty,
    violations: c.violations,
  }));
}

/**
 * The grounding gate.
 *
 * TWO MODES (`gate.groundingMode`, decided 2026-07-28):
 *
 * - "deterministic" (served): `det`'s verbatim search decides. It is a pure
 *   function of (answer, sources), so the same answer scores the same every
 *   time. The LLM panel still runs and its corroborated clusters are returned
 *   in `advisoryClusters` — displayed, never scored. `corroboratedClusters` is
 *   left EMPTY in this mode precisely because that field means "this is what
 *   capped the score", and here nothing LLM-derived did.
 *
 * - "llm" (legacy): the Phase 2 cross-judge corroboration gate. A claim must
 *   be independently flagged by >= gate.corroborationThreshold DISTINCT judges
 *   to cap; a lone flag lands in `soloFlags` and never caps.
 *
 * When mode is "deterministic" but `det` is absent, this falls back to the LLM
 * path and says so in `mode` — the fallback is reported, not silent.
 *
 * Pure: no I/O, no LLM, no randomness.
 */
export function evaluateCorroborationGate(
  judgments: readonly Judgment[],
  gate: HardGateConfig,
  det?: DeterministicGrounding,
): GateOutcome {
  if (!gate.groundingGateEnabled) {
    return {
      tripped: false,
      mode: "llm",
      cap: gate.cap,
      triggeringViolations: [],
      corroboratedClusters: [],
      soloFlags: [],
      borderline: false,
      explanation: "Grounding hard-gate disabled.",
      ...(det ? { deterministic: det } : {}),
    };
  }

  const flags = gateEligibleFlags(judgments, gate);
  const clusters = clusterGateEligibleFlags(flags, gate);

  const llmCorroborated = clusters.filter(
    (c) => c.judgeIds.length >= gate.corroborationThreshold,
  );
  const soloFlags = clusters.filter((c) => c.judgeIds.length === 1);

  const mode: "deterministic" | "llm" =
    gate.groundingMode === "deterministic" && det ? "deterministic" : "llm";

  if (mode === "deterministic") {
    // det is non-undefined here by the guard above.
    const d = det as DeterministicGrounding;
    const tripped = !d.grounded;
    // Advisory LLM evidence exists but did not decide anything.
    const advisory = [...llmCorroborated, ...soloFlags];

    /**
     * NEVER borderline on the deterministic path.
     *
     * `borderline` was built for the LLM gate below, where a SOLO flag really
     * does mean "one more judge agreeing and this would have been capped" —
     * genuinely near the threshold. The deterministic verdict has no threshold
     * to be near: every verbatim-required term is either located in a source or
     * it is not.
     *
     * When the deterministic gate took over, this flag was left pointing at
     * advisory flags, which by definition cannot change the verdict. The result
     * was reported from the live drawer: a fully grounded answer
     * scoring 9.3/10, with judges at 8.9 / 8.9 / 10.0, labelled BORDERLINE —
     * because one judge had muttered about a phrase and we had already decided
     * to ignore it. The label contradicted every number next to it.
     *
     * The advisory flags are still surfaced (`advisoryClusters` / `soloFlags`,
     * rendered as "flagged claims"), which is the honest place for them: shown,
     * attributable, and explicitly not scored.
     */
    const borderline = false;
    const terms = d.unsupported.map((u) => u.term).join(", ");
    const explanation = tripped
      ? `Grounding gate TRIPPED (deterministic): ${d.unsupported.length} of ${d.checked} ` +
        `verbatim-required term(s) appear in no source — ${terms}. Capped at ${gate.cap}/10.`
      : `Grounded (deterministic): all ${d.checked} verbatim-required term(s) located in the ` +
        `sources.` +
        (advisory.length > 0
          ? ` ${advisory.length} advisory LLM flag(s) recorded — shown, not scored.`
          : "");
    return {
      tripped,
      mode,
      cap: gate.cap,
      triggeringViolations: [],
      corroboratedClusters: [], // nothing LLM-derived capped — see advisoryClusters.
      soloFlags,
      advisoryClusters: llmCorroborated,
      deterministic: d,
      borderline,
      explanation,
    };
  }

  const tripped = llmCorroborated.length > 0;
  const borderline = !tripped && soloFlags.length > 0;

  const explanation = tripped
    ? `Grounding hard-gate TRIPPED: ${llmCorroborated.length} claim(s) independently ` +
      `flagged by >= ${gate.corroborationThreshold} distinct judges (>= ${gate.verifiedConfidence} ` +
      `confidence). Final score capped at ${gate.cap}/10 regardless of prose quality.`
    : borderline
      ? `No corroborated grounding violation, but ${soloFlags.length} solo flag(s) from a single ` +
        `judge — shown as borderline, NOT capped.`
      : "No verified grounding violation corroborated by 2+ distinct judges.";

  return {
    tripped,
    mode,
    cap: gate.cap,
    triggeringViolations: [], // Phase 1 field, unused on the new path — see corroboratedClusters.
    corroboratedClusters: llmCorroborated,
    soloFlags,
    advisoryClusters: [],
    borderline,
    explanation,
    ...(det ? { deterministic: det } : {}),
  };
}

/**
 * Applies a gate outcome to a pre-gate score: returns the lower of the score
 * and the cap when tripped, otherwise the score unchanged. Pure. UNCHANGED
 * from Phase 1.
 */
export function applyGate(preGateScore: number, gate: GateOutcome): number {
  if (!gate.tripped) return preGateScore;
  return Math.min(preGateScore, gate.cap);
}

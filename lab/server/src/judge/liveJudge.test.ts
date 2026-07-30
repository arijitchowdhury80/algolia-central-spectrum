/**
 * Tests for liveJudge — the single-question, judge-the-displayed-answers path
 * behind POST /api/judge. Pure mappers are tested directly; the orchestrator is
 * tested with an injected fake scorer (no network).
 *
 * PORTED VERBATIM from AC2 lab/server/src/judge/liveJudge.test.ts (self-
 * contained: only imports @lab/judge types + the sibling liveJudge.ts, no
 * eval-pipeline / network dependency).
 */
import { describe, it, expect } from "vitest";
import type {
  CorroboratedCluster,
  DeterministicGrounding,
  MultiRoundResult,
  JudgePanelResult,
  Judgment,
  Temperament,
} from "@lab/judge";
import {
  buildLiveArtifact,
  toVerdict,
  judgeLive,
  computeDeltas,
  type LiveJudgeRequest,
  type LiveJudgeVerdict,
} from "./liveJudge.js";

// --- fixtures --------------------------------------------------------------

function judgment(temperament: Temperament, weighted: number, summary: string): Judgment {
  return {
    judgeId: temperament,
    temperament,
    dimensionScores: [{ dimensionId: "groundedness", score: weighted, rationale: "r" }],
    groundingViolations: [],
    summary,
    weightedScore: weighted,
  };
}

function panelRound(round: number, weighted: Record<Temperament, number>): JudgePanelResult {
  return {
    artifactType: "algolia-answer",
    round,
    judgments: [
      judgment("skeptic", weighted.skeptic, `skeptic r${round}`),
      judgment("referee", weighted.referee, `referee r${round}`),
      judgment("advocate", weighted.advocate, `advocate r${round}`),
    ],
    synthesis: {
      finalScore: 0,
      preGateScore: 0,
      gate: { tripped: false, cap: 3, triggeringViolations: [], explanation: "" },
      panelSpread: 0,
      rationale: round === 0 ? "synth narrative" : "",
    },
  };
}

/** Build a gate-cluster fixture (types.ts `CorroboratedCluster`). */
function cluster(opts: {
  claim: string;
  judgeIds: string[];
  certainty: number;
  reason?: string;
  sourceId?: string;
  excerpt?: string;
  excerptVerified?: boolean;
}): CorroboratedCluster {
  return {
    representativeClaim: opts.claim,
    judgeIds: opts.judgeIds,
    maxCertainty: opts.certainty,
    violations: opts.judgeIds.map(() => ({
      claim: opts.claim,
      reason: opts.reason ?? "no source says this",
      certainty: opts.certainty,
      kind: "contradicted" as const,
      ...(opts.sourceId !== undefined ? { sourceId: opts.sourceId } : {}),
      ...(opts.excerpt !== undefined ? { excerpt: opts.excerpt } : {}),
      ...(opts.excerptVerified !== undefined ? { excerptVerified: opts.excerptVerified } : {}),
    })),
  };
}

function multiRound(opts?: {
  finalScore?: number;
  meanPreGate?: number;
  gateTripped?: boolean;
  borderline?: boolean;
  corroboratedClusters?: CorroboratedCluster[];
  soloFlags?: CorroboratedCluster[];
  advisoryClusters?: CorroboratedCluster[];
  deterministic?: DeterministicGrounding;
  gateMode?: "deterministic" | "llm";
}): MultiRoundResult {
  return {
    artifactType: "algolia-answer",
    perRound: [
      panelRound(0, { skeptic: 6, referee: 8, advocate: 9 }),
      panelRound(1, { skeptic: 7, referee: 8, advocate: 9 }),
    ],
    stats: {
      rounds: 2,
      finalScores: [6, 7],
      meanFinalScore: 6.5,
      stdDevFinalScore: 0.5,
      range: 1,
      anyGateTripped: opts?.gateTripped ?? false,
    },
    aggregate: {
      rounds: 2,
      perRoundPreGate: [6, 7],
      meanPreGateScore: opts?.meanPreGate ?? 6.4,
      stdDevPreGateScore: 0.2,
      gateTripFraction: opts?.gateTripped ? 1 : 0,
      gateTripped: opts?.gateTripped ?? false,
      borderline: opts?.borderline ?? false,
      finalScore: opts?.finalScore ?? 5.9,
      dimensionMeans: { usefulness: 6.5 },
      corroboratedClusters: opts?.corroboratedClusters ?? [],
      soloFlags: opts?.soloFlags ?? [],
      advisoryClusters: opts?.advisoryClusters ?? [],
      ...(opts?.deterministic ? { deterministic: opts.deterministic } : {}),
      ...(opts?.gateMode ? { gateMode: opts.gateMode } : {}),
      judgeComposites: [
        { judgeId: "skeptic", temperament: "skeptic", composite: 6.5 },
        { judgeId: "referee", temperament: "referee", composite: 8 },
        { judgeId: "advocate", temperament: "advocate", composite: 9 },
      ],
    },
  };
}

const baseReq: LiveJudgeRequest = {
  question: "What are Algolia's ranking criteria?",
  panels: [
    {
      panelId: "P1",
      label: "P1 · Single · Keyword",
      answer: "Algolia ranks by tie-breaking criteria…",
      sources: [{ id: "S1", title: "Ranking", url: "https://x", text: "ranking body" }],
    },
  ],
};

// --- buildLiveArtifact ------------------------------------------------------

describe("buildLiveArtifact", () => {
  it("maps a single-turn panel to a blind artifact with engagement N/A", () => {
    const a = buildLiveArtifact(baseReq, baseReq.panels[0]);
    expect(a.type).toBe("algolia-answer");
    expect(a.prompt).toBe(baseReq.question);
    expect(a.content).toBe(baseReq.panels[0].answer);
    expect(a.notApplicableDimensions).toContain("engagement");
    expect(a.expectedBehavior).toBeUndefined();
    expect(a.sources[0]).toMatchObject({ id: "S1", text: "ranking body" });
  });

  it("honors the refusal flag and combines a follow-up into the prompt", () => {
    const req: LiveJudgeRequest = {
      ...baseReq,
      followUp: "and personalization?",
      isRefusalTest: true,
    };
    const a = buildLiveArtifact(req, req.panels[0]);
    expect(a.expectedBehavior).toBe("refuse");
    expect(a.prompt).toContain(req.question);
    expect(a.prompt).toContain("and personalization?");
    expect(a.notApplicableDimensions ?? []).not.toContain("engagement");
  });

  it("falls back to title when a source has no text body", () => {
    const req: LiveJudgeRequest = {
      ...baseReq,
      panels: [{ ...baseReq.panels[0], sources: [{ id: "S1", title: "OnlyTitle", url: "u" }] }],
    };
    const a = buildLiveArtifact(req, req.panels[0]);
    expect(a.sources[0].text).toBe("OnlyTitle");
  });
});

// --- toVerdict --------------------------------------------------------------

describe("toVerdict", () => {
  it("produces one entry per temperament with round-averaged composite + round-0 note", () => {
    const v = toVerdict("P1", multiRound());
    expect(v.panelId).toBe("P1");
    expect(v.judges.map((j) => j.role).sort()).toEqual(["advocate", "referee", "skeptic"]);
    const skeptic = v.judges.find((j) => j.role === "skeptic")!;
    expect(skeptic.score).toBeCloseTo(6.5); // aggregate.judgeComposites skeptic
    expect(skeptic.note).toBe("skeptic r0");
  });

  it("surfaces the single usefulness dimension (Phase 2 rebuild: 4 dims collapsed to 1)", () => {
    const v = toVerdict("P1", multiRound());
    expect(v.dimensions.map((d) => d.id)).toEqual(["usefulness"]);
    expect(v.dimensions[0]).toMatchObject({ id: "usefulness", label: "Usefulness", score: 6.5 });
    expect(v.dims).toEqual({ usefulness: 6.5 });
  });

  it("surfaces corroborated (capping) and solo (borderline) claim clusters from ANY judge, not just the Skeptic", () => {
    const mr = multiRound({
      gateTripped: true,
      corroboratedClusters: [
        cluster({
          claim: "Algolia guarantees 99.999% uptime",
          judgeIds: ["skeptic", "referee"],
          certainty: 0.9,
          sourceId: "S1",
          excerpt: "no SLA is stated",
          excerptVerified: true,
        }),
      ],
      soloFlags: [
        cluster({ claim: "typo tolerance is free on all plans", judgeIds: ["advocate"], certainty: 0.6 }),
      ],
    });
    const v = toVerdict("P1", mr);
    expect(v.violations).toHaveLength(2);
    expect(v.violations[0].claim).toContain("99.999% uptime"); // higher certainty first
    expect(v.violations[0].judgeIds).toEqual(["skeptic", "referee"]); // corroborated by 2 distinct judges
    expect(v.violations[0].excerpt).toBe("no SLA is stated");
    expect(v.violations[0].excerptVerified).toBe(true);
    expect(v.violations[1].judgeIds).toEqual(["advocate"]); // solo — visible but non-capping
    expect(v.corroboratedClusters).toHaveLength(1);
    expect(v.soloFlags).toHaveLength(1);
  });

  it("carries synthesized/pre-gate scores, gate state and narrative", () => {
    const v = toVerdict("P1", multiRound({ finalScore: 3, meanPreGate: 6.4, gateTripped: true }));
    expect(v.synthesizedScore).toBe(3);
    expect(v.preGateScore).toBeCloseTo(6.4);
    expect(v.gateTripped).toBe(true);
    expect(v.rationale).toBe("synth narrative");
  });
});

// --- judgeLive --------------------------------------------------------------

describe("judgeLive", () => {
  it("judges every requested panel and echoes the round count", async () => {
    const req: LiveJudgeRequest = {
      question: "q",
      rounds: 2,
      panels: [
        { panelId: "P1", answer: "a1", sources: [] },
        { panelId: "P2", answer: "a2", sources: [] },
      ],
    };
    const seen: string[] = [];
    const res = await judgeLive(req, async (artifact, rounds) => {
      seen.push(artifact.content);
      expect(rounds).toBe(2);
      return multiRound();
    });
    expect(res.rounds).toBe(2);
    expect(res.panels.map((p) => p.panelId)).toEqual(["P1", "P2"]);
    expect(seen).toEqual(["a1", "a2"]);
  });

  it("isolates a per-panel failure into an error without crashing others", async () => {
    const req: LiveJudgeRequest = {
      question: "q",
      panels: [
        { panelId: "P1", answer: "boom", sources: [] },
        { panelId: "P2", answer: "ok", sources: [] },
      ],
    };
    const res = await judgeLive(req, async (artifact) => {
      if (artifact.content === "boom") throw new Error("judge exploded");
      return multiRound();
    });
    const p1 = res.panels.find((p) => p.panelId === "P1")!;
    const p2 = res.panels.find((p) => p.panelId === "P2")!;
    expect(p1.error).toContain("judge exploded");
    expect(p2.error).toBeUndefined();
    expect(p2.judges).toHaveLength(3);
  });
});

// --- followUpQuality (the MULTI-TURN signal) --------------------------------

describe("judgeLive — followUpQuality", () => {
  it("scores followUpQuality ONLY when a generated follow-up is present", async () => {
    const req: LiveJudgeRequest = {
      question: "How does typo tolerance work?",
      panels: [
        { panelId: "P1", answer: "a1", sources: [], generatedFollowUp: "Want to tune the threshold?" },
        { panelId: "P2", answer: "a2", sources: [] }, // no follow-up
      ],
    };
    const seen: string[] = [];
    const res = await judgeLive(req, async () => multiRound(), {
      followUpScorer: async (_q, _a, followUp) => {
        seen.push(followUp);
        return 8;
      },
    });
    const p1 = res.panels.find((p) => p.panelId === "P1")!;
    const p2 = res.panels.find((p) => p.panelId === "P2")!;
    expect(p1.followUpQuality).toBe(8);
    expect(p2.followUpQuality).toBeUndefined(); // no follow-up → not scored
    expect(seen).toEqual(["Want to tune the threshold?"]); // scorer fired once
  });

  it("does not score followUpQuality when no scorer is injected (back-compat)", async () => {
    const req: LiveJudgeRequest = {
      question: "q",
      panels: [{ panelId: "P1", answer: "a", sources: [], generatedFollowUp: "next?" }],
    };
    const res = await judgeLive(req, async () => multiRound());
    expect(res.panels[0].followUpQuality).toBeUndefined();
  });

  it("does NOT fold followUpQuality into the composite", async () => {
    const req: LiveJudgeRequest = {
      question: "q",
      panels: [{ panelId: "P1", answer: "a", sources: [], generatedFollowUp: "next?" }],
    };
    const res = await judgeLive(req, async () => multiRound({ finalScore: 5.9 }), {
      followUpScorer: async () => 10,
    });
    expect(res.panels[0].composite).toBeCloseTo(5.9); // composite unchanged by follow-up
    expect(res.panels[0].followUpQuality).toBe(10);
  });
});

// --- cross-panel deltas -----------------------------------------------------

describe("computeDeltas", () => {
  function v(panelId: string, composite: number, error?: string): LiveJudgeVerdict {
    return {
      panelId,
      judges: [],
      perJudge: [],
      dimensions: [],
      dims: { usefulness: 0 },
      violations: [],
      flaggedClaims: [],
      corroboratedClusters: [],
      soloFlags: [],
      synthesizedScore: composite,
      composite,
      preGateScore: composite,
      gateTripped: false,
      borderline: false,
      rationale: "",
      ...(error ? { error } : {}),
    };
  }

  it("computes multiLift across the neural panels", () => {
    const d = computeDeltas([v("P3", 7), v("P4", 8)]);
    expect(d.multiLift).toBeCloseTo(1); // P4−P3
  });

  it("omits multiLift when a neural panel is missing", () => {
    const d = computeDeltas([v("P3", 7)]);
    expect(d.multiLift).toBeUndefined();
  });

  it("ignores errored panels", () => {
    const d = computeDeltas([v("P3", 7), v("P4", 8, "boom")]);
    expect(d.multiLift).toBeUndefined();
  });
});

// --- judgeLive emits deltas when ≥2 panels judged ---------------------------

describe("judgeLive — deltas", () => {
  it("attaches multiLift delta to the result for both neural panels", async () => {
    const req: LiveJudgeRequest = {
      question: "q",
      panels: [
        { panelId: "P3", answer: "a", sources: [] },
        { panelId: "P4", answer: "b", sources: [] },
      ],
    };
    const res = await judgeLive(req, async () => multiRound({ finalScore: 6 }));
    expect(res.deltas).toBeDefined();
    expect(res.deltas?.multiLift).toBeCloseTo(0); // both 6 → lift 0
  });
});

/**
 * The deterministic grounding surface (2026-07-28). The chip reads `grounded` +
 * `unsupportedTerms`, so these fields carry the user-facing claim and are worth
 * pinning: a mapping slip here shows a prospect a green chip on a hallucination.
 */
describe("toVerdict — deterministic grounding fields", () => {
  it("carries the grounded verdict, unsupported terms, and mode through", () => {
    const v = toVerdict(
      "P1",
      multiRound({
        gateTripped: true,
        gateMode: "deterministic",
        deterministic: {
          checked: 12,
          unsupported: [{ term: "QuantumTypoEngine", kind: "component" }],
          grounded: false,
        },
      }),
    );
    expect(v.grounded).toBe(false);
    expect(v.termsChecked).toBe(12);
    expect(v.unsupportedTerms).toEqual([{ term: "QuantumTypoEngine", kind: "component" }]);
    expect(v.groundingMode).toBe("deterministic");
  });

  it("reports grounded with zero unsupported terms on a clean answer", () => {
    const v = toVerdict(
      "P1",
      multiRound({
        gateMode: "deterministic",
        deterministic: { checked: 9, unsupported: [], grounded: true },
      }),
    );
    expect(v.grounded).toBe(true);
    expect(v.unsupportedTerms).toEqual([]);
    expect(v.termsChecked).toBe(9);
  });

  it("surfaces advisory clusters in flaggedClaims — a 2-judge finding stays visible", () => {
    const advisory = cluster({
      claim: "Algolia ships a QuantumTypoEngine",
      judgeIds: ["skeptic", "referee"],
      certainty: 0.9,
    });
    const v = toVerdict(
      "P1",
      multiRound({
        gateMode: "deterministic",
        deterministic: { checked: 9, unsupported: [], grounded: true },
        advisoryClusters: [advisory],
        borderline: true,
      }),
    );
    // Did not cap...
    expect(v.gateTripped).toBe(false);
    expect(v.corroboratedClusters).toHaveLength(0);
    // ...but is fully visible to the drawer.
    expect(v.advisoryClusters).toHaveLength(1);
    expect(v.flaggedClaims.map((f) => f.claim)).toContain("Algolia ships a QuantumTypoEngine");
  });

  it("falls back honestly when no deterministic verdict was supplied", () => {
    const v = toVerdict("P1", multiRound({ gateTripped: true }));
    expect(v.groundingMode).toBe("llm");
    expect(v.termsChecked).toBe(0);
    expect(v.grounded).toBe(false); // mirrors the gate rather than assuming clean
  });
});

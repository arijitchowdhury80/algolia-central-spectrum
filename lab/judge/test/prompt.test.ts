import { describe, expect, it } from "vitest";
import {
  ALGOLIA_ANSWER_RUBRIC,
  BLINDING_INSTRUCTION,
  CITATION_IS_NOT_EVIDENCE,
  DEFAULT_JUDGES,
  buildJudgePrompt,
  buildSynthesisPrompt,
  extractJsonObject,
  parseJudgeOutput,
  renderExpectedCoverage,
} from "../src/index.js";
import type { Artifact } from "../src/index.js";
import { GROUNDED_ARTIFACT } from "./helpers.js";

describe("buildJudgePrompt", () => {
  const skeptic = DEFAULT_JUDGES.find((j) => j.id === "skeptic")!;
  const prompt = buildJudgePrompt(skeptic, GROUNDED_ARTIFACT, ALGOLIA_ANSWER_RUBRIC);

  it("includes the blinding instruction verbatim", () => {
    expect(prompt).toContain(BLINDING_INSTRUCTION);
  });

  it("includes the judge persona (temperament lens)", () => {
    expect(prompt).toContain(skeptic.persona);
  });

  it("includes the single usefulness dimension of the Phase 2 rubric", () => {
    expect(prompt).toContain("usefulness");
    expect(prompt).toContain("Usefulness");
    // the dropped 4-dimension model must not appear as scored dimensions
    expect(prompt).not.toContain('"grounding"');
    expect(prompt).not.toContain('"coverage"');
  });

  it("surfaces the single usefulness weight and the sources as ground truth", () => {
    expect(prompt).toContain('usefulness ("Usefulness", weight x1)');
    expect(prompt).not.toContain("weight x2");
    expect(prompt).toContain("[S1]");
    expect(prompt).toContain("grounding violation");
  });

  it("instructs the judge NOT to let grounding doubts change the Usefulness number", () => {
    expect(prompt).toContain("Score Usefulness on completeness and concrete specificity ONLY");
    expect(prompt).toContain("must NOT change the");
  });

  it("includes the JSON output contract", () => {
    expect(prompt).toContain('"dimensionScores"');
    expect(prompt).toContain('"groundingViolations"');
  });

  it("includes the traceable-excerpt instruction (sourceId + verbatim excerpt)", () => {
    expect(prompt).toContain("TRACEABLE EXCERPT");
    expect(prompt).toContain('"sourceId"');
    expect(prompt).toContain("VERBATIM");
  });

  it("instructs that a citation/URL/brand is NOT evidence — unsourced stats are violations", () => {
    // The retail-weak defect: a fabricated stat ('guaranteed 5.1x ROAS') wrapped
    // in plausible customer-story URLs passed the gate because the judge treated
    // a cited-looking claim as grounded. The prompt must tell the judge that only
    // the SOURCES are ground truth and an unsourced statistic is a violation even
    // with an attached URL or brand attribution.
    expect(prompt).toContain(CITATION_IS_NOT_EVIDENCE);
    expect(CITATION_IS_NOT_EVIDENCE.toLowerCase()).toContain("statistic");
    expect(CITATION_IS_NOT_EVIDENCE.toLowerCase()).toContain("url");
  });

  it("is deterministic (pure)", () => {
    const again = buildJudgePrompt(skeptic, GROUNDED_ARTIFACT, ALGOLIA_ANSWER_RUBRIC);
    expect(again).toBe(prompt);
  });
});

describe("renderExpectedCoverage", () => {
  it("returns empty when the artifact has no extracted entities", () => {
    expect(renderExpectedCoverage(GROUNDED_ARTIFACT)).toBe("");
  });

  it("renders the EXPECTED COVERAGE checklist from entities + signals", () => {
    const artifact: Artifact = {
      ...GROUNDED_ARTIFACT,
      extractedEntities: {
        intent: "discovery",
        industry: "retail",
        concepts: ["typo tolerance", "synonyms"],
        signals: { role: "engineer", stack: "Shopify" },
      },
    };
    const out = renderExpectedCoverage(artifact);
    expect(out).toContain("EXPECTED COVERAGE");
    expect(out).toContain("retail");
    expect(out).toContain("typo tolerance, synonyms");
    expect(out).toContain("signal:role: engineer");
    expect(out).toContain("signal:stack: Shopify");
  });

  it("skips empty/blank entity fields", () => {
    const artifact: Artifact = {
      ...GROUNDED_ARTIFACT,
      extractedEntities: { industry: "  ", concepts: [], signals: {} },
    };
    expect(renderExpectedCoverage(artifact)).toBe("");
  });
});

describe("buildJudgePrompt — Coverage checklist threading", () => {
  it("includes the EXPECTED COVERAGE block when entities are present", () => {
    const skeptic = DEFAULT_JUDGES.find((j) => j.id === "skeptic")!;
    const artifact: Artifact = {
      ...GROUNDED_ARTIFACT,
      extractedEntities: { industry: "retail", signals: { pain: "zero results" } },
    };
    const p = buildJudgePrompt(skeptic, artifact, ALGOLIA_ANSWER_RUBRIC);
    expect(p).toContain("EXPECTED COVERAGE");
    expect(p).toContain("retail");
    expect(p).toContain("signal:pain: zero results");
  });
});

describe("buildSynthesisPrompt", () => {
  it("lists each judge and notes when the gate tripped", () => {
    const p = buildSynthesisPrompt(
      GROUNDED_ARTIFACT,
      [
        { judgeId: "skeptic", weightedScore: 3, summary: "weak grounding", violations: 1 },
        { judgeId: "referee", weightedScore: 6, summary: "ok", violations: 0 },
      ],
      3,
      true,
    );
    expect(p).toContain("CHIEF SYNTHESIZER");
    expect(p).toContain("skeptic");
    expect(p).toContain("hard-gate was TRIPPED");
  });
});

describe("parseJudgeOutput", () => {
  it("extracts JSON even when wrapped in prose / code fences", () => {
    const raw =
      "Here is my assessment:\n```json\n" +
      JSON.stringify({
        dimensionScores: [{ dimensionId: "groundedness", score: 7, rationale: "ok" }],
        groundingViolations: [],
        summary: "fine",
      }) +
      "\n```\nThanks!";
    const obj = extractJsonObject(raw) as { summary: string };
    expect(obj.summary).toBe("fine");
  });

  it("clamps out-of-range scores and confidences", () => {
    const raw = JSON.stringify({
      dimensionScores: [
        { dimensionId: "groundedness", score: 99, rationale: "x" },
        { dimensionId: "clarity", score: -5, rationale: "y" },
      ],
      // legacy `confidence` key on input is still accepted (back-compat)
      groundingViolations: [{ claim: "c", reason: "r", confidence: 5 }],
      summary: "s",
    });
    const parsed = parseJudgeOutput(raw, ALGOLIA_ANSWER_RUBRIC);
    expect(parsed.dimensionScores[0].score).toBe(10); // clamped to max
    expect(parsed.dimensionScores[1].score).toBe(1); // clamped to min
    expect(parsed.groundingViolations[0].certainty).toBe(1); // clamped to 1, exposed as `certainty`
  });
});

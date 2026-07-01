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

  it("includes every dimension of the 4-dimension rubric", () => {
    expect(prompt).toContain("grounding");
    expect(prompt).toContain("coverage");
    expect(prompt).toContain("depth");
    expect(prompt).toContain("relevance");
    // the dropped legacy dimensions must not appear
    expect(prompt).not.toContain("engagement");
    expect(prompt).not.toContain("conciseness");
  });

  it("surfaces the equal grounding weight and the sources as ground truth", () => {
    // Grounding is equal-weight (x1) + hard floor, not up-weighted in the score.
    expect(prompt).toContain('grounding ("Grounding", weight x1)');
    expect(prompt).not.toContain("weight x2");
    expect(prompt).toContain("[S1]");
    expect(prompt).toContain("grounding violation");
  });

  it("includes the JSON output contract", () => {
    expect(prompt).toContain('"dimensionScores"');
    expect(prompt).toContain('"groundingViolations"');
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

import { describe, it, expect } from "vitest";
import { parseJudgeOutput } from "../src/parse.js";
import type { Rubric } from "../src/types.js";

const rubric: Rubric = {
  name: "test",
  min: 1,
  max: 10,
  dimensions: [
    { id: "groundedness", label: "Groundedness", description: "", weight: 2 },
    { id: "depth", label: "Depth / rigor", description: "", weight: 1 },
    { id: "clarity", label: "Clarity & logical layering", description: "", weight: 1 },
  ],
};

describe("parseJudgeOutput dimension-id resolution", () => {
  it("resolves a human LABEL emitted by a strong model back to the canonical id", () => {
    const raw = JSON.stringify({
      dimensionScores: [
        { dimensionId: "Depth / rigor", score: 8, rationale: "x" },
        { dimensionId: "Clarity & logical layering", score: 7, rationale: "y" },
      ],
    });
    const out = parseJudgeOutput(raw, rubric);
    const ids = out.dimensionScores.map((d) => d.dimensionId);
    expect(ids).toContain("depth");
    expect(ids).toContain("clarity");
    expect(ids).not.toContain("Depth / rigor");
  });

  it("passes a canonical id through unchanged", () => {
    const raw = JSON.stringify({
      dimensionScores: [{ dimensionId: "groundedness", score: 9, rationale: "" }],
    });
    const out = parseJudgeOutput(raw, rubric);
    expect(out.dimensionScores[0].dimensionId).toBe("groundedness");
  });

  it("leaves an unknown dimension key unchanged (no regression)", () => {
    const raw = JSON.stringify({
      dimensionScores: [{ dimensionId: "totally_unknown", score: 5, rationale: "" }],
    });
    const out = parseJudgeOutput(raw, rubric);
    expect(out.dimensionScores[0].dimensionId).toBe("totally_unknown");
  });

  it("still clamps scores to the rubric range", () => {
    const raw = JSON.stringify({
      dimensionScores: [{ dimensionId: "Groundedness", score: 99, rationale: "" }],
    });
    const out = parseJudgeOutput(raw, rubric);
    expect(out.dimensionScores[0].dimensionId).toBe("groundedness");
    expect(out.dimensionScores[0].score).toBe(10);
  });
});

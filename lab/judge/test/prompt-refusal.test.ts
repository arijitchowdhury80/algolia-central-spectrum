import { describe, it, expect } from "vitest";
import { buildJudgePrompt } from "../src/prompt.js";
import { DEFAULT_JUDGE_CONFIG } from "../src/rubric.js";
import type { Artifact } from "../src/types.js";

const judge = DEFAULT_JUDGE_CONFIG.judges[0];
const rubric = DEFAULT_JUDGE_CONFIG.rubric;

const base: Artifact = {
  type: "algolia-answer",
  prompt: "What is the capital of France?",
  content: "I don't have anything in Algolia's content that answers that.",
  sources: [],
};

describe("refusal-aware judge prompt", () => {
  it("injects the refusal directive when expectedBehavior is 'refuse'", () => {
    const p = buildJudgePrompt(judge, { ...base, expectedBehavior: "refuse" }, rubric);
    expect(p).toContain("REFUSAL TEST");
    expect(p).toMatch(/HIGH \(9-10\)/);
    expect(p).toContain("SERIOUS grounding violation");
  });

  it("omits the refusal directive for normal answer questions", () => {
    const p = buildJudgePrompt(judge, { ...base, expectedBehavior: "answer" }, rubric);
    expect(p).not.toContain("REFUSAL TEST");
  });

  it("always includes the grounding note (absence/routing are not violations)", () => {
    const p = buildJudgePrompt(judge, base, rubric);
    expect(p).toContain("GROUNDING NOTE");
    expect(p).toMatch(/routes? the user to official help/);
  });

  it("scopes the grounding note so it does NOT excuse empty/incomplete answers", () => {
    // The note must protect honest disclaimers from being mis-flagged as
    // fabrication, but must NOT inflate a non-answer: an empty/evasive/thin
    // response still has to score low on Depth (and weak Coverage).
    const p = buildJudgePrompt(judge, base, rubric);
    expect(p).toMatch(/does NOT excuse|must still score low/i);
    expect(p).toMatch(/score LOW on Depth/i);
  });
});

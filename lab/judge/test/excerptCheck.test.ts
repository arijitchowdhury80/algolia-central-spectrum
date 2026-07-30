import { describe, expect, it } from "vitest";
import { normalizeForExcerpt, verifyExcerpts } from "../src/excerptCheck.js";
import type { Judgment, Source } from "../src/index.js";
import { makeJudgment } from "./helpers.js";

const SOURCES: Source[] = [
  { id: "S1", text: "Algolia includes  typo\ntolerance   by default on all indices." },
  { id: "S2", text: "Typo tolerance can be configured per index via settings." },
];

function withViolation(overrides: Partial<Judgment["groundingViolations"][number]>): Judgment {
  const j = makeJudgment("skeptic", "skeptic", 8);
  return {
    ...j,
    groundingViolations: [
      {
        claim: "some claim",
        reason: "not in sources",
        certainty: 0.9,
        kind: "contradicted",
        sourceId: "",
        excerpt: "",
        ...overrides,
      },
    ],
  };
}

describe("normalizeForExcerpt", () => {
  it("lowercases and collapses whitespace runs to a single space, trims", () => {
    expect(normalizeForExcerpt("  Algolia  includes\n\ttypo tolerance  ")).toBe(
      "algolia includes typo tolerance",
    );
  });
});

describe("verifyExcerpts", () => {
  it("verbatim-present excerpt -> excerptVerified:true", () => {
    const [out] = verifyExcerpts(
      [withViolation({ sourceId: "S1", excerpt: "typo tolerance by default" })],
      SOURCES,
    );
    expect(out.groundingViolations[0].excerptVerified).toBe(true);
  });

  it("whitespace/case-only diff still verifies (normalized-whitespace matching)", () => {
    const [out] = verifyExcerpts(
      [withViolation({ sourceId: "S1", excerpt: "TYPO   Tolerance BY Default" })],
      SOURCES,
    );
    expect(out.groundingViolations[0].excerptVerified).toBe(true);
  });

  it("a paraphrase (not verbatim) fails verification", () => {
    const [out] = verifyExcerpts(
      [withViolation({ sourceId: "S1", excerpt: "typo tolerance is on by default everywhere" })],
      SOURCES,
    );
    expect(out.groundingViolations[0].excerptVerified).toBe(false);
  });

  it("an excerpt absent from the cited source fails verification", () => {
    const [out] = verifyExcerpts(
      [withViolation({ sourceId: "S2", excerpt: "typo tolerance by default" })], // S2 doesn't say this
      SOURCES,
    );
    expect(out.groundingViolations[0].excerptVerified).toBe(false);
  });

  it("empty excerpt -> excerptVerified:false (nothing to verify, but gate-eligible per §3.2 rule 3)", () => {
    const [out] = verifyExcerpts([withViolation({ sourceId: "", excerpt: "" })], SOURCES);
    expect(out.groundingViolations[0].excerptVerified).toBe(false);
  });

  it("unknown sourceId -> excerptVerified:false", () => {
    const [out] = verifyExcerpts(
      [withViolation({ sourceId: "S99", excerpt: "typo tolerance by default" })],
      SOURCES,
    );
    expect(out.groundingViolations[0].excerptVerified).toBe(false);
  });

  it("is pure — does not mutate the input judgments", () => {
    const input = [withViolation({ sourceId: "S1", excerpt: "typo tolerance by default" })];
    const before = JSON.stringify(input);
    verifyExcerpts(input, SOURCES);
    expect(JSON.stringify(input)).toBe(before);
  });
});

/**
 * REGRESSION (2026-07-28). The normalizer was lowercase + whitespace only, which
 * made the excerpt check fail on any quote touching a markdown code span. On a
 * developer-docs corpus that is most of them. Measured: all three judges caught
 * an injected fabricated prop at certainty 1.0, all three were demoted for a
 * failed excerpt check, and the answer scored 10.00/10 — because the source
 * wrote `allowsNonContiguousRanges` and the judge quoted it without backticks.
 */
describe("normalizeForExcerpt — markup blindness", () => {
  const sourceSentence =
    "Use `allowsNonContiguousRanges` to allow selecting ranges containing unavailable dates.";
  const judgeQuote =
    "Use allowsNonContiguousRanges to allow selecting ranges containing unavailable dates.";

  it("matches a plain quote against a markdown code span", () => {
    expect(normalizeForExcerpt(sourceSentence)).toContain(normalizeForExcerpt(judgeQuote));
  });

  it("decodes HTML entities left in crawled bodies", () => {
    expect(normalizeForExcerpt("&lt;Button variant=&quot;accent&quot;&gt;"))
      .toBe(normalizeForExcerpt('<Button variant="accent">'));
  });

  it("unifies curly quotes and dashes", () => {
    expect(normalizeForExcerpt("don’t use the “quiet” style — ever"))
      .toBe(normalizeForExcerpt(`don't use the "quiet" style - ever`));
  });

  it("still rejects an invented quote (anti-fabrication intent preserved)", () => {
    const invented = "Use `permitsDisjointIntervals` to allow selecting ranges.";
    expect(normalizeForExcerpt(sourceSentence)).not.toContain(normalizeForExcerpt(invented));
  });

  it("still rejects a quote with words reordered", () => {
    const reordered = "to allow selecting ranges Use allowsNonContiguousRanges";
    expect(normalizeForExcerpt(sourceSentence)).not.toContain(normalizeForExcerpt(reordered));
  });
});

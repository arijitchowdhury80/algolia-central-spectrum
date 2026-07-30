import { describe, it, expect } from "vitest";
import { groundPanels } from "./groundHandler.js";
import type { LiveJudgeRequest } from "./liveJudge.js";

/**
 * The property that matters here is AGREEMENT: the fast path must return the
 * same verdict the full /api/judge path returns, because both call the same pure
 * `deterministicGrounding` over the same artifact. If these two ever disagree,
 * the chip would change its mind seconds after rendering — which is worse than
 * waiting for it.
 */
function req(answer: string, sources: { id: string; text: string }[]): LiveJudgeRequest {
  return {
    question: "When should I use a ComboBox?",
    panels: [{ panelId: "main", answer, sources }],
  } as LiveJudgeRequest;
}

describe("groundPanels", () => {
  it("reports grounded when every checkable term is present in a source", () => {
    const out = groundPanels(
      req("Use `allowsCustomValue` to permit values outside the list.", [
        { id: "s1", text: "ComboBox supports allowsCustomValue for arbitrary input." },
      ]),
    );
    expect(out.panels[0]).toMatchObject({
      panelId: "main",
      grounded: true,
      groundingMode: "deterministic",
    });
    expect(out.panels[0].termsChecked).toBeGreaterThan(0);
    expect(out.panels[0].unsupportedTerms).toEqual([]);
  });

  it("names the terms that appear in no source", () => {
    const out = groundPanels(
      req("Use `allowsNonContiguousRanges` for that.", [
        { id: "s1", text: "ComboBox supports allowsCustomValue." },
      ]),
    );
    expect(out.panels[0].grounded).toBe(false);
    expect(out.panels[0].unsupportedTerms.map((t) => t.term)).toContain(
      "allowsNonContiguousRanges",
    );
  });

  it("is grounded with zero checked for a prose-only answer — NOT a failure", () => {
    // A refusal or a purely prose answer has nothing verbatim-checkable. Claiming
    // it ungrounded would invent a failure; claiming it verified would overstate.
    const out = groundPanels(
      req("It depends on how many options you expect users to browse.", [
        { id: "s1", text: "Guidance about choosing between components." },
      ]),
    );
    expect(out.panels[0]).toMatchObject({ grounded: true, termsChecked: 0 });
  });

  it("handles every panel in a multi-panel request", () => {
    const request = {
      question: "q",
      panels: [
        { panelId: "a", answer: "`isQuiet` works.", sources: [{ id: "s", text: "isQuiet" }] },
        { panelId: "b", answer: "`nopeNotReal` works.", sources: [{ id: "s", text: "isQuiet" }] },
      ],
    } as LiveJudgeRequest;
    const out = groundPanels(request);
    expect(out.panels.map((p) => [p.panelId, p.grounded])).toEqual([
      ["a", true],
      ["b", false],
    ]);
  });

  it("is deterministic — the same input twice gives an identical verdict", () => {
    // This is the entire reason the fast path is allowed to drive the chip. The
    // LLM panel measured {3.00, 8.89} on identical input; this must not vary.
    const build = () =>
      groundPanels(
        req("Set `menuTrigger` to control opening; see size-100.", [
          { id: "s1", text: "menuTrigger controls when the menu opens. Token size-100." },
        ]),
      );
    expect(JSON.stringify(build())).toBe(JSON.stringify(build()));
  });
});

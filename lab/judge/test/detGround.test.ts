import { describe, expect, it } from "vitest";
import {
  checkTerms,
  deterministicGrounding,
  extractHardTerms,
  normalizeForGrounding,
} from "../src/detGround.js";

/**
 * detGround — the reproducible half of the grounding verdict.
 *
 * Every false-positive case below is a MEASURED one from the 36-case
 * ground-truth run on 2026-07-28, not a hypothetical: each is a real writing
 * pattern that flagged a verified-clean answer before the fix. They are pinned
 * because precision is the whole value proposition here — a false "this answer
 * is ungrounded" in front of a prospect costs more than a missed injection.
 */

const src = (id: string, text: string) => ({ id, text });

describe("normalizeForGrounding", () => {
  it("is markup-blind: backticks, emphasis, entities, curly quotes", () => {
    expect(normalizeForGrounding("`allowsNonContiguousRanges`")).toBe(
      "allowsnoncontiguousranges",
    );
    expect(normalizeForGrounding("**bold** &amp; _em_")).toBe("bold & em");
    expect(normalizeForGrounding("the “size” — small")).toBe('the "size" - small');
  });

  it("collapses whitespace so line wrapping cannot break a match", () => {
    expect(normalizeForGrounding("aria\n   label")).toBe("aria label");
  });
});

describe("extractHardTerms", () => {
  it("takes backticked identifiers, CamelCase names, and scaled numbers", () => {
    const terms = extractHardTerms(
      "Use `isInvalid` on DisclosurePanel with a 1.125 ratio.",
    );
    const byTerm = new Map(terms.map((t) => [t.term, t.kind]));
    expect(byTerm.get("isInvalid")).toBe("identifier");
    expect(byTerm.get("DisclosurePanel")).toBe("component");
    expect(byTerm.get("1.125")).toBe("number");
  });

  it("ignores fenced code blocks — an example may invent its own variable names", () => {
    const terms = extractHardTerms(
      "Here is how:\n```tsx\nconst myLocalThing = <FakeWidget />\n```\n",
    );
    expect(terms.map((t) => t.term)).not.toContain("FakeWidget");
    expect(terms.map((t) => t.term)).not.toContain("myLocalThing");
  });

  it("skips bare small integers — list indices are not claims about the corpus", () => {
    const terms = extractHardTerms("There are 3 variants and 12 sizes.");
    expect(terms.map((t) => t.term)).toEqual([]);
  });

  it("does not treat a backticked lowercase string literal as an API name", () => {
    // MEASURED false positive: granularity's `"hour"` enum VALUE is legitimate
    // prose-level content, not an identifier that must appear verbatim.
    expect(extractHardTerms('Set granularity to `"hour"`.')).toEqual([]);
  });

  it("keeps identifier-shaped tokens out of a backticked snippet, drops prose words", () => {
    const terms = extractHardTerms("Call `setSelectedKeys with a key` to update.");
    expect(terms.map((t) => t.term)).toContain("setSelectedKeys");
    expect(terms.map((t) => t.term)).not.toContain("update");
  });

  it("drops a term mentioned only to deny it — F1, 2026-07-29 UX sweep", () => {
    // MEASURED: a bait question asked about a non-existent `dismissDelay`
    // prop; the correct refusal named the fabricated prop it was refuting and
    // was scored UNSUPPORTED for it. Naming a fabrication to refute it must
    // never itself count as a claim.
    expect(extractHardTerms("Picker doesn't ship a `dismissDelay` prop.").map((t) => t.term)).not
      .toContain("dismissDelay");
    expect(
      extractHardTerms("There is no `loadingState` on Picker — it doesn't exist.").map(
        (t) => t.term,
      ),
    ).not.toContain("loadingState");
    expect(extractHardTerms("`QuantumSlider` is not a real component.").map((t) => t.term)).not
      .toContain("QuantumSlider");
  });

  it("still checks a term that is asserted anywhere, even if also denied elsewhere", () => {
    const terms = extractHardTerms(
      "There's no `dismissDelay` on Tray, but ListView does have `dismissDelay`.",
    );
    expect(terms.map((t) => t.term)).toContain("dismissDelay");
  });

  it("still checks a plain positive claim — negation detection must not over-fire", () => {
    const terms = extractHardTerms("Pass `allowsNonContiguousRanges` to ListView.");
    expect(terms.map((t) => t.term)).toContain("allowsNonContiguousRanges");
  });
});

describe("checkTerms — surface variants that must count as grounded", () => {
  const sources = [
    src("S1", "The StatusLight component. An Accordion has an Item. Use size-100."),
  ];
  const find = (term: string) =>
    checkTerms([{ term, kind: "component", foundIn: [] }], sources)[0].foundIn;

  it("matches a plural against the singular the docs define", () => {
    expect(find("StatusLights")).toEqual(["S1"]);
  });

  it("matches dot notation against parts the docs name separately", () => {
    expect(find("Accordion.Item")).toEqual(["S1"]);
  });

  it("matches a placeholder suffix against the token stem", () => {
    expect(find("size-X")).toEqual(["S1"]);
  });

  it("still reports a genuinely absent name as unsupported", () => {
    expect(find("QuantumSlider")).toEqual([]);
  });
});

describe("deterministicGrounding", () => {
  const sources = [
    src("S1", "`ListView` requires an aria-label. The `onSelectionChange` prop fires."),
  ];

  it("catches a fabricated API name — the defect class this exists for", () => {
    const r = deterministicGrounding(
      "Pass `allowsNonContiguousRanges` to ListView.",
      sources,
    );
    expect(r.grounded).toBe(false);
    expect(r.unsupported.map((u) => u.term)).toContain("allowsNonContiguousRanges");
  });

  it("passes a clean answer whose identifiers all appear in the sources", () => {
    const r = deterministicGrounding(
      "`ListView` needs an aria-label and fires `onSelectionChange`.",
      sources,
    );
    expect(r.grounded).toBe(true);
    expect(r.unsupported).toEqual([]);
    expect(r.checked).toBeGreaterThan(0);
  });

  it("matches across markdown: a backticked source term quoted bare still grounds", () => {
    // The markdown-blindness defect in the old excerpt check, pinned here so it
    // cannot regress into the deterministic path.
    const r = deterministicGrounding("Use onSelectionChange to react.", sources);
    expect(r.grounded).toBe(true);
  });

  it("makes no claim about pure prose — no hard terms means grounded, checked 0", () => {
    const r = deterministicGrounding("I can't help with that. Try the design docs.", sources);
    expect(r).toEqual({ checked: 0, unsupported: [], grounded: true });
  });

  it("a correct refusal naming the fabricated term it refutes is grounded — F1", () => {
    const r = deterministicGrounding(
      "Picker doesn't ship a `dismissDelay` prop; the real prop is `onSelectionChange`.",
      sources,
    );
    expect(r.grounded).toBe(true);
    expect(r.unsupported).toEqual([]);
  });

  it("is reproducible: identical input gives an identical verdict", () => {
    const answer = "Pass `allowsNonContiguousRanges` to ListView at 1.125 scale.";
    const runs = Array.from({ length: 5 }, () => deterministicGrounding(answer, sources));
    for (const r of runs) expect(r).toEqual(runs[0]);
  });
});

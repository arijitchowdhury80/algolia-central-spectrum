import { applicableDimensions } from "./rubric.js";
import type { Artifact, JudgeProfile, Rubric } from "./types.js";

/**
 * The exact blinding instruction injected into every judge prompt. Kept as an
 * exported constant so tests can assert its presence verbatim and so the
 * methodology doc and prompt stay in sync.
 */
export const BLINDING_INSTRUCTION =
  "BLIND PANEL: You are one of several independent judges scoring this artifact. " +
  "You do NOT know which system or author produced it, and you must NOT speculate. " +
  "Judge ONLY the text in front of you against the rubric. Do not infer identity, " +
  "vendor, or pipeline from style, formatting, or self-references.";

function renderRubric(rubric: Rubric, dims: ReturnType<typeof applicableDimensions>): string {
  const lines = dims.map(
    (d) =>
      `- ${d.id} ("${d.label}", weight x${d.weight}): ${d.description} Score ${rubric.min}-${rubric.max}.`,
  );
  return `RUBRIC "${rubric.name}" — score each dimension on an integer ${rubric.min}-${rubric.max} scale:\n${lines.join("\n")}`;
}

function renderSources(artifact: Artifact): string {
  if (artifact.sources.length === 0) {
    return "SOURCES: (none provided — this artifact is not graded for external grounding).";
  }
  const body = artifact.sources
    .map((s) => `[${s.id}]${s.label ? ` ${s.label}` : ""}: ${s.text}`)
    .join("\n");
  return `SOURCES (the ground truth you can see — may be PARTIAL/thin):\n${body}`;
}

/**
 * A claim ABOUT the absence of content, or a routing pointer to official help,
 * is not a fabricated factual assertion. Stated on every prompt so judges don't
 * mis-flag honest "I don't have this" answers or help links as grounding
 * violations. CRITICALLY, this protection is scoped: it stops fabrication
 * false-positives, it does NOT turn a non-answer into a good answer. An empty,
 * evasive, or thin response must still lose points on completeness/depth/clarity
 * — otherwise a content-free stub inflates to a mid score.
 */
const GROUNDING_NOTE =
  "GROUNDING NOTE: An honest statement that no relevant content was found, that a " +
  "topic isn't covered, or that simply routes the user to official help (docs, " +
  "support, or a contact/demo link) is NOT a fabricated factual claim — never " +
  "count it as a grounding violation. This protects honest disclaimers ONLY; it " +
  "does NOT excuse a weak answer. An empty, evasive, or thin response must still " +
  "score LOW on Depth, and a needless deferral when the sources DO support an " +
  "answer is weak Coverage. Absence of fabrication is not the same as a good " +
  "answer — do not reward a non-answer.";

/**
 * Closes the "cited-looking ≠ grounded" hole: a fabricated stat wrapped in a
 * plausible URL or attributed to a named brand was passing the gate because the
 * judge read a confident, linked claim as supported. Only the SOURCES block is
 * ground truth — a URL, link, or brand name in the artifact is NOT evidence.
 * Quantified claims (percentages, dollar amounts, ROI/ROAS multiples, sweeping
 * guarantees) absent from the SOURCES are violations even when they carry a link.
 */
export const CITATION_IS_NOT_EVIDENCE =
  "CITATIONS ARE NOT EVIDENCE: Only the SOURCES block above is ground truth. A URL, link, " +
  "brand name, or confident tone in the ARTIFACT does NOT make a claim grounded, and an " +
  "attached link is not source support. Apply this to every specific statistic, percentage, " +
  "dollar amount, or ROI/ROAS multiple:\n" +
  "  • A SWEEPING quantified guarantee NOT tied to one named customer — e.g. a figure framed " +
  "as 'guaranteed', 'documented', 'certified', 'proven', or holding 'across every client' — " +
  "that is absent from the SOURCES is a FABRICATION: record it in groundingViolations with " +
  "kind 'contradicted' and certainty >= 0.8, even if it carries a URL. This is the canonical " +
  "fabrication an attached link tries to disguise.\n" +
  "  • A statistic ATTRIBUTED to a specific named customer (e.g. 'PUMA saw 15%') that is not " +
  "in the SOURCES is 'unverifiable' — lower the Grounding score for it, but do NOT mark it " +
  "'contradicted' (it is plausibly real, just not in these thin sources).\n" +
  "Do not penalize a generic routing link to docs/support/contact — only quantified or " +
  "named-result claims the SOURCES don't back.";

/** Authoritative block when the artifact is expected to refuse (out-of-scope prompt). */
const REFUSAL_DIRECTIVE =
  "OUT-OF-SCOPE / REFUSAL TEST (authoritative — overrides the rubric's default reading): " +
  "This prompt is OUTSIDE the knowledge base on purpose. The CORRECT artifact is a brief, " +
  "polite REFUSAL that declines and routes the user elsewhere — NOT a substantive answer.\n" +
  "- If the artifact correctly refuses/declines (optionally routing to docs/support), score it " +
  "HIGH (9-10) on EVERY dimension: that refusal IS the ideal response, and there are no claims to ground.\n" +
  "- If the artifact instead gives a substantive factual answer to this out-of-scope question, that is a " +
  "SERIOUS grounding violation: record it in groundingViolations with certainty >= 0.9 and score low.";

/**
 * The JSON shape every judge must return. Exported so the parser and the prompt
 * agree on the contract.
 */
export const JUDGE_OUTPUT_CONTRACT = `Respond with ONLY a JSON object, no prose around it, of this exact shape:
{
  "dimensionScores": [{ "dimensionId": string, "score": number, "rationale": string }],
  "groundingViolations": [{ "claim": string, "reason": string, "certainty": number, "kind": "contradicted" | "unverifiable" }],
  "summary": string
}
- Include one entry in "dimensionScores" for EVERY rubric dimension id listed above.
- "groundingViolations" lists factual claims you could not confirm against the SOURCES. Empty array if none. "certainty" is 0-1 — how sure you are the violation is real.
- "kind" is REQUIRED for every violation and is critical:
    • "contradicted" — the SOURCES say otherwise, OR the claim is clearly fabricated/invented (a real hallucination).
    • "unverifiable" — the claim is plausible and simply NOT present in the provided sources (which may be partial/thin). No evidence either way.
  Default to "unverifiable" when the only problem is "I can't find it here" — reserve "contradicted" for genuine conflicts or fabrications. Lower the grounding dimension score for unverifiable claims, but do NOT treat them as fabrication.`;

/**
 * Renders the EXPECTED COVERAGE checklist from the artifact's already-extracted
 * entities + discovery signals — the parts of the question the Coverage dimension
 * should reward an answer for addressing. Returns "" when no entities are present
 * (the Coverage judge then infers the parts from the prompt alone). Pure: same
 * artifact -> same string; no extraction of its own.
 */
export function renderExpectedCoverage(artifact: Artifact): string {
  const e = artifact.extractedEntities;
  if (!e) return "";

  const lines: string[] = [];
  const add = (label: string, value: string | undefined) => {
    const v = value?.trim();
    if (v) lines.push(`- ${label}: ${v}`);
  };

  add("intent", e.intent);
  add("brand", e.brand);
  add("industry", e.industry);
  add("product", e.product);
  if (e.concepts && e.concepts.length > 0) {
    const concepts = e.concepts.map((c) => c.trim()).filter((c) => c.length > 0);
    if (concepts.length > 0) lines.push(`- concepts: ${concepts.join(", ")}`);
  }
  if (e.signals) {
    for (const [key, value] of Object.entries(e.signals)) {
      add(`signal:${key}`, value);
    }
  }

  if (lines.length === 0) return "";
  return (
    "EXPECTED COVERAGE (the answer should address each — feed the Coverage dimension):\n" +
    lines.join("\n")
  );
}

/**
 * Builds the full prompt for a single blind judge. Pure: same inputs -> same
 * string. Guarantees the rubric, the blinding instruction, and the persona are
 * all present (asserted by tests).
 */
export function buildJudgePrompt(
  judge: JudgeProfile,
  artifact: Artifact,
  rubric: Rubric,
): string {
  const dims = applicableDimensions(rubric, artifact.notApplicableDimensions);
  const parts: string[] = [
    BLINDING_INSTRUCTION,
    "",
    `YOUR LENS: ${judge.persona}`,
    "",
    `ARTIFACT TYPE: ${artifact.type}`,
    artifact.prompt ? `QUESTION / BRIEF:\n${artifact.prompt}` : "",
    artifact.expectedBehavior === "refuse" ? `\n${REFUSAL_DIRECTIVE}` : "",
    "",
    `ARTIFACT TO JUDGE:\n${artifact.content}`,
    "",
    renderSources(artifact),
    "",
    renderExpectedCoverage(artifact),
    "",
    GROUNDING_NOTE,
    "",
    CITATION_IS_NOT_EVIDENCE,
    "",
    renderRubric(rubric, dims),
    "",
    JUDGE_OUTPUT_CONTRACT,
  ];
  return parts.filter((p) => p !== "").join("\n");
}

/**
 * Builds the Chief Synthesizer prompt from the panel's parsed judgments. Pure.
 * The synthesizer sees scores + rationales + flagged violations and must
 * reconcile them into one verdict; the numeric final score is computed in code,
 * so the synthesizer only authors the rationale.
 */
export function buildSynthesisPrompt(
  artifact: Artifact,
  judgeBlocks: readonly { judgeId: string; weightedScore: number; summary: string; violations: number }[],
  computedFinalScore: number,
  gateTripped: boolean,
): string {
  const panel = judgeBlocks
    .map(
      (b) =>
        `- Judge ${b.judgeId}: weighted ${b.weightedScore.toFixed(2)}/10, ${b.violations} grounding violation(s). Verdict: ${b.summary}`,
    )
    .join("\n");
  return [
    "You are the CHIEF SYNTHESIZER. Three blind judges scored the same artifact.",
    "Reconcile their views into one written rationale. The numeric final score has",
    `already been computed by the panel math: ${computedFinalScore.toFixed(2)}/10` +
      (gateTripped
        ? " (a grounding hard-gate was TRIPPED — explain that the cap was applied because of an unsupported factual claim)."
        : "."),
    "",
    `ARTIFACT TYPE: ${artifact.type}`,
    "",
    "PANEL:",
    panel,
    "",
    "Write 2-4 sentences explaining the final score: where judges agreed, where they",
    "diverged, and what most drove the verdict. Respond with prose only.",
  ].join("\n");
}

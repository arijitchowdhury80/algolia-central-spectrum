# `@lab/judge` — provider-agnostic AI Judge

A reproducible, provider-agnostic **AI judge** for scoring an answer (or any text
artifact) on **quality AND grounding**. It runs a **blind 3-lens panel** —
Skeptic / Referee / Advocate, all at temperature 0 — over a 4-dimension rubric,
applies a **grounding hard-gate**, and (over multiple rounds) a **claim-recurrence
gate** that kills run-to-run flicker.

The package is **pure**: it does no I/O and imports **no vendor SDK**. The only
contact with the outside world is one injected function, `LlmComplete`. Write one
small adapter for your model and the whole judge is portable to any LLM or app.

- Source of truth for the contract: `src/types.ts`
- Rubric + defaults: `src/rubric.ts`
- Orchestration: `src/judge.ts` (the only file that calls the LLM)
- Scoring math (pure): `src/aggregate.ts`, `src/synthesis.ts`, `src/gate.ts`, `src/claimGate.ts`
- Validity gate: `src/calibration.ts`

---

## 1. What it does

For one **artifact** (an answer + the sources it was allowed to use), the judge:

1. Builds a **blinded** prompt for each of three judges — the judges never learn
   which system produced the answer (`BLINDING_INSTRUCTION` in `src/prompt.ts`).
2. Runs all three judges **in parallel** at **temperature 0** (`src/judge.ts`).
   Determinism comes from temp 0; perspective diversity comes from the distinct
   **personas**, not random sampling.
3. Parses each judge's JSON into per-dimension scores + flagged grounding
   violations (`src/parse.ts`).
4. Reconciles the panel into one **pre-gate consensus** score, then applies the
   **grounding hard-gate** (`src/synthesis.ts`, `src/gate.ts`).
5. Optionally runs **N rounds** and produces a stable voted verdict via the
   **claim-recurrence gate** (`src/claimGate.ts`) — the zero-flicker guarantee.
6. Has the Chief Synthesizer author a short prose **rationale** around the
   already-computed number.

The three judge personas (`DEFAULT_JUDGES`):

| id | temperament | lens |
|----|-------------|------|
| `skeptic` | skeptic | contrarian hallucination-hunter; the **only** gating judge |
| `referee` | referee | neutral, applies the rubric literally |
| `advocate` | advocate | generous, rewards genuine depth — but never excuses fabricated facts |

---

## 2. The four dimensions

The default rubric is `ALGOLIA_ANSWER_RUBRIC` (`src/rubric.ts`), scored **1–10**:

| id | label | what it measures |
|----|-------|------------------|
| `grounding` | Grounding | Is every factual claim traceable to a provided source? **Also the hard gate.** |
| `coverage` | Coverage | Did the answer address every part of the question? Uses `extractedEntities` as a checklist when present. |
| `depth` | Depth | For what it covers, does it go deep — mechanism, specific params, numbers, trade-offs — from the sources, not padding? |
| `relevance` | Relevance | Does it address **this** user's specific situation, not a generic version? |

All four dimensions are **equal weight (×1)**. The composite — surfaced as
**"Confidence"** in the UI/API — is the **simple equal-weight mean** of the four
(`DEFAULT_SYNTHESIS.rule === "mean"`). Grounding is **not** up-weighted in the
average; it is enforced separately as the **hard floor** via the gate.

The per-claim signal is `certainty` (0–1) — the skeptic's confidence that a
specific flagged claim is a real violation. It is named `certainty` (not
`confidence`) so it never collides with the answer-level "Confidence" composite.
(The parser still accepts a legacy `confidence` key on input for back-compat.)

---

## 3. The grounding gate

Grounding is the hard floor. Mechanics (`src/gate.ts`, `src/synthesis.ts`,
`src/claimGate.ts`):

- **Only the Skeptic gates** (`gatingTemperaments: ["skeptic"]`).
- A violation must reach **`verifiedConfidence` (default 0.7)** to count.
- **Only `kind: "contradicted"`** violations can cap. A `contradicted` flag means
  the sources say otherwise or the claim is fabricated — a real hallucination.
- **`kind: "unverifiable"`** (plausible but simply not present in thin/partial
  sources) **lowers the Grounding dimension** but **does NOT trip the gate**. This
  is the fix that stopped thin-source live runs from all collapsing to the cap.
  (A violation with no `kind` defaults to `contradicted` — the safe default.)
- When the gate trips, the final score is **capped at `cap` (default 3)/10**,
  regardless of prose quality.
- **Multi-round (anti-flicker):** a claim must **recur** across rounds to trip.
  Violations are clustered across rounds by token-overlap similarity
  (`claimSimilarity`, Jaccard over stemmed, stopworded tokens) and the gate trips
  only when the **same** claim is flagged in **≥ `recurrenceThreshold`** of rounds
  (supermajority, `DEFAULT_GATE_VOTE_THRESHOLD = 2/3`). Evidence between the clean
  threshold (`1/3`) and the trip threshold is **`borderline`** — flagged for
  review, **not** auto-capped. A one-off stochastic flag can no longer swing the
  verdict.

The stable pre-gate consensus is **averaged** across rounds; the gate is decided
by the vote. That separation is what makes the multi-round verdict reproducible.

---

## 4. Integration — three ways

### a. Import the package (build it into your own project)

Write one `LlmComplete` adapter, build an `Artifact`, and call
`judgeArtifactMultiRound`. This is the most flexible path; for the guided version
use the **`ai-judge`** skill.

The seam (`src/types.ts`):

```ts
interface LlmCompleteOptions {
  temperature?: number;   // judges run at 0
  maxTokens?: number;
  system?: string;        // optional system prompt
  tag?: string;           // free-form trace label, e.g. "judge:skeptic:round1"
}

type LlmComplete = (prompt: string, opts?: LlmCompleteOptions) => Promise<string>;
```

A minimal example:

```ts
import {
  judgeArtifactMultiRound,
  DEFAULT_JUDGE_CONFIG,
  type Artifact,
  type LlmComplete,
} from "@lab/judge";

// 1. One adapter for your model — the ONLY vendor-specific code.
const llm: LlmComplete = async (prompt, opts) => {
  const res = await myModel.complete({
    prompt,
    system: opts?.system,
    temperature: opts?.temperature ?? 0,
    maxTokens: opts?.maxTokens,
  });
  return res.text; // must return the raw string the judge will parse as JSON
};

// 2. The thing under judgement.
const artifact: Artifact = {
  type: "algolia-answer",
  prompt: "How does Algolia handle typo tolerance?",
  content: "Algolia corrects typos automatically using ...",
  sources: [
    { id: "S1", text: "Typo tolerance allows up to 2 typos ...", label: "docs/typo-tolerance" },
  ],
  // optional Coverage checklist from your upstream pipeline:
  extractedEntities: { intent: "explain typo tolerance", product: "search" },
  // optional: expectedBehavior: "refuse"  // when a clean refusal is the correct answer
};

// 3. Judge it over 3 rounds (the voted gate kicks in at rounds > 1).
const result = await judgeArtifactMultiRound(artifact, DEFAULT_JUDGE_CONFIG, llm, 3);

console.log(result.aggregate.finalScore);     // the composite (0–10), post-gate
console.log(result.aggregate.dimensionMeans); // { grounding, coverage, depth, relevance }
console.log(result.aggregate.gateTripped);    // grounding hard-gate
console.log(result.aggregate.borderline);     // ambiguous grounding signal
```

`DEFAULT_JUDGE_CONFIG` bundles the 4-dimension rubric, the 3 personas, the gate
(`cap 3`, `verifiedConfidence 0.7`, gating = skeptic), and `mean` synthesis. Pass
your own `JudgeConfig` to customize the rubric, personas, gate, or vote threshold.

For a single round with an LLM-authored rationale, use `judgeArtifact(...)`.

### b. HTTP service

`lab/server` exposes the judge as a standalone always-on service (the judge is
30–90s and needs a server-side LLM key, so it is not a fit for serverless).

```bash
cd lab/server
npm run judge:serve        # binds $PORT, default 8788
```

**Request** — `POST /api/judge` (`application/json`):

```jsonc
{
  "question": "How does Algolia handle typo tolerance?",   // required
  "panels": [                                              // required, non-empty
    {
      "panelId": "P1",                                     // echoed back on the verdict
      "label": "optional human label",
      "answer": "the answer text to score",
      "sources": [
        { "id": "S1", "title": "...", "url": "...", "text": "body used for grounding" }
      ],
      "generatedFollowUp": "optional follow-up question to score"
    }
  ],
  "followUp": "optional 2nd turn (enables the engagement dimension)",
  "isRefusalTest": false,        // true when a clean refusal is the correct answer
  "rounds": 1                    // optional; live default is 1 (indicative)
}
```

**Response** — one JSON blob by default, or **SSE** when
`Accept: text/event-stream`. The blob is a `LiveJudgeResult`:

```jsonc
{
  "rounds": 1,
  "panels": [
    {
      "panelId": "P1",
      "dims": { "grounding": 8, "coverage": 7, "depth": 6, "relevance": 8 }, // each 1–10
      "dimensions": [ { "id": "grounding", "label": "Grounding", "score": 8 } ],
      "synthesizedScore": 7.2, "composite": 7.2,   // the Confidence composite (0–10)
      "preGateScore": 7.2,
      "gateTripped": false,
      "borderline": false,
      "flaggedClaims": [ { "claim": "...", "reason": "...", "certainty": 0.4 } ],
      "perJudge": [ { "role": "skeptic", "score": 6.5, "note": "..." } ],
      "followUpQuality": 8,        // only when generatedFollowUp was provided
      "rationale": "...",
      "error": "..."              // set only if THIS panel failed (others still return)
    }
  ],
  "deltas": { "multiLift": 0.6 }  // P4 − P3 when both neural panels are judged
}
```

**SSE event order:** `phase` (once) → `panel` (one per panel as it resolves) →
`result` (the full blob, last) → `error` (only on a mid-stream failure).

`GET /health` → `{ "ok": true }`.

Auth/rate-limit are **opt-in**: set `LAB_API_KEY` (unset = open, sent via the
`x-lab-key` header) and `RATE_LIMIT` (≤0 = disabled). The provider + key are
resolved from `.env.local`. The live verdict is **indicative** (fast model, 1
round); the batch `npm run judge` on a full transcript is **authoritative**.

### c. CLI / Skill

Pipe a request JSON (same shape as the HTTP body) in, get the verdict JSON out:

```bash
cd lab/server
cat request.json | npm run judge:cli
# or:
npm run judge:cli -- --file calibration/cli-fixture.json
```

Progress + errors go to **stderr**; stdout stays parseable JSON. Exit code is 0
on success, non-zero on any error. Needs a working provider key
(`GOOGLE_API_KEY` or `OPENAI_API_KEY`) in `.env.local`.

For the agent-facing version, use the **`ai-judge-cli`** skill (score 1–4 answers
ad hoc, or wire the judge into a Bash step of a larger flow). Use the **`ai-judge`**
skill instead when you want to build the judge into your own project (the import
pattern in §4a).

---

## 5. Key types

All exported from `@lab/judge` (`src/types.ts`).

**`Artifact`** — the thing under judgement:

```ts
interface Artifact {
  type: string;                       // e.g. "algolia-answer"
  prompt?: string;                    // the question / brief
  content: string;                    // the answer text judges read
  sources: readonly Source[];         // [] = no external grounding required
  notApplicableDimensions?: readonly string[];   // drop optional dims for this artifact
  expectedBehavior?: "answer" | "refuse";        // "refuse" → a clean refusal scores HIGH
  extractedEntities?: ExtractedEntities;          // Coverage checklist
}
```

**`Source`** — the grounding corpus (groundedness is checked against `text`, not
the world):

```ts
interface Source { id: string; text: string; label?: string; }
```

**`ExtractedEntities`** — the Coverage checklist your upstream pipeline already
produced (the judge does no extraction of its own):

```ts
interface ExtractedEntities {
  intent?: string; brand?: string; industry?: string; product?: string;
  concepts?: readonly string[];
  signals?: Readonly<Record<string, string>>;
}
```

**Verdict** — `MultiRoundResult.aggregate` (a `RoundAggregate`) is the stable
verdict the harness consumes:

```ts
interface RoundAggregate {
  rounds: number;
  meanPreGateScore: number;      // stable pre-gate quality (mean across rounds)
  stdDevPreGateScore: number;    // reproducibility signal
  gateTripFraction: number;      // recurrence of the most-reproducible flagged claim
  gateTripped: boolean;          // grounding hard-gate (voted)
  borderline: boolean;           // some evidence, not a supermajority → flag, don't cap
  finalScore: number;            // = composite: meanPreGateScore capped iff gateTripped
  dimensionMeans: Record<string, number>;   // { grounding, coverage, depth, relevance }
  judgeComposites: JudgeComposite[];         // per-judge 0–10, round-averaged
}
```

Each flagged claim is a `GroundingViolation { claim, reason, certainty, kind }`
where `kind ∈ { "contradicted", "unverifiable" }`. In the HTTP/CLI verdict the
flagged claims are surfaced as `flaggedClaims: [{ claim, reason, certainty }]` (the
service shows only `contradicted` flags — the ones that actually gate).

---

## 6. Calibration (the validity gate)

A judge score is only trustworthy if it agrees with a human's quality ranking of
the same answers. `src/calibration.ts` runs the judge over a human-ranked set and
computes the **Spearman rank correlation** between the human ranking and the
judge's ranking. The judge **passes** iff the correlation clears the agreed bar
(target **≥ 0.7**).

```bash
cd lab/server
npm run calibrate                       # uses calibration/set.json
npm run calibrate -- path/to/set.json   # custom set
# env: CALIBRATION_THRESHOLD (0.7), CALIBRATION_ROUNDS (1); --verbose for evidence
```

Fill `humanRank` (1 = best) in `set.json` first (see
`lab/server/calibration/RANKING-SHEET.md`). Items with a null rank are skipped;
you need ≥ 2 ranked items.

> **Caveat:** the gym gold answers lack **source bodies**, so a grounding
> evaluation against them is not meaningful — calibrating Grounding needs the
> **real retrieved sources** the answer was generated from. Calibrate on a set
> that carries the actual `sources[].text`.

---

## 7. Standalone / portability

- **Zero runtime dependencies.** `package.json` lists only dev deps (vitest, tsx,
  typescript). Nothing is imported from a vendor SDK anywhere in `src/`.
- **One seam:** `LlmComplete`. Any model — Anthropic, OpenAI, Gemini, a local
  model, or a deterministic mock — drops in behind that single function. The
  entire scoring engine (aggregate / gate / synthesis / claimGate / calibration)
  is **pure** and unit-tested without a network by mocking `llm`.
- **Domain-agnostic.** The same `Artifact` shape judges an Algolia answer, a
  LinkedIn post, a short story, or a prompt — swap the rubric in `JudgeConfig`.
- Build/test:

  ```bash
  cd lab/judge
  npm test           # vitest
  npm run typecheck  # tsc --noEmit
  ```

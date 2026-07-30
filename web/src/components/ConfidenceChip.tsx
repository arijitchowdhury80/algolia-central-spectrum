import type { JudgeVerdict } from '../lib/judgeClient';

/**
 * ConfidenceChip — the per-answer **grounding** surface.
 *
 * WHAT IT SHOWS, AND WHY IT STOPPED SHOWING A NUMBER (2026-07-28)
 * ---------------------------------------------------------------------
 * This chip used to show the composite judge score as a decimal (`8.9/10`).
 * That was retired for two measured reasons:
 *
 *   1. It was not reproducible. The same answer, identical input, no code
 *      change, scored {3.00, 8.89} — sd 2.88 — because the score was capped by
 *      an LLM panel guessing whether a claim was absent from ~90k characters of
 *      source. Multi-round voting did not fix it; the bias is systematic.
 *   2. A single decimal fused ONE validated signal (grounding) with three that
 *      have never been validated against anyone's judgement (depth, coverage,
 *      relevance). One decimal place implies a precision that does not exist.
 *
 * So the chip now states only what can be proven and reproduced: whether every
 * verbatim-required term in the answer (code identifiers, scaled numbers,
 * CamelCase API names) was located in the cited sources. That check is a pure
 * function of (answer, sources) — precision 1.00, zero variance, measured over
 * a 36-case ground-truth set.
 *
 * The composite, the per-judge breakdown, and the advisory LLM findings all
 * still exist and are one click away in the JudgeDrawer, where they carry their
 * own caveats. What is gone is the headline decimal, not the diagnostics.
 */
export interface ConfidenceChipProps {
  /** The answer's judge verdict, once it resolves. Undefined while scoring. */
  verdict?: JudgeVerdict;
  /** True while the judge is running for this answer (shows the scoring state). */
  scoring?: boolean;
  /** Click a resolved chip → open the judge drawer. Omit to render non-clickable. */
  onOpenJudge?: () => void;
}

type Tone = 'positive' | 'notice' | 'negative' | 'muted';

const TONE_CLS: Record<Tone, string> = {
  positive: 'border-ac-positive bg-ac-positive-bg text-ac-positive hover:shadow-ac-1',
  notice: 'border-ac-notice bg-ac-notice-bg text-ac-notice hover:shadow-ac-1',
  negative: 'border-ac-negative bg-ac-negative-bg text-ac-negative hover:shadow-ac-1',
  muted: 'border-ac-border bg-ac-surface-2 text-ac-text-muted hover:shadow-ac-1',
};

/** What the chip says, given the reproducible grounding verdict. */
interface ChipState {
  tone: Tone;
  /** Short label rendered in the chip. */
  label: string;
  /** Emphasised tail, when there is a count to show. */
  detail?: string;
  /** Hover/assistive description. */
  title: string;
}

/**
 * Derive the chip's copy from the verdict. Pure, and deliberately total: every
 * branch either states a proven fact or says the check is unavailable. There is
 * no branch that falls back to the composite decimal.
 */
export function chipState(v: JudgeVerdict): ChipState {
  // The judge could not be reached / failed for this answer. This MUST render
  // something: it used to return nothing at all, and an absent chip reads as
  // "the grounding feature disappeared" rather than "the check didn't run".
  // Observed 2026-07-28 against a build with no VITE_JUDGE_URL — the request
  // went to localhost:8788, was refused, and the chip silently vanished.
  if (v.error) {
    return {
      tone: 'muted',
      label: 'Grounding',
      detail: "didn't run",
      title: `The grounding check could not be completed for this answer: ${v.error}. The answer itself is unaffected — it is still drawn only from the indexed sources.`,
    };
  }

  // Older judge deployment (no deterministic check) — say so. Falling back to
  // `composite` here is exactly the false-precision this change removed.
  if (v.grounded === undefined) {
    return {
      tone: 'muted',
      label: 'Grounding',
      detail: 'unavailable',
      title:
        'This judge build does not report the deterministic grounding check. ' +
        'Click for the raw panel output.',
    };
  }

  const unsupported = v.unsupportedTerms ?? [];

  if (!v.grounded) {
    const n = unsupported.length;
    const names = unsupported.slice(0, 3).map((u) => u.term).join(', ');
    return {
      tone: 'negative',
      label: n === 1 ? '1 unverified claim' : `${n} unverified claims`,
      title:
        `${n} term(s) in this answer appear in none of the cited sources` +
        (names ? `: ${names}${n > 3 ? ', …' : ''}` : '') +
        '. Click for the full breakdown.',
    };
  }

  // Grounded, but nothing verifiable was present — an honest distinction. A
  // prose-only answer or a refusal has no code identifiers or figures to check,
  // so claiming it "verified" would overstate what happened.
  if ((v.termsChecked ?? 0) === 0) {
    return {
      tone: 'muted',
      label: 'Grounding',
      detail: 'nothing to verify',
      title:
        'This answer makes no verbatim-checkable claim (no API names, identifiers, ' +
        'or figures). Click for the judge panel’s reading.',
    };
  }

  // Advisory LLM findings exist but do not change the verdict — surface that
  // there is something to look at without letting it move the headline.
  const advisory = (v.advisoryClusters?.length ?? 0) + (v.soloFlags?.length ?? 0);
  return {
    tone: advisory > 0 ? 'notice' : 'positive',
    label: 'Grounded',
    detail: advisory > 0 ? `${advisory} to review` : undefined,
    title:
      `All ${v.termsChecked} verbatim-checkable term(s) were located in the cited sources.` +
      (advisory > 0
        ? ` ${advisory} advisory judge flag(s) did not affect this verdict — click to read them.`
        : ' Click for the full breakdown.'),
  };
}

export function ConfidenceChip({ verdict, scoring = false, onOpenJudge }: ConfidenceChipProps) {
  // ── Scoring (no verdict yet) — quiet, non-interactive placeholder. ──────────
  // An ERROR verdict deliberately falls through to chipState below, which
  // renders a visible "didn't run" chip. Only a genuinely absent verdict with no
  // scoring in flight renders nothing.
  if (!verdict) {
    if (!scoring) return null;
    return (
      <span
        className="inline-flex w-fit items-center gap-1.5 rounded-ac-full border border-ac-border bg-ac-surface-2 px-3 py-1 text-ac-xs font-ac-medium text-ac-text-muted"
        aria-live="polite"
        aria-label="Grounding check in progress"
      >
        <span aria-hidden="true">⚖</span>
        <span>Grounding</span>
        <span className="motion-safe:animate-pulse">· checking…</span>
      </span>
    );
  }

  const { tone, label, detail, title } = chipState(verdict);

  return (
    <button
      type="button"
      className={`inline-flex w-fit items-center gap-1.5 rounded-ac-full border px-3 py-1 text-ac-xs font-ac-medium transition-colors duration-ac-fast ease-ac-ease disabled:cursor-default ${TONE_CLS[tone]}`}
      onClick={onOpenJudge}
      disabled={!onOpenJudge}
      title={title}
      aria-label={`${label}${detail ? `, ${detail}` : ''}. Open the judge breakdown.`}
    >
      <span aria-hidden="true">{tone === 'positive' ? '✓' : '⚖'}</span>
      <span className="font-ac-bold">{label}</span>
      {detail && <span className="opacity-70">· {detail}</span>}
      <span aria-hidden="true" className="opacity-60">›</span>
    </button>
  );
}

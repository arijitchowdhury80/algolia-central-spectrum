/**
 * <algolia-confidence-badge> — a standalone, framework-agnostic custom element.
 *
 * DATA IN
 *   verdict  attribute  JSON-encoded JudgeVerdict (or absent/null for unavailable)
 *   verdict  property   JudgeVerdict object (takes priority over the attribute)
 *   scoring  attribute  boolean (presence = true) — show "scoring…" pulse
 *   scoring  property   boolean
 *
 * DATA OUT
 *   open-judge  CustomEvent  bubbles + composed; detail: { verdict: JudgeVerdict }
 *                            fired when the user clicks a scored chip.
 *
 * WHAT IT DISPLAYS
 *   Two shapes, chosen by what the judge backend reports:
 *
 *   1. `verdict.grounded` present — the backend ran a DETERMINISTIC grounding
 *      check (verbatim verification of terms that cannot be paraphrased: code
 *      identifiers, CamelCase API names, scaled numbers). The chip then states
 *      `Grounded` or `N unverified claims`, because that result is a pure
 *      function of (answer, sources) and is identical on every run.
 *   2. `verdict.grounded` absent — unchanged legacy behaviour: the composite
 *      score as `N.N/10`.
 *
 *   The distinction matters because the composite is NOT reproducible: measured
 *   on one fixed answer with identical input and no code change, the same panel
 *   returned {3.00, 8.89}, sd 2.88, because an LLM was being asked to prove a
 *   negative ("is this claim absent from ~90k characters?") and its guess landed
 *   on the gate threshold. Multi-round voting did not fix it — the bias is
 *   systematic, so averaging biased rounds gives a biased average. A backend
 *   that reports a reproducible check should not have that hidden behind a
 *   decimal, so the badge shows the check and leaves the composite (and the
 *   per-judge detail) to the drawer, one click away.
 *
 * Theming: all colors / radii / type come from CSS custom properties (`--algolia-*`).
 * When nested inside <algolia-chat> (which injects the full token sheet)
 * the chip inherits those properties automatically. When used standalone, the
 * fallbacks in chip.css produce a neutral rendering that callers can override
 * by setting `--algolia-*` on or above the element's host.
 */

import type { JudgeVerdict, JudgeErrorKind } from '@algolia-central/chat-central';
import badgeCss from './badge.css?inline';

// ─── i18n: BadgeLabels ────────────────────────────────────────────────────────

/** All user-facing strings rendered by the badge element.
 *  Provide a full or partial override via the `labels` attribute (JSON) or
 *  the `labels` JS property. Untouched keys fall back to English defaults. */
export interface BadgeLabels {
  scoringAriaLabel: string;
  label: string;
  scoringStatus: string;
  scoreDenom: string;
  scoredTitleNormal: string; // template: {score}
  scoredTitleGate: string; // template: {score}, {flagged}
  scoredAriaLabel: string; // template: {score}
  flaggedCount: string; // template: {count}
  unavailableAriaLabel: string; // template: {reason}
  unavailableFallbackTail: string;
  unavailableFallbackHint: string;
  errors: Partial<Record<JudgeErrorKind, { tail: string; hint: string }>>;

  // ── Deterministic grounding states (used only when the verdict reports them)
  groundingLabel: string;
  groundedLabel: string;
  groundedTitle: string; // template: {checked}
  groundedAdvisoryDetail: string; // template: {count}
  groundedAdvisoryTitle: string; // template: {checked}, {count}
  unverifiedLabelOne: string;
  unverifiedLabelMany: string; // template: {count}
  unverifiedTitle: string; // template: {count}, {terms}
  unverifiedAriaLabel: string; // template: {count}
  groundedAriaLabel: string;
  nothingToVerifyDetail: string;
  nothingToVerifyTitle: string;
}

const DEFAULT_BADGE_LABELS: BadgeLabels = {
  scoringAriaLabel: 'Confidence score in progress',
  label: 'Confidence',
  scoringStatus: '\u00b7 scoring\u2026',
  scoreDenom: '/10',
  scoredTitleNormal: 'Confidence {score}/10 \u2014 click for the 3-judge breakdown.',
  scoredTitleGate:
    'Confidence {score}/10 \u2014 grounding floor tripped ({flagged} flagged). Click for the full breakdown.',
  scoredAriaLabel: 'Confidence {score} out of 10. Open the judge breakdown.',
  flaggedCount: '\u26a0 {count} flagged',
  unavailableAriaLabel: 'Confidence score unavailable ({reason})',
  unavailableFallbackTail: '\u00b7 unavailable',
  unavailableFallbackHint: 'Judge service unavailable',
  errors: {
    auth: {
      tail: '\u00b7 auth required',
      hint: 'The judge service rejected the request (401/403). Set VITE_JUDGE_API_KEY for the hosted judge, or run a local judge.',
    },
    'rate-limit': {
      tail: '\u00b7 rate limited',
      hint: 'The judge service is rate-limiting this client (429). Wait a moment and try again.',
    },
    offline: {
      tail: '\u00b7 offline',
      hint: 'Couldn\u2019t reach the judge service (network/CORS/DNS). Check VITE_JUDGE_URL and that the judge is running.',
    },
    server: {
      tail: '\u00b7 service error',
      hint: 'The judge service returned an error (5xx). It may be down or misconfigured.',
    },
    'bad-response': {
      tail: '\u00b7 unavailable',
      hint: 'The judge service replied, but the response could not be read.',
    },
  },
  groundingLabel: 'Grounding',
  groundedLabel: 'Grounded',
  groundedTitle:
    'All {checked} verbatim-checkable term(s) in this answer were located in the cited sources. Click for the full breakdown.',
  groundedAdvisoryDetail: '{count} to review',
  groundedAdvisoryTitle:
    'All {checked} verbatim-checkable term(s) were located in the cited sources. {count} advisory judge flag(s) did not affect this verdict \u2014 click to read them.',
  unverifiedLabelOne: '1 unverified claim',
  unverifiedLabelMany: '{count} unverified claims',
  unverifiedTitle:
    '{count} term(s) in this answer appear in none of the cited sources{terms}. Click for the full breakdown.',
  unverifiedAriaLabel: '{count} unverified claim(s). Open the judge breakdown.',
  groundedAriaLabel: 'Grounded. Open the judge breakdown.',
  nothingToVerifyDetail: '\u00b7 nothing to verify',
  nothingToVerifyTitle:
    'This answer makes no verbatim-checkable claim (no API names, identifiers, or figures), so there was nothing to verify. Click for the judge panel\u2019s reading.',
};

/** Substitute `{varName}` tokens in a template string (self-contained, no deps). */
function badgeInterpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    key in vars ? String(vars[key]) : `{${key}}`,
  );
}

// ─── Pure helpers (mirror logic in the old React component) ──────────────────

function badgeTone(v: JudgeVerdict): 'positive' | 'notice' | 'negative' {
  if (v.gateTripped) return 'negative';
  if (v.composite >= 7.5) return 'positive';
  if (v.composite >= 5) return 'notice';
  return 'negative';
}

// ─── Deterministic-grounding state ────────────────────────────────────────────

/** What the badge says when the backend reports the deterministic check. */
interface GroundingChip {
  tone: 'positive' | 'notice' | 'negative' | 'muted';
  /** Bold headline text. */
  label: string;
  /** Optional dimmed tail after the headline. */
  detail?: string;
  title: string;
  ariaLabel: string;
}

/** Chip copy for a verdict whose grounding check FAILED. */
function unverifiedChip(v: JudgeVerdict, L: BadgeLabels): GroundingChip {
  const terms = v.unsupportedTerms ?? [];
  const count = terms.length;
  const names = terms
    .slice(0, 3)
    .map((t) => t.term)
    .join(', ');
  return {
    tone: 'negative',
    label: count === 1 ? L.unverifiedLabelOne : badgeInterpolate(L.unverifiedLabelMany, { count }),
    title: badgeInterpolate(L.unverifiedTitle, {
      count,
      terms: names ? `: ${names}${count > 3 ? ', …' : ''}` : '',
    }),
    ariaLabel: badgeInterpolate(L.unverifiedAriaLabel, { count }),
  };
}

/** Chip copy for a verdict whose grounding check PASSED. */
function groundedChip(v: JudgeVerdict, L: BadgeLabels): GroundingChip {
  const checked = v.termsChecked ?? 0;

  // Passed, but nothing was checkable. A prose-only answer or a refusal has no
  // identifiers or figures to verify, so calling it "Grounded" would claim a
  // check that never ran.
  if (checked === 0) {
    return {
      tone: 'muted',
      label: L.groundingLabel,
      detail: L.nothingToVerifyDetail,
      title: L.nothingToVerifyTitle,
      ariaLabel: L.nothingToVerifyTitle,
    };
  }

  // The LLM panel's own flags are ADVISORY: they did not decide this verdict and
  // they are not in the chip.
  //
  // They used to be — as `· N to review` in the notice (amber) tone. That was
  // wrong twice over. "to review" is an instruction with no object: review what,
  // by whom? And amber reads as "caution" to everyone alive, so the chip said
  // "this is fine" and "be worried" in the same six characters. It was the same
  // mistake as the `BORDERLINE` label: leaking the panel's uncertainty into a
  // headline that is supposed to state only what was proven.
  //
  // The flags are still surfaced, in the drawer, where there is room to say what
  // they are and that they did not count. The chip stays binary.
  const advisory = v.flaggedClaims.length;
  return {
    tone: 'positive',
    label: L.groundedLabel,
    title:
      advisory > 0
        ? badgeInterpolate(L.groundedAdvisoryTitle, { checked, count: advisory })
        : badgeInterpolate(L.groundedTitle, { checked }),
    ariaLabel: L.groundedAriaLabel,
  };
}

/** Derive the badge's copy from a verdict that carries the deterministic check. */
function groundingChip(v: JudgeVerdict, L: BadgeLabels): GroundingChip {
  return v.grounded ? groundedChip(v, L) : unverifiedChip(v, L);
}

// ─── Unavailable-state helpers ────────────────────────────────────────────────

function lookupErrorCopy(
  verdict: JudgeVerdict | null,
  labels: BadgeLabels,
): { tail: string; hint: string } | undefined {
  return verdict?.errorKind ? labels.errors[verdict.errorKind] : undefined;
}

function errorTail(copy: { tail: string; hint: string } | undefined, labels: BadgeLabels): string {
  return copy?.tail ?? labels.unavailableFallbackTail;
}

function errorHint(
  copy: { tail: string; hint: string } | undefined,
  fallbackError: string | undefined,
  labels: BadgeLabels,
): string {
  return copy?.hint ?? fallbackError ?? labels.unavailableFallbackHint;
}

// ─── Helpers to build DOM nodes ──────────────────────────────────────────────

function span(text: string, className?: string): HTMLSpanElement {
  const el = document.createElement('span');
  if (className) el.className = className;
  el.textContent = text;
  return el;
}

// ─── Custom element ───────────────────────────────────────────────────────────

export class ConfidenceBadgeElement extends HTMLElement {
  private _verdict: JudgeVerdict | null = null;
  private _scoring = false;
  private _shadow: ShadowRoot | null = null;
  private _labels: BadgeLabels = {
    ...DEFAULT_BADGE_LABELS,
    errors: { ...DEFAULT_BADGE_LABELS.errors },
  };

  static get observedAttributes(): string[] {
    return ['verdict', 'scoring', 'labels'];
  }

  // ── Property accessors ─────────────────────────────────────────────────────

  get verdict(): JudgeVerdict | null {
    return this._verdict;
  }

  set verdict(value: JudgeVerdict | null) {
    this._verdict = value;
    this._render();
  }

  get scoring(): boolean {
    return this._scoring;
  }

  set scoring(value: boolean) {
    this._scoring = value;
    this._render();
  }

  /** Merge a partial BadgeLabels override into the defaults and re-render. */
  set labels(value: Partial<BadgeLabels>) {
    this._labels = {
      ...DEFAULT_BADGE_LABELS,
      ...value,
      errors: { ...DEFAULT_BADGE_LABELS.errors, ...(value.errors ?? {}) },
    };
    this._render();
  }

  get labels(): BadgeLabels {
    return this._labels;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  connectedCallback(): void {
    if (!this._shadow) {
      this._shadow = this.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = badgeCss;
      this._shadow.appendChild(style);
    }
    this._render();
  }

  // eslint-disable-next-line complexity
  attributeChangedCallback(name: string, _old: string | null, next: string | null): void {
    if (name === 'verdict') {
      if (next === null || next === '') {
        this._verdict = null;
      } else {
        try {
          this._verdict = JSON.parse(next) as JudgeVerdict;
        } catch {
          this._verdict = null;
        }
      }
      this._render();
    } else if (name === 'scoring') {
      // Presence of the attribute means true; null means removed (false).
      this._scoring = next !== null;
      this._render();
    } else if (name === 'labels' && next) {
      try {
        this.labels = JSON.parse(next) as Partial<BadgeLabels>;
      } catch {
        /* ignore malformed JSON */
      }
    }
  }

  // ── Rendering helpers ──────────────────────────────────────────────────────

  private _renderScoring(): HTMLElement {
    const L = this._labels;
    const el = document.createElement('span');
    el.className = 'badge badge--muted';
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('aria-label', L.scoringAriaLabel);
    const icon = span('⚖');
    icon.setAttribute('aria-hidden', 'true');
    el.appendChild(icon);
    el.appendChild(span(L.label));
    el.appendChild(span(L.scoringStatus, 'badge__scoring'));
    return el;
  }

  private _renderUnavailable(verdict: JudgeVerdict | null): HTMLElement {
    const L = this._labels;
    const copy = lookupErrorCopy(verdict, L);
    const tail = errorTail(copy, L);
    const hint = errorHint(copy, verdict?.error, L);
    const el = document.createElement('span');
    el.className = 'badge badge--muted badge--unavailable';
    el.setAttribute('title', hint);
    el.setAttribute(
      'aria-label',
      badgeInterpolate(L.unavailableAriaLabel, { reason: tail.replace(/^\u00b7\s*/, '') }),
    );
    const icon = span('⚖');
    icon.setAttribute('aria-hidden', 'true');
    el.appendChild(icon);
    el.appendChild(span(L.label));
    el.appendChild(span(tail));
    return el;
  }

  private _renderScored(verdict: JudgeVerdict): HTMLElement {
    const L = this._labels;
    const tone = badgeTone(verdict);
    const flagged = verdict.flaggedClaims.length;
    const score = verdict.composite.toFixed(1);
    const title = verdict.gateTripped
      ? badgeInterpolate(L.scoredTitleGate, { score, flagged })
      : badgeInterpolate(L.scoredTitleNormal, { score });

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `badge badge--${tone}`;
    btn.title = title;
    btn.setAttribute('aria-label', badgeInterpolate(L.scoredAriaLabel, { score }));

    const icon = span('⚖');
    icon.setAttribute('aria-hidden', 'true');
    btn.appendChild(icon);
    btn.appendChild(span(L.label));
    btn.appendChild(span(score, 'badge__score'));
    btn.appendChild(span(L.scoreDenom, 'badge__denom'));
    if (verdict.gateTripped && flagged > 0) {
      btn.appendChild(span(badgeInterpolate(L.flaggedCount, { count: flagged }), 'badge__flagged'));
    }
    const chevron = span('›', 'badge__chevron');
    chevron.setAttribute('aria-hidden', 'true');
    btn.appendChild(chevron);
    btn.addEventListener('click', () => {
      this.dispatchEvent(
        new CustomEvent('open-judge', { detail: { verdict }, bubbles: true, composed: true }),
      );
    });
    return btn;
  }

  /** Render the deterministic-grounding chip (binary + count, never a score). */
  private _renderGrounding(verdict: JudgeVerdict): HTMLElement {
    const { tone, label, detail, title, ariaLabel } = groundingChip(verdict, this._labels);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `badge badge--${tone}`;
    btn.title = title;
    btn.setAttribute('aria-label', ariaLabel);

    const icon = span(tone === 'positive' ? '✓' : '⚖');
    icon.setAttribute('aria-hidden', 'true');
    btn.appendChild(icon);
    btn.appendChild(span(label));
    if (detail) btn.appendChild(span(detail, 'badge__flagged'));
    const chevron = span('›', 'badge__chevron');
    chevron.setAttribute('aria-hidden', 'true');
    btn.appendChild(chevron);
    btn.addEventListener('click', () => {
      this.dispatchEvent(
        new CustomEvent('open-judge', { detail: { verdict }, bubbles: true, composed: true }),
      );
    });
    return btn;
  }

  // ── Rendering ──────────────────────────────────────────────────────────────

  private _render(): void {
    if (!this._shadow) return;
    const previous = this._shadow.querySelector('.badge');
    if (previous) previous.remove();

    const { _verdict: verdict, _scoring: scoring } = this;

    let el: HTMLElement;
    if (scoring && !verdict) {
      el = this._renderScoring();
    } else if (!verdict || verdict.error) {
      el = this._renderUnavailable(verdict);
    } else if (verdict.grounded !== undefined) {
      // The backend ran the deterministic grounding check. Prefer it: it is the
      // only part of the verdict that is reproducible for the same input.
      el = this._renderGrounding(verdict);
    } else {
      el = this._renderScored(verdict);
    }
    this._shadow.appendChild(el);
  }
}

// ─── Register ─────────────────────────────────────────────────────────────────

if (!customElements.get('algolia-confidence-badge')) {
  customElements.define('algolia-confidence-badge', ConfidenceBadgeElement);
}

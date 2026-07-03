# Step 7.5 — UI/UX Constraints (from UIUXDesignSOP/index.md + 00-principles)

> Note: the frontend-builder's hardcoded SOP path is stale on this machine. Real path used: `~/Dropbox/AI-Development/Obsidian/Arijit-Second-Brain/Standards/UIUXDesignSOP/`.

**Alignment win:** the SOP's `brand: custom` model = "derive tokens from font + primary color + text color." That IS our token-contract skin approach — the framework's client skins are exactly SOP custom brands. Our design system is a superset (adds structure lock).

## Emphasis tiers → our elements (from Step 2)
- **Hero (max 1):** the streaming answer. Nothing else may claim Hero.
- **Primary (2–3):** composer, source cards (receipts), agent/handoff marker.
- **Secondary:** sample questions, judge/confidence drawer trigger, header identity.
- **Supporting:** footer provenance/disclaimer, timestamps, latency, frame debug.
- Guard: judge stays Secondary; source-tags/citations are Supporting per SOP row "Evidence → Source Tag."

## Component constraints
- **Required states on every interactive component:** default, hover, focus-visible, active, disabled, loading, empty, error. Chat MUST handle empty (start state), loading (streaming), error (service fail) AND refusal (valid grounded "not in docs" — style as honest answer, NOT error red).
- Agent chips / grounding status: **never color-only** — pair icon + text label (a11y: color never sole indicator).
- Source card = title + source badge + snippet only (never dump the 90KB body). Cap visible cards; "show all" for the rest.

## Responsive (required breakpoints)
- **375px:** single column; source cards stack full-width; judge drawer becomes a full-screen sheet; composer sticky bottom, 44px+ touch targets.
- **768px / 1024px:** same single column, wider reading measure (`--ac-measure`); drawer as side panel from 1024px.
- **1280px+:** centered column capped at `--ac-maxw`; generous side gutters. No full-bleed text.

## Accessibility (WCAG 2.2 AA)
- Contrast: 4.5:1 body text, 3:1 large text / UI — **enforced by the token contract**; any client skin must pass AA (framework rule, validated per skin).
- Keyboard: composer, send, sample questions, source cards, drawer all reachable + operable; visible focus ring via `--ac-focus`.
- Labels: every control has an accessible name (aria-label on icon buttons; sample questions are real buttons).
- Touch targets ≥44px. Respect `prefers-reduced-motion` for streaming/typing animations.

## Conflicts raised (before coding)
- None blocking. One watch: Spectrum's tight radii + small type must still meet AA contrast + 44px targets — the skin overrides values but the framework enforces minimums (targets/contrast are structure-level, not skin-level). Skin can't opt out of a11y.

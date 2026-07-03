# UIUX Constraints — ACS Chat UI (theme-dashboard, dark-first)

Aesthetic: **theme-dashboard** — dark surface, IBM Plex Sans / mono for code, glass panels, teal/indigo accents. Fits a developer-facing code+design assistant.

## Emphasis tiers → this page
- **Hero**: the current streaming answer region. One per turn.
- **Primary**: composer input; active-agent + handoff chip; source pills row.
- **Secondary**: prior turns; tool-call trace (collapsed by default).
- **Supporting**: agent legend, corpus footer, timestamps, per-source facet tag.
- No tier inflation: source pills stay compact (Supporting/Proof-Pill visual per matrix "Evidence → Proof Pill, Source Tag"), not full cards.

## Component mapping (from Decision Matrix)
- Answer = markdown prose block (Hero prominence via size/spacing, not decoration).
- Source citations = **Proof Pill / Source Tag** pattern (Supporting tier of Evidence row), grouped by `source` facet.
- Handoff = custom **Flow/Pipeline** micro-element (Generic → Technical) — the one signature component.
- Tool trace = inline collapsible line ("searched ReactSpectrumS2 · 6 hits").

## Required states (H1 / §4 triad is non-negotiable)
- Composer: default / focus (visible ring) / disabled while streaming / error.
- Answer region: **loading** (agent chip pulse + typing dots, appears <100ms after send), **success** (streamed text + sources), **error** (`3:` frame or network → red-tinted inline card "couldn't reach the agent — retry [Retry]", never raw stack).
- **Empty** state: names the tool ("Ask about Adobe Spectrum design + React code"), 4 sample questions, grounded-corpus trust line.

## Accessibility (WCAG 2.2 AA — the floor)
- Agent identity NEVER color-only (§8 anti-pattern): always icon + text label ("Generic" / "Technical") alongside the accent color.
- Streaming answer region: `aria-live="polite"` so SR users hear updates; `aria-busy` while streaming.
- Composer: visible `<label>` (not placeholder-only); textarea; Enter=send, Shift+Enter=newline; send button ≥44px.
- Focus: visible ring on composer, send, sample questions, source pills (all are `<button>`/`<a>`). No `outline:none` without replacement.
- Contrast: verify accent text on dark surface ≥4.5:1 (normal) / ≥3:1 (large + UI). Source pill text included.
- Touch targets ≥44px (send, sample chips, source pills).
- `prefers-reduced-motion`: wrap the typing-dots, handoff-pill, and any fade — reduce, don't harm.
- Links (source cards) open cited doc; external → `rel="noopener"`, announce new-tab.

## Responsive (375 / 768 / 1024 / 1280)
- Single column always (chat). Max content width ~760px centered on ≥768.
- 375px: source pills wrap; composer sticky bottom; no horizontal scroll; code blocks scroll-x within bubble.
- Thread scrolls; composer fixed at bottom; header compact.

## Conflicts raised (Step 1–7 vs SOP)
- None blocking. Note: dark-first is intentional (theme-dashboard); must still ship a light token set with no hardcoded hex (use CSS vars) to satisfy "dark mode/both visible" checks. Accent colors chosen for AA on both surfaces.

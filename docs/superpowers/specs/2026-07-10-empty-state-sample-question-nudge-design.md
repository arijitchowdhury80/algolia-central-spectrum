# Design: Empty-state sample-question nudge

## Problem

On `EmptyState.tsx` (shown before the first message), 4 sample-question chips
(one per section, from `activeInstance.sampleQuestions`) are already rendered
and clickable. Observed behavior: users ignore them and type their own first
question instead. Chips currently look visually inert — plain surface
background, muted secondary text, no label explaining what they're for. Only
the `:hover` state (border/text color shift) signals they're clickable, which
requires a mouse pass to discover.

## Why it matters

Self-typed first questions are more likely to be off-corpus, too vague, or
phrased in a way the agent can't ground — leading to refusals or weak answers
as a new visitor's first impression. Steering more first questions through
the curated chips increases the odds of a good, grounded first answer.

## Scope

Empty state only (`web/src/components/EmptyState.tsx`). The persistent
"✦ Sample questions" popover pill above the composer (`SampleQuestions.tsx`)
is a different job — letting users grab a sample mid-conversation — and is
explicitly out of scope for this fix, which targets the first-question
decision point only.

## Design

**1. Copy nudge.** Add one line between the H1 and the chip row:

> "Try one of these, or ask your own question below."

Styled `text-ac-xs text-ac-text-muted` — same weight as the existing
disclaimer line, so it reads as a quiet instruction, not a headline.

**2. Visual bump.** Promote the chips' existing `:hover` look to be their
resting look, so they read as actionable without needing a mouse pass:
- Background: `bg-ac-surface` → `bg-ac-accent-tint`
- Text: `text-ac-text-secondary` → `text-ac-text`
- Add the `→` arrow glyph already used by `SampleQuestions.tsx`'s popover
  buttons, for pattern consistency (not a new affordance language)

No layout restructuring, no new components. Pure copy + Tailwind class
changes inside the existing chip `<button>` map in `EmptyState.tsx`.

## Explicitly not doing

- Not touching `SampleQuestions.tsx` (the persistent popover pill) — different
  job, different scope, not justified by this problem statement.
- Not restructuring the empty-state layout (hero, chip row, disclaimer order
  stays the same).
- Not adding new components.

## Risk / open question carried forward

The visual bump might still not be loud enough to register against this
instance's actual background/surface contrast — can't fully judge from code
alone. Plan: ship this version, then check it live in a real browser before
deciding whether it needs to be louder. Do not escalate visual weight further
without first seeing this version render and fail.

## Testing

No new logic, no new state — this is a presentational change to static JSX.
No unit tests needed. Verification is a live browser check (per this
project's standing rule: verify UI changes in the actual served app, not by
reading the diff) — confirm the label renders, the chip resting style is
visibly different from before without hovering, and clicking a chip still
fires `onPick` correctly (existing behavior, must not regress).

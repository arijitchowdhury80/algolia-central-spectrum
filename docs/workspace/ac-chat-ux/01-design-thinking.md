# Design Thinking — Algolia-Central Chat UX (framework) · ACS instance #1

> Two levels throughout: **FRAMEWORK** (the reusable Algolia-Central shell) and **INSTANCE** (ACS = Adobe/Spectrum skin). Every decision states which layer owns it.

## Step 1 — Mental Model

**Dominant metaphor: a grounded "answer desk" — a focused chat with a receipts drawer.**
Not a dashboard, not a lab. The user carries a *"ask the docs and trust the answer"* model. One conversation column, front and center. The differentiator vs. ChatGPT: **every answer shows its receipts** — the exact source records it was grounded on — and you can see *which specialist* answered.

- **What the user expects to see:** a single clean chat, a prompt box, sample questions to start, streaming answers, and — the hook — source cards proving the answer came from the corpus, not a model's memory.
- **What would confuse them:** a multi-panel lab (AC2's 2×2 matrix), vendor jargon, or an answer with no visible grounding. Also confusing: not knowing *why* the answer changed voice when Generic hands off to Technical — so the handoff must be legible, not hidden.

**Framework vs instance:** the "answer desk with receipts + visible specialist handoff" is the FRAMEWORK's fixed identity. The *voice, logo, palette, and sample questions* are INSTANCE skin.

## Step 2 — Information Architecture (emphasis tiers)

| Element | Tier | Owner | Treatment |
|---|---|---|---|
| The current answer (streaming) | **Hero** | Framework | Largest reading surface, center column, generous measure |
| Prompt composer | **Primary** | Framework | Always reachable, docked bottom, obvious |
| Grounded source cards (receipts) | **Primary** | Framework | Directly under/beside the answer; the trust payload |
| Which agent answered + handoff | **Primary** | Framework | A legible badge/thread marker, not buried |
| Sample questions (empty state) | **Secondary** | Instance-copy | Prominent only when chat is empty; recede after first turn |
| Judge / confidence signal | **Secondary** | Framework | Present, on-demand drawer — not shouting over the answer |
| Header: product mark + corpus name | **Secondary** | Instance skin | Identity, quiet |
| Footer: corpus provenance, disclaimer, key-scope note | **Supporting** | Framework | Smallest |
| Timestamps, latency, token/frame debug | **Supporting** | Framework | Least prominent, dev-only toggle |

Tier-inflation guard: judge/confidence is **Secondary**, not Primary — it must never compete with the answer + its sources. Only ONE Hero (the answer).

## Step 3 — Interaction Flow

**3 most common actions (must be 1–2 clicks):**
1. Ask a question (type + enter, or click a sample question).
2. Read the answer + scan its source cards.
3. Open a source card / open the judge drawer for confidence.

**Happy path:**
1. Land on empty state → product identity + 4–6 sample questions.
2. Click a sample (or type) → answer streams token-by-token in the Hero.
3. Source cards populate as grounding frames arrive (`9:`/`a:`), proving retrieval.
4. If Generic routes to Technical, a visible handoff marker appears + the technical answer streams under it.
5. User reads; optionally opens the judge drawer or a source card. No dead end — composer is always ready for the next turn.

**States:**
- **Empty:** identity + sample questions + one-line "grounded on {corpus}" promise.
- **Loading/streaming:** skeleton for source cards; typing/stream indicator; agent badge resolves as frames arrive.
- **Error:** graceful inline ("couldn't reach the answer service — retry"), never a blank screen. Distinct from **refusal** (a valid grounded outcome: "not in the docs" is a *feature*, styled as an honest answer + a route, NOT an error).

## Step 4 — Cognitive Load Budget

Simultaneous chunks on a normal turn:
1. Header (identity) · 2. Answer (Hero) · 3. Source cards · 4. Agent/handoff marker · 5. Composer.
= **5 chunks. At budget, not over.**

Reduction strategy: Judge/confidence lives in an **on-demand drawer** (chunk only when opened). Sample questions **collapse** after the first turn. Debug/frame inspector is a hidden toggle. So the resting state stays ≤5.

## Step 5 — Emotional Journey

Arc: **curiosity → trust → confidence → reliance.**
- Empty state → *curiosity* ("what can this answer?") — carried by sample questions + a clean, credible identity.
- Streaming answer → *engagement* — carried by smooth token streaming (no spinner-then-dump).
- Source cards appear → *trust* — the emotional core; receipts convert "nice answer" into "I believe it."
- Visible handoff to Technical → *confidence* — "it knows when to bring in the specialist."
- Honest refusal when off-corpus → *reliance* — it won't bullshit me, so I can trust the yeses.

Components carrying the weight: **source cards** (trust) and the **handoff marker** (confidence). These are the two things a generic chatbot doesn't have — they are the product.

## Step 6 — Design Pre-Mortem

**Tigers (real UI risks) + mitigation:**
- *Looks "generic AI" gray* → mitigation: the skin layer forces a real design system (ACS = Spectrum tokens: Adobe fonts/color); the framework default theme still has a deliberate POV (not default Tailwind gray). Distinctive element = the receipts drawer + handoff thread.
- *Receipts overload* (dumping 10 raw records) → cap visible source cards (e.g. top 3–4) with "show all"; card = title + source badge + snippet, not the 90KB body.
- *Handoff ambiguous* → explicit thread marker: "Generic → routed to Technical" with distinct agent chips, not a silent voice change.
- *Breaks at 375px* → single-column collapses cleanly (chat is inherently mobile-friendly); source cards stack; judge drawer becomes full-screen sheet.
- *A11y* → agent chips/state never color-only (icon + label); composer + drawer keyboard-navigable; contrast AA enforced by token contract (skin themes must pass AA — a framework rule).
- *Dark mode breaks* → tokens.css ships light+dark values; skin overrides must supply both or inherit framework dark.

**Elephants (unspoken):**
- *The skin-swap is the whole thesis but untested* → de-risk: build framework default theme first, then prove the swap by dropping in a Spectrum theme file. If the swap is painful, the contract is wrong — catch it in instance #1, not #5.
- *Streaming protocol drift* → the Agent Studio frame format is an external contract; port AC2's `agentStudioClient` verbatim + protocol read-receipt before touching it. Don't regenerate the wire format from memory.
- *"Minimal" scope creep back into the AC2 lab* → hard line: no 2×2 matrix, no leaderboard. Port engine + source/judge concepts only.

## Cross-cutting: the two-layer contract (the actual framework)

- **Structure layer (framework, fixed):** `AppShell` (header/footer), `ChatColumn` (Hero answer + stream), `Composer`, `SourceCards`, `AgentThread/HandoffMarker`, `JudgeDrawer`, `SampleQuestions`, `EmptyState`. These consume ONLY `var(--token)` + a small `instanceConfig` (agent IDs, corpus name, copy, sample questions).
- **Skin layer (instance, swappable):** a `theme.css` (token values: color, font, radius, spacing, shadow) + assets (logo, imagery) + `instanceConfig`. "Apply Adobe Spectrum" = generate a Spectrum `theme.css` + config, drop it in, structure unchanged.
- **The contract = the token names in `tokens.css`.** Freeze that vocabulary early; it's the API between our structure and any client design system.

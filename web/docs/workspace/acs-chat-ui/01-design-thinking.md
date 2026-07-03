# Design Thinking — ACS Chat UI

## Step 1: Mental Model
**Dominant metaphor: "conversation with an expert pair."** The user carries a *chat* model (ChatGPT/Claude-style), but with a twist unique to this product: two named experts who visibly hand off to each other. A developer using Adobe Spectrum asks a question; a Generic assistant answers design/availability questions itself and *visibly passes* deep React-code questions to a Technical specialist.

- **Expects to see:** a single message thread, an input at the bottom, streaming answers, and — the differentiator — a clear "who is answering right now" signal plus source citations proving the answer is grounded (not hallucinated).
- **Would confuse them:** a 2×2 grid (that's AC2's eval tool, not this), multiple simultaneous panels, or hidden handoff (an answer silently changing voice with no marker). Grounding must be *visible* or the whole "strictly-grounded" value prop is invisible.

## Step 2: Information Architecture

| Element | Tier | Rationale |
|---|---|---|
| The streaming answer text (current turn) | **Hero** | The one thing the user came for. |
| Active-agent indicator (Generic / Technical) + handoff marker | **Primary** | Core differentiator; must be scannable per message. |
| User's question bubble + composer input | **Primary** | The action surface. |
| Grounded source cards (title + url + source facet) | **Primary** | Proof of grounding; the trust layer. |
| Prior turns in the thread | **Secondary** | Context, scrollable, visually subordinate to current turn. |
| Tool-call trace ("searched ReactSpectrumS2 → 6 hits") | **Secondary** | Evidence the search happened; collapsible. |
| Corpus/app footer, agent legend, timestamps | **Supporting** | Metadata. |

No tier inflation: sources are Primary (trust-critical) but rendered as compact pills, not walls of text.

## Step 3: Interaction Flow
**3 most common actions:** (1) type + send a question; (2) read the streamed answer; (3) click a source card to open the cited doc. All 1-click / effortless.

**Happy path:**
1. Land on empty state → 3–4 sample questions (design + code mix) invite a click.
2. User types "how do I build a controlled ComboBox in React Spectrum S2" → Enter.
3. Active-agent chip shows **Generic** thinking → tool trace "searching…" → Generic recognizes deep-code intent → **handoff marker** "Generic → Technical" → Technical streams real code.
4. Source cards render under the answer (grouped by `source` facet: ReactSpectrumS2 / ReactAria / SpectrumDesignDocs).
5. Composer stays focused for the next turn. No dead end.

**States:**
- **Empty:** hero prompt + sample questions + one-line "grounded in Adobe Spectrum docs" trust line.
- **Loading:** active-agent chip pulses; skeleton/typing indicator; tool-trace line appears as `9:` frames arrive.
- **Error (`3:` frame / network):** inline red-tinted card in the thread, "couldn't reach the agent — retry", retry button. Never a blank screen.

## Step 4: Cognitive Load Budget
Simultaneous chunks on screen (active turn): (1) answer text, (2) active-agent/handoff chip, (3) source pills row, (4) composer, (5) thread history (one visual block). = **5 chunks. At budget, not over.** Tool-trace is collapsed into the agent chip line (not a 6th chunk). Reduction strategy if it grows: collapse source pills behind a "3 sources" toggle on mobile.

## Step 5: Emotional Journey
Arc: **curiosity → confidence → trust.**
- Empty state: *curiosity/invitation* (sample questions, calm).
- Streaming: *engagement* (live tokens, the handoff moment is a small "oh, cool" beat — the product's personality).
- Answer + sources: *confidence → trust* (the citations are the payoff; "it's not making this up").
Emotional weight carried by: the **handoff marker** (personality/differentiation) and the **source cards** (trust).

## Step 6: Design Pre-Mortem
**Tigers:**
- *Generic-AI gray look* → mitigation: dark technical aesthetic (theme-dashboard), a distinctive per-agent accent color (Generic = indigo, Technical = teal), Adobe-Spectrum-adjacent restraint. One signature element: the animated **Generic→Technical handoff pill**.
- *Handoff invisible* → mitigation: explicit inline divider chip between the Generic segment and Technical segment of an answer, with both agent avatars and an arrow; agent color shifts.
- *Info overload on first view* → mitigation: empty state is just hero + 4 samples; complexity only appears after first send.
- *Breaks at 375px* → mitigation: single-column always; source pills wrap; composer sticky bottom; test at 375.
- *A11y* → mitigation: agent identity never color-only (always icon + text label); focus rings; 44px touch targets; AA contrast on dark surface; `aria-live=polite` on the streaming answer region.
- *Dark mode breaks* → this design is dark-first; provide a light token set too, no hardcoded hex.

**Elephants:**
- *No real user tested* → mitigate by keeping flow to the single most obvious pattern (chat) so it's self-evident.
- *Spec wrong (maybe user wants multi-turn agent memory)* → Agent Studio completions take `history`; we send prior messages[] so multi-turn works out of the box.
- *Slow first token* → show the active-agent chip + tool trace immediately so perceived latency is low even before `0:` text frames arrive.

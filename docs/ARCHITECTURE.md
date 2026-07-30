# ACS — Architecture & Code Map

A file-level map of the repo. For the big picture, see the [README](../README.md).

### Diagrams
The system-architecture and single-turn diagrams are the **Mermaid diagrams in the [README](../README.md#architecture)** — they render on GitHub and stay in sync with the code.

---

## Four independent pieces (updated 2026-07-29 — see `docs/DEPLOYING.md` for the full runbook)

| Piece | Dir | Ships to browser? | Talks to |
|---|---|---|---|
| **Vendored widget (PRIMARY, `/`)** | `vendor/algolia-central-chat-widget/` | ✅ — deployed via `scripts/deploy/build_prod_site.sh` → Vercel | Algolia Agent Studio (search-only key) + ACS's judge via public seams |
| **Chat app (secondary, `/app`)** | `web/` | ✅ (static bundle, based at `/app/`) | Algolia Agent Studio directly (search-only key) |
| **Grounding judge** | `lab/` (source) | ❌ — but **deployed**: `judge.contentengagement.info/acs`, `acs-lab-backend` container on the `chowmes` VPS | An LLM provider; called per answer with `x-lab-key`/`x-judge-api-key` auth |
| **Corpus + agent tooling** | `scripts/` | ❌ (dev/ops scripts) | Algolia indexing + Agent Studio admin APIs |

They are decoupled: either frontend runs without the judge (chip just stays inactive), and the corpus is built out-of-band by the scripts. `vendor/` is **read-only** — see `vendor/README.md` before touching anything in that tree.

---

## `web/` — the chat app (Vite + React + TS + Tailwind)

### Entry + shell
| File | Role |
|---|---|
| `src/main.tsx` | React entry point. |
| `src/App.tsx` | Entry: validates env at startup (renders a "Configuration error" card on failure), then renders `ChatApp`. |
| `src/types.ts` | Shared types: `ChatTurn`, `AnswerSegment`, `AnswerSource`, `HistoryEntry`. |
| `index.html`, `vite.config.ts`, `tailwind.config.ts`, `postcss.config.js`, `tsconfig*.json` | Build/config. |

### `src/hooks/` — orchestration (the core logic)
| File | Role |
|---|---|
| `useChat.tsx` | **The app's brain.** Drives the chat with `react-instantsearch` `useChat` (×2 — one Generic, one Technical `type:'technical'`) and exposes the `UseChatResult` interface the UI consumes, so `ChatPanel`/`ChatMessage` render from it directly. Flow: Generic → classifier (on the `onFinish` callback, via `lib/classifier.ts`) → `deriveOfferState` → user consent → the Technical hook, grafted onto the turn as `segments[1]`; finished technical answers are kept per-turn (`technicalByTurn`) so multiple deep-dives coexist. Judge + cost need no wiring here — `ChatMessage` runs them per segment. **Two invariants:** the search `tools` must be registered (`createDefaultTools`) or the agent's server-side tool-call hangs; `onFinish` must be `useCallback`-stable or the hook re-inits every render. |
| `useJudge.ts` | Fetches an on-demand grounding verdict for a given answer from the judge service. |
| `useCostRecording.ts` | Records per-segment cost (exact judge tokens once the verdict resolves, estimated agent cost otherwise) into the cost store — called by `ChatMessage` per segment, so cost needs no per-call wiring. |

### `src/lib/` — plumbing
| File | Role |
|---|---|
| `chatTurns.ts` | The engine↔UI adapter. Pure `messagesToTurns(messages, status)` maps `useChat` render state → the `ChatTurn[]` contract the UI consumes; plus `buildSegment`/`latestAssistant` (shared by the Generic mapper and the Technical baton leg). |
| `chatMessage.ts` | Pure helpers over a chat message's `parts`: `answerText`, `sourcesFromParts`, `rawHitsFromParts`, `questionFromMessages` (recover the question a given assistant answer responds to), `canClassify` (offer guard). |
| `offer.ts` | Pure deep-dive-offer logic — `extractDeepDiveOffer`, `deriveOfferState` (single source of truth so `deepDiveOffered`/`deepDiveQuery` can't disagree). |
| `agentStudio.ts` | Agent Studio HTTP client (`compatibilityMode=ai-sdk-4`), accumulates the response + retries once on the empty-completion flake (`callWithRetry`). Used by the **classifier's** non-streaming call (`classifier.ts`). The Generic/Technical chat streams via `react-instantsearch` (`ai-sdk-5`), not this client. |
| `agents.ts` | Reads + validates the two required env vars (`VITE_ALGOLIA_APP_ID`, `VITE_ALGOLIA_SEARCH_API_KEY`); resolves per-agent `CompletionsConfig` (including the classifier's) from the active instance. |
| `classifier.ts` | The offer-classification call: builds the `QUESTION/GENERIC'S ANSWER/RETRIEVED HITS` composite query the classifier agent expects, and parses its one-line response into a suggestions array `offer.ts` consumes. |
| `sources.ts` | `normalizeHit`, `groupSources`, `totalSources` — turns raw Agent Studio hits into deduped, facet-grouped `AnswerSource[]` for the source pills. Facet grouping comes from the active instance's `sourceFacets` — anything not listed there buckets into "Other". |
| `judgeClient.ts` | Client for the judge service (`POST /api/judge`, base URL from `VITE_JUDGE_URL` or `http://localhost:8788`). Sends `x-lab-key` from `VITE_LAB_API_KEY`; types `JudgeDims` as `Record<string, number>` so it renders whatever dimension(s) the backend returns (currently `{usefulness}`). `JudgeFlaggedClaim`/`JudgeCluster` carry the corroboration-gate fields (`judgeIds`, `sourceId`, `excerpt`, `excerptVerified`). |

### `src/config/` — the instance contract (what makes it templatizable)
| File | Role |
|---|---|
| `instance.ts` | The typed `InstanceConfig` contract: branding, agent identities (including the classifier), sample questions, source facets, copy. Structure components read **only** from here — nothing is hardcoded. |
| `instances/spectrum.ts` | The concrete ACS instance: brand (Algolia Central × Adobe Spectrum), the **three** live Agent Studio agent IDs (generic/technical/classifier), grouped sample questions, and the 3 real `source` facets (verified against the live index — no `ReactAria` facet exists in the data). |
| `active.ts` | Wires the active instance + its theme together (imports `spectrum` + `themes/algolia-adobe.css`). Swapping instances = change this one file. |

### `src/components/` — presentational UI
| File | Role |
|---|---|
| `ChatApp.tsx` | **The app shell.** Lays out the header (`AppHeader` + Cost), `ChatPanel`, `SampleQuestions`, `Composer`, and the `JudgeDrawer` overlay, wrapped in `<InstantSearch>` and driven by `useChat`. |
| `AppHeader.tsx` | Co-brand header (Adobe logo + "Search by Algolia"); logo click resets the session. |
| `ChatPanel.tsx` | Scrolling list of turns; shows `EmptyState` when idle. |
| `ChatMessage.tsx` | Renders one turn's answer segment(s) with its heading band; runs `useJudge` per answer and shows the `ConfidenceChip` bottom-right of the sources. |
| `Composer.tsx` | The input box + Send button. |
| `SampleQuestions.tsx` | Grouped, sectioned sample-question popover above the composer — for grabbing a sample mid-conversation. |
| `EmptyState.tsx` | First-load hero (eyebrow + heading + a "try one of these" copy nudge + one resting-style chip per section, so they read as actionable without a hover). |
| `DeepDivePrompt.tsx` | The human-gated deep-dive **consent** card ("Want me to bring in the code specialist?"), shown when the classifier returns an offer. |
| `DiscoveryCard.tsx` | "You might also ask →" card for the classifier's plain follow-up response. |
| `SourcePills.tsx` | Grouped source citations with per-facet count badges. |
| `ThinkingIndicator.tsx` | Phased status animation during the pre-text dead-air. |
| `ErrorCard.tsx` | Answer-level error / empty-answer fallback ("No response — try again"). |
| `ConfidenceChip.tsx` | The composite judge score shown on each finished answer ("scoring…" → "Confidence N.N", "⚠ N flagged" when the corroboration gate trips). Click → opens the drawer. |
| `JudgeDrawer.tsx` | Right slide-over with the full verdict: composite + gate badge (GROUNDED / BORDERLINE / UNSUPPORTED), the Usefulness dimension bar, the **3 judges as collapsed accordions** (Skeptic / Referee / Advocate), flagged claims — each showing which/how-many judges corroborated it and its traceable source excerpt with an `excerptVerified` badge when present — and the synthesis rationale. Dims render dynamically from whatever the backend returns (`orderedDims`, exported + unit-tested). |
| `CostBadge.tsx` | Per-answer cost callout next to the Confidence chip — EXACT judge token cost (once its verdict resolves with usage) and ESTIMATED agent cost, never merged. |
| `CostPage.tsx` | Session-wide cumulative cost, reachable from the header nav — totals broken out by kind (agent/judge) and method (ESTIMATED/EXACT). |
| `MessageMarkdown.tsx` | Markdown renderer for answer text (groups consecutive lines into same-kind runs — prose/bullet/ordered — rather than classifying a whole block as one unit). |
| `AgentBadge.tsx`, `PoweredByAlgolia.tsx` | Small attribution/labelling atoms. |

### `src/themes/` + `src/styles/`
| File | Role |
|---|---|
| `themes/algolia-adobe.css` | **Active skin** — Algolia design system (Sora via Google Fonts, Nebula Blue `#003DFF`) over the Adobe corpus. |
| `themes/algolia.css`, `themes/spectrum.css` | Alternate skins. |
| `styles/tokens.css` | `--ac-*` design tokens components read via `var()` (never raw hex). |

---

## `lab/` — the grounding judge stack

### `lab/judge/src/` — provider-agnostic judge library
| File | Role |
|---|---|
| `index.ts` | Public entry — run a full judge pass. |
| `judge.ts` | Orchestrates a single judge run. |
| `rubric.ts` | ONE scored dimension, `usefulness` (1-10, "does this give the person everything they need to act on their question?"). Grounding is not scored — it's purely the gate below. `ALGOLIA_ANSWER_RUBRIC`, `USEFULNESS_DESCRIPTION`, `DEFAULT_GATE` (cap 3, verifiedConfidence 0.7, corroborationThreshold 2, claimSimThreshold 0.5) live here. |
| `claimGate.ts`, `gate.ts` | The **corroboration gate**: a `contradicted` (never `unverifiable`) flag at ≥0.7 certainty is gate-eligible; flags are clustered by claim similarity across judges, and only a cluster flagged by **≥2 distinct judges** caps the score (`evaluateCorroborationGate`). A solo flag surfaces as `soloFlags`/`borderline` and never caps — the direct fix for the 9/9/9→3.10 solo-Skeptic bug. |
| `excerptCheck.ts` | Deterministic (non-LLM) post-validator: `verifyExcerpts` confirms a flag's quoted `excerpt` is a real verbatim (whitespace-normalized) substring of its cited `sourceId`'s text, setting `excerptVerified`. A non-empty excerpt that fails verification is demoted — not gate-eligible. |
| `parse.ts` | Parses the judge LLM's structured verdict, carrying `sourceId`/`excerpt` through. |
| `synthesis.ts`, `aggregate.ts` | Combine per-claim/per-dimension results into a final verdict; `aggregateRounds` pools the corroboration gate across rounds and exposes `corroboratedClusters`/`soloFlags`/`borderline` on `RoundAggregate`. |
| `calibration.ts` | The validity gate — checks the judge's rankings agree with a human's (Spearman correlation on ~12 representative answers) before its scores are trusted as authoritative rather than directional. This is the "P2b calibration" referenced throughout the project's session notes as never yet run. |
| `prompt.ts` | The judge prompt template — one dimension + the excerpt-quoting instruction (`JUDGE_OUTPUT_CONTRACT`). |
| `types.ts` | Judge types, including `CorroboratedCluster`/`GateOutcome` and `LlmUsage` (exact token counts from the provider's own response). |

### `lab/server/src/` — HTTP wrapper
| File | Role |
|---|---|
| `judge/judgeService.ts`, `judge/judgeHandler.ts`, `judge/judgeCli.ts`, `judge/liveJudge.ts` | Serve `POST /api/judge` (`npm run judge:serve`, port 8788 — local dev only, see [Three independent pieces](#three-independent-pieces) above). `liveJudge.ts`'s `toVerdict` maps the rubric mean to `VerdictDims` (`{usefulness}`) and flattens `RoundAggregate.corroboratedClusters`/`soloFlags` into the wire verdict's `violations`/`flaggedClaims` (any judge can flag; corroboration, not temperament, decides what caps). |
| `judgeLlm.ts`, `activeJudgeLlm.ts` | LLM-call plumbing shared across judge runs. |
| `usage.ts` | Accumulates each call's exact `LlmUsage` into a per-request `UsageSummary` (`calls`, `totalInputTokens`, `totalOutputTokens`, `estimatedCostUsd`), attached to `/api/judge` responses. |
| `provider.ts`, `gemini.ts`, `openai.ts` | Pluggable LLM providers. |
| `auth.ts`, `config.ts` | Server auth + config. |

---

## `scripts/` — corpus + agent tooling (not shipped)

### `scripts/crawler/`
| File | Role |
|---|---|
| `ingest_site.mjs` | Ingest a site that publishes `llms.txt` / `.md` twins. |
| `crawl_html.mjs` | BFS self-fetch + `<main>` extract for server-rendered sites (no Scout needed; how V3 was ingested). |
| `ingest_git_docs.mjs` | Ingest Markdown docs from a Git repo. |
| `provision.mjs` | Provision/configure the Algolia index. |

### `scripts/agents/`
| File | Role |
|---|---|
| `build_acs_agents.mjs` | Create/PATCH the Generic + Technical + Classifier Agent Studio agents in place (never delete+recreate, so IDs stay stable). |
| `agentConfig.mjs` | The single source of truth for agent config: the `PERSONAS` list (name, filter, prompt file), `MAIN_MODEL`, clone-base logic. |
| `update_agent_model.mjs` | Swap an agent's model (used to move off the deprecated `gemini-2.5-flash-lite`). |
| `instructions_generic.md`, `instructions_technical.md`, `instructions_classifier.md`, `_shared_grounding_acs.md` | The agents' system instructions (grounding rules live in the shared file; the classifier's own decision logic is in its own file). |
| `suggestions_generic.md`, `suggestions_technical.md` | Native `config.suggestions` prompts (Generic + Technical each generate their own follow-up suggestions). The Generic→Technical deep-dive *offer* is a separate mechanism — the classifier agent, not native suggestions. |

### `scripts/neural/`
| File | Role |
|---|---|
| `seed_and_enable.mjs` | Enable neural (semantic) search on the index and seed embeddings. |

---

## Personalization (future) — injected user-profile block

**Status: NOT YET IMPLEMENTED.** A framework capability for real-product Algolia-Central instances — deliberately *not* built into the demo. Captured here so the design travels with the template.

**The pattern (borrowed from how claude.ai does memory).** Keep one small (~100-token) structured profile per user — role, framework, version preference (e.g. Spectrum S2 vs v3), preferred answer style — and **prepend it as the first history entry on every turn**. The agent then tailors answers without re-asking. This mirrors claude.ai's design: a tiny distilled profile injected into context each session, rather than replaying whole past conversations. Deep recall of past chats (if ever wanted) is a separate, on-demand retrieval concern.

**Where it plugs in:**
- **Contract seam:** `web/src/config/instance.ts` → the optional `personalization?: { profileFields; userEditable? }` field (commented, unimplemented). This is the discoverable shape; no code reads it yet.
- **Populate cheaply:** deterministic extraction from the user's messages (mentions of "S2", "TypeScript", "Next.js"), or extend the existing classifier call (`web/src/lib/classifier.ts`) to emit profile updates — no new per-turn LLM call required.
- **Store:** client-side (localStorage, or the chat client's own persistence). Make it **user-visible and editable** — opaque memory erodes trust, and an editable profile is a strong demo moment.

**Critical constraint:** when this is built, it must share ONE persistence layer with the chat history, not add a second. See `docs/design/message-history-persistence.md` (deferred) and the native-`<Chat>` persistence decision in the swap plan.

## Where to start reading

1. `web/src/hooks/useChat.tsx` + `web/src/components/ChatApp.tsx` — the current native engine + shell (turn orchestration + classifier-driven offer flow).
2. `web/src/lib/chatTurns.ts` — the pure adapter mapping `useChat` state → the production `ChatTurn[]` the UI renders.
3. `web/src/lib/classifier.ts` — the offer-classification call itself.
4. `web/src/config/instances/spectrum.ts` — what this instance is (agents, sources, sample questions).
5. `lab/judge/src/rubric.ts` + `gate.ts` — how grounding is gated + scored.

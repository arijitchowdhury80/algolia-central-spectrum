# Architecture & code map

A file-level map of the repository. For the system overview and diagrams, see the [README](../README.md).

---

## Three independent pieces

| Piece | Directory | Ships to the browser? | Talks to |
|---|---|---|---|
| **Widget site** (`/` and `/demo/`) | `vendor/algolia-central-chat-widget/` + `web-widget/` | Yes — built by `scripts/deploy/build_prod_site.sh`, hosted on Vercel | Agent Studio (search-only key) and the judge service |
| **Grounding judge** | `lab/` | No — runs as an HTTP service on its own host | An LLM provider; called per answer, authenticated with `x-lab-key` / `x-judge-api-key` |
| **Corpus and agent tooling** | `scripts/` | No — operator scripts | Algolia indexing and Agent Studio admin APIs |

They are decoupled. The front end runs without the judge — the confidence chip simply stays inactive. The corpus is built out of band by the scripts.

`vendor/` is **read-only**. Read [`vendor/README.md`](../vendor/README.md) before touching anything in that tree.

---

## `vendor/algolia-central-chat-widget/` — the widget (read-only)

Algolia engineering's chat widget, vendored unmodified. Three packages.

### `chat-central/src/` — the React chat UI and its InstantSearch plumbing

| File | Role |
|---|---|
| `chat/useChat.ts` | The turn engine. Primary agent → classifier → optional specialist deep-dive. Sends the host's visitor context to the answering agents **and** to the classifier. |
| `chat/ChatWidget.tsx` | Panel shell — open/close state, size mode, proactive greeting placement. |
| `chat/lib/classifier.ts` | Builds the classifier's composite query (question, answer, retrieved hits, visitor context) and parses its `SPECIALIST:` response. |
| `chat/lib/sources.ts` | Normalises raw hits into deduplicated, facet-grouped source pills. |
| `chat/components/` | Presentational components — `ChatMessage`, `SourcePills`, `DeepDivePrompt` (the consent card), `ProactiveGreeting`, `SampleQuestions`, `EmptyState`, `Composer` and friends. |
| `config/proactive.ts` | Module-scope store for persona override, greeting, analyzing state and the visitor's auto-engage preference. |
| `config/visitorContext.ts` | Holds the host-registered context provider. `composeVisitorMessage()` prepends the context block to the wire message only — the transcript keeps the visitor's own words. |
| `config/instance.ts`, `defaults.ts`, `active.ts`, `runtime.ts`, `strings.ts` | The instance contract: branding, agents, copy, and the attribute-to-config merge. `active.ts` is an external store, so an attribute change re-renders. |
| `judge/` | The widget's own in-browser judge engine and its badge. This deployment bypasses it in favour of the hosted judge in `lab/`. |
| `chatRenderer.tsx`, `chatWidget.ts`, `agentWidget.ts`, `chatConfidenceWidget.ts`, `connectChat.ts` | InstantSearch connector layer that streams agent and confidence descriptors into the React tree. |

### `algolia-chat/src/` — the distributable web component

| File | Role |
|---|---|
| `chat-embed.tsx` | Defines `<algolia-chat>`. Parses attributes and slots, builds the Shadow DOM, and exposes the imperative host API: `setContextProvider()`, `engage()`, `setPersona()`, `setAnalyzing()`. Calls made before the React tree mounts are buffered and replayed. |
| `chat/AgentElement.ts` | `<algolia-agent>` — declarative agent config for both chat and judge roles. |
| `chat/ConfidenceElement.ts` | `<algolia-chat-confidence>` — judge panel configuration. |
| `instantsearch/InstantSearchElement.ts` | `<algolia-instant-search>` — root element owning the search client. |
| `judge/badge/ConfidenceBadgeElement.ts` | `<algolia-confidence-badge>` — the verdict chip. |

### `website/public/` — the static site

| Path | Role |
|---|---|
| `index.html` | Marketing page, served at `/`. |
| `demo/*.html` | Five simulated Adobe Spectrum documentation pages, served at `/demo/`. |
| `context/context-engine.js` | The host-side proactive engine: tracks reading behaviour, calls the concierge agent, registers the context provider, renders the persona selector. |
| `context/personas.js` | Persona catalogue. Seeds the stored profile; never read on the way to an agent. |
| `context/agents.generated.json` | Concierge and persona agent IDs consumed by the context engine. |

---

## `web-widget/src/` — the host-page enhancement layer

Compiled to `acs-enhance.js` and injected into every widget-hosting page at build time. Two files.

| File | Role |
|---|---|
| `main.ts` | Sets the panel size mode per surface (docked under `/demo/`, normal elsewhere) and repoints the confidence panel at the hosted judge. Runs **synchronously**, before the widget bundles load, because the custom elements capture their configuration when they upgrade. |
| `main.test.ts` | Pins both decisions — the judge repointing and the per-surface mode. |

---

## `lab/` — the grounding judge

### `lab/judge/src/` — provider-agnostic judge library

| File | Role |
|---|---|
| `detGround.ts` | **The deterministic grounding gate** — the check that decides the served verdict. A verbatim comparison over term classes that cannot be legitimately paraphrased (code identifiers, scaled numbers, CamelCase API names). Prose is excluded by design. Zero tokens, same answer every time. |
| `rubric.ts` | `ALGOLIA_ANSWER_RUBRIC` — one scored dimension, `usefulness`. Grounding is not scored; it is gated. Also holds `DEFAULT_GATE`. |
| `gate.ts`, `claimGate.ts` | The corroboration gate. A `contradicted` flag at or above the certainty threshold is gate-eligible; flags are clustered by claim similarity, and only a cluster raised by **two or more distinct judges** caps the score. A lone flag surfaces as borderline and caps nothing. |
| `excerptCheck.ts` | Deterministic post-validator confirming a flagged claim's quoted excerpt is a real verbatim substring of the source it cites. A non-empty excerpt that fails is demoted and cannot gate. |
| `judge.ts`, `index.ts` | Orchestrate a judge run; public entry point. |
| `prompt.ts` | The judge prompt template. The rubric travels with each request, which is why the agents stay rubric-agnostic. |
| `parse.ts` | Parses the structured verdict, carrying source ID and excerpt through. |
| `synthesis.ts`, `aggregate.ts` | Combine per-claim and per-dimension results into a final verdict. |
| `calibration.ts` | The validity gate — Spearman correlation between the judge's rankings and a human's, on a small representative set. Until it passes, scores are directional, not authoritative. **Not yet run.** |
| `trace.ts`, `types.ts` | Run tracing; judge types including gate outcomes and exact token usage. |

### `lab/server/src/` — the HTTP service

| File | Role |
|---|---|
| `judge/judgeService.ts` | The server. Routes, auth, rate limiting, `/health`. |
| `judge/judgeHandler.ts` | `POST /api/judge` — the full panel. Cost-bearing. |
| `judge/groundHandler.ts` | `POST /api/ground` — the deterministic gate alone. No LLM calls, so no cost. |
| `judge/liveJudge.ts` | Maps a judge run onto the wire verdict, flattening corroborated clusters and solo flags. |
| `judge/judgeCli.ts` | Command-line entry for scoring without the HTTP layer. |
| `provider.ts`, `openai.ts` | Pluggable model providers. |
| `judgeLlm.ts`, `activeJudgeLlm.ts` | LLM-call plumbing shared across runs. |
| `usage.ts`, `llmRates.ts` | Exact per-call token accounting and pricing. |
| `auth.ts`, `config.ts`, `buildInfo.ts` | Shared-secret auth, env resolution, and the build SHA reported by `/health`. |

---

## `scripts/` — corpus and agent tooling (not shipped)

### `scripts/crawler/`

| File | Role |
|---|---|
| `ingest_site.mjs` | Ingest a site publishing `llms.txt` / `.md` twins. |
| `crawl_html.mjs` | Breadth-first self-fetch and main-content extraction for server-rendered sites. |
| `ingest_git_docs.mjs` | Ingest Markdown docs from a Git repository. |
| `provision.mjs` | Provision and configure the index. |
| `repair_citation_urls.mjs` | Rewrite record citation URLs to public pages where one exists. Writes a baseline snapshot before touching any record. |

### `scripts/agents/`

| File | Role |
|---|---|
| `build_acs_agents.mjs` | Create or PATCH the answering agents in place — never delete and recreate, so IDs stay stable. |
| `agentConfig.mjs` | Agent configuration: the persona list, filters, prompt files, model constant. |
| `patch_agent_instructions.mjs` | Update a live agent's instructions without touching the rest of its config. |
| `update_agent_model.mjs` | Change an agent's model. |
| `snapshot_panel_agents.mjs` | Capture the live agents' configuration to disk before a change. |
| `restore_agent_from_snapshot.mjs` | Restore an agent from such a snapshot. |
| `setup_provider_inference.mjs` | Register the inference provider used by the agents. |
| `instructions_*.md`, `judge/instructions_judge_*.md`, `_shared_grounding_acs.md`, `suggestions_*.md` | The agents' system instructions. Grounding rules live in the shared file. |

### `scripts/neural/`, `scripts/widget/`, `scripts/deploy/`, and root

| File | Role |
|---|---|
| `neural/seed_and_enable.mjs` | Enable NeuralSearch on the index and seed embeddings. |
| `widget/build_demo_site.mjs` | Assemble the deployable site: copy the vendored site, add the widget bundles its own build omits, and inject the enhancement script into every page hosting the widget. |
| `deploy/build_prod_site.sh` | The production build Vercel runs. Fails loudly on a missing judge URL or key, on a widget page reaching the output without the enhancement script, and on missing proactive context assets. |
| `mint_search_key.mjs` | Mint a browser-safe, search-only API key. |

---

## `deploy/` — judge service deployment

| Path | Role |
|---|---|
| `vps-deploy-judge.sh` | Build and restart the judge container on the host. |
| `vps-judge/Dockerfile`, `docker-compose.yml` | The service image and its compose definition. |
| `vps-judge/Caddyfile.snippet.example` | Reverse-proxy configuration, applied by hand. |
| `vps-judge/.env.example` | Required environment variables. |
| `systemd/` | Timer and service units for scheduled redeployment. |

---

## Where to start reading

1. [`README.md`](../README.md) — the system and its diagram.
2. `vendor/…/chat-central/src/chat/useChat.ts` — the turn engine: primary → classifier → specialist.
3. `vendor/…/website/public/context/context-engine.js` — how reading behaviour becomes agent context.
4. `web-widget/src/main.ts` — what this deployment changes about the widget, and why the ordering matters.
5. `lab/judge/src/detGround.ts` and `gate.ts` — how grounding is decided.

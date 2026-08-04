# @algolia-central/chat-central

**Chat Central** is the complete widget engine for the `<algolia-chat>` experience. It is consumed by the sibling [`algolia-chat`](../algolia-chat) package (the custom-element / attribute layer), which bundles it from source into the final IIFE.

`chat-central` contains:

| Layer                    | Contents                                                                                                                                                 |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **IS plumbing**          | `connectChat`, `connectAgent`, `connectChatConfidence`, `connectChatPerson` connectors; matching widget factories; React renderer harness |
| **React UI**             | `ChatWidget` + all components (`AppHeader`, `ChatPanel`, `ChatMessage`, `Composer`, `SourcePills`, `JudgeDrawer`, …)                                     |
| **Configuration system** | `InstanceConfig`, `RuntimeConfig`, `WidgetStrings`, `defaultInstance`, `applyRootConfig`, `applyRuntimeConfig`, `mergeStrings`                           |
| **Tool loop**            | `runToolLoop` (ai-sdk-5 streaming + client-side tool round-trip), `ToolRegistry`, `ToolHandler`; canonical `client_side` tool configs in `tools/schemas.js` |
| **Chief judge**          | `chiefJudge.ts` — runs `consult_skeptic/referee/advocate` tools against the chief judge orchestrator; `hostedJudgeClient`; `useJudge`                    |
| **Person agent**         | Pluggable `VisitorDataSource` interface, `localStorageSource` adapter, `personAgent.ts` (resolves holistic profile via sub-agent tools)                  |
| **Shared transports**    | Agent Studio completions client (`agentStudio.ts`, ai-sdk-5 SSE parser) + env plumbing (`agents.ts`)                                                    |
| **Style helpers**        | `buildWidgetStyles(opts?)`, `ensureWidgetFont(fontHref?)`, CSS tokens + theme                                                                            |

The `<algolia-chat>` custom element (algolia-chat package) reads HTML attributes, calls the config helpers, and passes no `component` to `chatWidget` — it defaults to the built-in `ChatWidget` exported from here.

---

## What's in the box

### IS connectors + factories

| Export                                          | Purpose                                                                                                                                                      |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `connectChat`                                   | Chat lifecycle connector. Aggregates `chatAgents` + `chatConfidence` + `judgeAgents` + `chatPerson` from IS `renderState` and pushes updates to the reactive `WidgetStore`. |
| `chatWidget({ container, apiRef, component? })` | Wires `connectChat` + React renderer. `component` defaults to the built-in `ChatWidget`.                                                                     |
| `createChatRenderer`                            | UI-agnostic React mount/unmount harness.                                                                                                                     |
| `connectAgent`                                  | Unified connector for all three agent contexts. Publishes into `renderState.chatAgents`, `renderState.judgeAgents`, or `renderState.personAgents` per the `context` param. |
| `agentWidget`                                   | Ready-to-register agent widget.                                                                                                                              |
| `connectChatConfidence`                         | Config-only carrier. Publishes `{ mode, agents, url, apiKey }` into `renderState.chatConfidence`.                                                            |
| `chatConfidenceWidget`                          | Confidence widget factory. Accepts an optional `container` — mounts `<algolia-confidence-badge>` and keeps it live via `algolia-verdict` events.             |
| `connectChatPerson`                             | Person orchestrator connector. Publishes `PersonConfig` into `renderState.chatPerson`.                                                                       |
| `chatPersonWidget`                              | Person orchestrator widget factory. Wire as a child of `chatWidget`.                                                                                         |
| `ALGOLIA_VERDICT_EVENT`                         | `'algolia-verdict'` — `CustomEvent` name dispatched on `document` by `useJudge`.                                                                             |

### Tool loop + registry

| Export                                               | Purpose                                                                                  |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `runToolLoop(config, request, registry, opts?)`      | Stream-and-tool-loop against an Agent Studio agent (ai-sdk-5). Handles up to `maxSteps` tool calls; per-tool `toolTimeoutMs` safety guard. Returns `ParsedCompletion`. |
| `ToolRegistry`                                       | `Record<string, ToolHandler>` — map of tool name → async handler function.               |
| `ToolHandler`                                        | `(input: Record<string, unknown>) => Promise<unknown>` — single tool handler signature.  |
| `RunToolLoopOptions`                                 | `{ maxSteps?, toolTimeoutMs? }` — loop safety parameters.                                |

### Person agent

| Export                                               | Purpose                                                                                  |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `setVisitorDataSource(source)`                       | Swap in a custom `VisitorDataSource` (e.g. CDP, session endpoint) to replace the default `localStorage` adapter. |
| `getVisitorDataSource()`                             | Resolve the current data source (falls back to `localStorageSource`).                    |
| `VisitorDataSource`                                  | Interface: `{ getProfile(), getEvents(), getSessionPages() }`.                           |
| `buildPersonToolRegistry(config, subAgents)`         | Build the `ToolRegistry` for `get_profile_information`, `get_user_events`, `get_session_pages` handlers. Used internally by `personAgent.ts`. |

### Built-in React UI

| Export            | Purpose                                                                   |
| ----------------- | ------------------------------------------------------------------------- |
| `ChatWidget`      | The default chat component: FAB button + modal with full chat experience. |
| `ChatWidgetProps` | Props for `ChatWidget` (`apiRef?`, `widgetStore?`).                       |

### Configuration system

| Export                         | Purpose                                                                                                         |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `defaultInstance`              | Neutral scaffold `InstanceConfig` (all defaults; override via `applyRuntimeConfig`).                            |
| `activeInstance`               | Module-global singleton `InstanceConfig` that components read from. Mutated by `setActiveInstance`.             |
| `applyRootConfig(env)`         | Set credentials (`appId`, `searchKey`, `indexName`). Called by `<algolia-instant-search>`.                      |
| `applyRuntimeConfig(config)`   | Merge display config (branding, strings, sampleQuestions, …) into `activeInstance`. Called by `<algolia-chat>`. |
| `mergeStrings(base, override)` | Deep-merge partial `WidgetStrings` overrides into the English defaults.                                         |
| `interpolate(template, vars)`  | Substitute `{varName}` tokens in a string.                                                                      |
| `defaultStrings`               | All English default label values.                                                                               |
| `RuntimeConfig`                | Shape of display config passed to `applyRuntimeConfig`.                                                         |
| `InstanceConfig`               | Full instance configuration contract.                                                                           |
| `WidgetStrings`                | All user-facing text, grouped by component.                                                                     |
| `DeepPartial<T>`               | Recursive partial helper used for string overrides.                                                             |

### Style helpers

| Export                        | Purpose                                                                                                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `buildWidgetStyles(opts?)`    | Build the full `<style>` string for the shadow DOM: tokens + theme + Tailwind. Pass `accentColor` (hex) to override `--algolia-accent` and companion tokens. |
| `ensureWidgetFont(fontHref?)` | Inject Google Fonts `<link>` into `document.head` once. Defaults to Sora + JetBrains Mono.                                                                   |
| `hexToRgbTriplet(hex)`        | Convert hex color to `r, g, b` triplet string for CSS custom properties.                                                                                     |
| `DEFAULT_FONT_HREF`           | Default Google Fonts URL.                                                                                                                                    |

### Judge types

| Export                                        | Purpose                                                                |
| --------------------------------------------- | ---------------------------------------------------------------------- |
| `JudgeVerdict`                                | Full judge result shape (composite, dims, flaggedClaims, perJudge, …). |
| `JudgeMode`                                   | `'algolia' \| 'hosted' \| 'off'`                                       |
| `JudgeRole`, `JudgeDims`, `JudgeDimension`, … | Supporting judge types.                                                |

---

## Architecture

```
algolia-chat (custom element layer)
  │
  │  HTML attributes  ──► applyRootConfig / applyRuntimeConfig
  │  buildWidgetStyles / ensureWidgetFont
  │  chatWidget({ container, apiRef })  ← no component arg, defaults to ChatWidget
  │
  ▼
chat-central (widget engine)
  ├── connectChat → WidgetStore → ChatWidget (React tree)
  │                               ├── useChat
  │                               │     └── runToolLoop ── Agent Studio (ai-sdk-5)
  │                               │           ├── ask_specialist → specialist agent
  │                               │           └── get_visitor_profile → personAgent
  │                               │                 └── runToolLoop → person orchestrator
  │                               │                       ├── get_profile_information
  │                               │                       ├── get_user_events
  │                               │                       └── get_session_pages
  │                               └── useJudge ── hostedJudgeClient / chiefJudge
  │                                                 └── runToolLoop → chief judge agent
  │                                                       ├── consult_skeptic
  │                                                       ├── consult_referee
  │                                                       └── consult_advocate
  ├── connectAgent → renderState.chatAgents / judgeAgents / personAgents
  ├── connectChatConfidence → renderState.chatConfidence
  └── connectChatPerson → renderState.chatPerson
```

`connectChat` merges the leaf agent buckets into their parent descriptors during the
render phase: `judgeAgents` → `chatConfidence.agents` and `personAgents` → `chatPerson.agents`.
Leaves publish themselves rather than parents reading the DOM, because the HTML parser
upgrades a custom element at its start tag — a parent inspecting its children from
`connectedCallback` would find an empty list.

### ai-sdk-5 transport

All Agent Studio calls use `compatibilityMode=ai-sdk-5` SSE events:

```
data: {"type":"text-delta","delta":"..."}
data: {"type":"tool-input-available","toolCallId":"call_1","toolName":"ask_specialist","input":{...}}
data: {"type":"finish-step"}
```

`runToolLoop` handles the parse–execute–append–re-POST cycle automatically. Tool results are sent back as an assistant message with ai-sdk-5 tool parts — ``type: `tool-${toolName}` ``, `toolCallId`, `state: "output-available"`, `input`, `output`. The ai-sdk-4 spelling (`type: "tool-invocation"`, `toolInvocationId`, `state: "result"`, `args`/`result`) is rejected by the API with a 422. Set `maxSteps` (default 4) and `toolTimeoutMs` (default 30 000 ms) per invocation.

Handlers registered in the tool registry never break the loop: a throw or a timeout is converted into a `{ success: false, error: { code, message } }` result and handed to the agent, so it can recover or explain rather than the turn dying. Streaming callbacks are rebased on each step, so `onText` always reports the whole answer so far rather than just the current step's fragment.

---

## Development

```bash
npm install
npm run typecheck   # tsc -b (covers all src/**/*.ts/tsx)
npm run lint        # eslint .
npm run build       # ESM lib build to dist/ (react/react-dom/instantsearch external)
```

The primary consumption path is via source alias in `algolia-chat`. The standalone build (`npm run build`) exists for type-checking and publishing verification — the single shippable bundle is produced by `algolia-chat`.

### Adding/overriding strings

Every user-facing label is in `src/config/strings.ts` under `defaultStrings`. To override at embed time, pass a `DeepPartial<WidgetStrings>` to `applyRuntimeConfig`:

```ts
applyRuntimeConfig({
  strings: {
    composer: { placeholder: 'Ask a question…', send: 'Send' },
    widget: { missingConfig: 'Please configure the widget.' },
  },
});
```

Or use the `strings` attribute / slot on `<algolia-chat>` (which calls the same function).

---

### Peer dependencies

`react`, `react-dom`, and `instantsearch.js` are peer dependencies — the consuming application (algolia-chat's IIFE build) provides them.

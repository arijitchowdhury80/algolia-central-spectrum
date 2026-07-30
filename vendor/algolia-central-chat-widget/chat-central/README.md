# @algolia-central/chat-central

**Chat Central** is the complete widget engine for the `<algolia-chat>` experience. It is consumed by the sibling [`algolia-chat`](../algolia-chat) package (the custom-element / attribute layer), which bundles it from source into the final IIFE.

`chat-central` contains:

| Layer                    | Contents                                                                                                                                                 |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **IS plumbing**          | `connectChat`, `connectAgent`, `connectChatConfidence` connectors; `chatWidget`, `agentWidget`, `chatConfidenceWidget` factories; React renderer harness |
| **React UI**             | `ChatWidget` + all components (`AppHeader`, `ChatPanel`, `ChatMessage`, `Composer`, `SourcePills`, `JudgeDrawer`, …)                                     |
| **Configuration system** | `InstanceConfig`, `RuntimeConfig`, `WidgetStrings`, `defaultInstance`, `applyRootConfig`, `applyRuntimeConfig`, `mergeStrings`                           |
| **Judge engine**         | Vendored `@confidence-engine` (multi-judge, grounding gate, synthesis); `hostedJudgeClient`, `inBrowserJudge`, `agentStudioLlmAdapter`, `useJudge`       |
| **Shared transports**    | Agent Studio completions client (`agentStudio.ts`) + env plumbing (`agents.ts`)                                                                          |
| **Style helpers**        | `buildWidgetStyles(opts?)`, `ensureWidgetFont(fontHref?)`, CSS tokens + theme                                                                            |

The `<algolia-chat>` custom element (algolia-chat package) reads HTML attributes, calls the config helpers, and passes no `component` to `chatWidget` — it defaults to the built-in `ChatWidget` exported from here.

---

## What's in the box

### IS connectors + factories

| Export                                          | Purpose                                                                                                                                                      |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `connectChat`                                   | Chat lifecycle connector. Aggregates `chatAgents` + `chatConfidence` + `judgeAgents` from IS `renderState` and pushes updates to the reactive `WidgetStore`. |
| `chatWidget({ container, apiRef, component? })` | Wires `connectChat` + React renderer. `component` defaults to the built-in `ChatWidget`.                                                                     |
| `createChatRenderer`                            | UI-agnostic React mount/unmount harness.                                                                                                                     |
| `connectAgent`                                  | Unified connector for chat agents and judge agents. Publishes into `renderState.chatAgents` (chat context) or `renderState.judgeAgents` (judge context).     |
| `agentWidget`                                   | Ready-to-register agent widget.                                                                                                                              |
| `connectChatConfidence`                         | Config-only carrier. Publishes `{ mode, agents, url, apiKey }` into `renderState.chatConfidence`.                                                            |
| `chatConfidenceWidget`                          | Confidence widget factory. Accepts an optional `container` — mounts `<algolia-confidence-badge>` and keeps it live via `algolia-verdict` events.             |
| `ALGOLIA_VERDICT_EVENT`                         | `'algolia-verdict'` — `CustomEvent` name dispatched on `document` by `useJudge`.                                                                             |

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
  │                               ├── useChat  ── agentStudio ── Agent Studio
  │                               └── useJudge ── hostedJudgeClient / inBrowserJudge
  ├── connectAgent → renderState.chatAgents / judgeAgents
  └── connectChatConfidence → renderState.chatConfidence
```

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

/**
 * connectChat — custom InstantSearch.js connector for the algolia-chat widget.
 *
 * Follows the official "Create your own widgets" connector pattern:
 * https://www.algolia.com/doc/guides/building-search-ui/widgets/create-your-own-widgets/js
 *
 * The chat does NOT consume Algolia search results. InstantSearch is used
 * purely as the lifecycle/orchestration layer: init mounts the React tree,
 * render updates the reactive store, dispose unmounts.
 *
 * Agent sub-widgets register their config into `renderState.chatAgents` via
 * connectChatAgent, and confidence sub-widgets register their config into
 * `renderState.chatConfidence` via connectChatConfidence. The chat connector
 * reads both aggregated states in getWidgetRenderState (called during render,
 * after all widget getRenderState passes have completed) and passes them to
 * the renderer's reactive store so React re-renders without remounting.
 */

import type { InstantSearch, InitOptions, RenderOptions } from 'instantsearch.js/es/types';
import type { ChatAgentDescriptor, JudgeAgentDescriptor } from './connectAgent';
import type { ChatConfidenceDescriptor } from './connectChatConfidence';

// ── Internal IS shape needed to read accumulated renderState ──────────────────

/** Minimal slice of the IS instance used to read back aggregated render state. */
type ISWithRenderState = InstantSearch & {
  renderState?: Record<string, Record<string, unknown>>;
};

/**
 * Extract chatAgents, chatConfidence, and judgeAgents from the IS instance's
 * accumulated renderState for the main index. Called during `render` (phase 2),
 * which fires after all widgets have run `getRenderState` (phase 1), so leaf
 * widget data is always present.
 *
 * When `<algolia-judge-agent>` children are registered they publish into
 * `renderState.judgeAgents`. This function merges those into
 * `chatConfidence.agents`, so the child elements are the authoritative source
 * of judge agent config when present. If no judge-agent children exist the
 * static `agents` declared on `<algolia-chat-confidence>` itself are used.
 */
function readChildRenderState(is: ISWithRenderState): {
  agents: Record<string, ChatAgentDescriptor>;
  confidence: ChatConfidenceDescriptor | null;
} {
  const indexState = (is.renderState ?? {})[is.indexName] ?? {};
  const agents = (indexState.chatAgents ?? {}) as Record<string, ChatAgentDescriptor>;
  let confidence = (indexState.chatConfidence ?? null) as ChatConfidenceDescriptor | null;

  // Merge child <algolia-judge-agent> descriptors into confidence.agents.
  // Child elements take precedence over the static `agents` array declared
  // on the <algolia-chat-confidence> element itself.
  const judgeAgentsMap = indexState.judgeAgents as Record<string, JudgeAgentDescriptor> | undefined;
  if (judgeAgentsMap && Object.keys(judgeAgentsMap).length > 0 && confidence) {
    confidence = { ...confidence, agents: Object.values(judgeAgentsMap) };
  }

  return { agents, confidence };
}

// ── Public types ─────────────────────────────────────────────────────────────

export interface ChatWidgetApi {
  open: () => void;
  ask: (text: string) => void;
}

export interface ChatConnectorWidgetParams {
  container: HTMLElement;
}

export interface ChatRenderState {
  api: ChatWidgetApi | null;
  /** Aggregated agent descriptors from all registered chatAgent leaf widgets.
   *  Keyed by agentKey (e.g. 'primary', 'classifier', or a specialist slug). */
  agents: Record<string, ChatAgentDescriptor>;
  /** Confidence/judge descriptor from the registered chatConfidence leaf
   *  widget, or null when none is registered. */
  confidence: ChatConfidenceDescriptor | null;
  instantSearchInstance: InstantSearch;
  widgetParams: ChatConnectorWidgetParams;
}

export type ChatRenderer = (renderState: ChatRenderState, isFirstRender: boolean) => void;
export type ChatUnmounter = () => void;

// ── Minimal widget interface (avoids conflicts with IS's built-in chat types) ─

export interface ChatWidget {
  $$type: string;
  $$widgetType?: string;
  init?: (options: InitOptions) => void;
  render?: (options: RenderOptions) => void;
  dispose?: () => void;
  getWidgetRenderState?: (options: InitOptions | RenderOptions) => ChatRenderState;
  getRenderState?: (
    renderState: Record<string, unknown>,
    options: InitOptions | RenderOptions,
  ) => Record<string, unknown>;
}

// ── Connector ─────────────────────────────────────────────────────────────────

const noop = (): void => {};

/**
 * Create a chat connector.
 * @param renderFn  Called on init (isFirstRender=true) and on every IS render
 *                  cycle (isFirstRender=false). The renderState includes the
 *                  aggregated agents and confidence from leaf widgets.
 * @param unmountFn Called when the widget is disposed.
 */
export function connectChat(renderFn: ChatRenderer, unmountFn: ChatUnmounter = noop) {
  return function chat(widgetParams: ChatConnectorWidgetParams): ChatWidget {
    const connectorState: { api: ChatWidgetApi | null } = { api: null };

    const getWidgetRenderState = (options: InitOptions | RenderOptions): ChatRenderState => {
      const is = options.instantSearchInstance as ISWithRenderState;
      const { agents, confidence } = readChildRenderState(is);
      return {
        api: connectorState.api,
        agents,
        confidence,
        instantSearchInstance: options.instantSearchInstance,
        widgetParams,
      };
    };

    return {
      $$type: 'algolia.chat',

      init(initOptions: InitOptions) {
        renderFn(getWidgetRenderState(initOptions), true);
      },

      render(renderOptions: RenderOptions) {
        renderFn(getWidgetRenderState(renderOptions), false);
      },

      dispose() {
        unmountFn();
      },

      getWidgetRenderState,

      getRenderState(renderState, renderOptions) {
        return {
          ...renderState,
          algoliaChat: getWidgetRenderState(renderOptions),
        };
      },
    };
  };
}

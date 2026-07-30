/**
 * connectAgent — unified custom InstantSearch.js connector for both chat
 * agents and judge agents.
 *
 * A single connector replaces the previous `connectChatAgent` /
 * `connectJudgeAgent` pair. The only structural difference between a chat
 * agent and a judge agent is which `renderState` key they publish into:
 *
 *   context === 'chat'  → renderState.chatAgents[agentKey]
 *   context === 'judge' → renderState.judgeAgents[agentKey]
 *
 * Both contexts publish into an object keyed by `agentKey` so the central
 * `connectChat` connector can aggregate them during its render phase.
 *
 * Web-component layer: the single `<algolia-agent>` element uses
 * `this.closest('algolia-chat-confidence')` to determine context automatically
 * — no explicit `context` attribute needed in HTML.
 */

import type { JudgeAgentDescriptor } from './judge/types';

export type { JudgeAgentDescriptor };

const noop = (): void => {};

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Which IS renderState bucket this agent publishes into.
 *   'chat'  → renderState.chatAgents  (read by connectChat → useChat)
 *   'judge' → renderState.judgeAgents (merged into chatConfidence.agents → useJudge)
 */
export type AgentContext = 'chat' | 'judge';

/** Chat-agent roles. */
export type AgentRole = 'primary' | 'specialist' | 'classifier';

/**
 * Descriptor published into `renderState.chatAgents`.
 * All fields are required — the widget element supplies defaults for any that
 * are not provided by the consumer.
 */
export interface ChatAgentDescriptor {
  id: string;
  role: string;
  key: string;
  label: string;
  accentToken: string;
}

/**
 * Union of both descriptor shapes. Used as the return type of
 * `getWidgetRenderState` so either context works without casting.
 */
export type AgentDescriptor = ChatAgentDescriptor | JudgeAgentDescriptor;

/**
 * Widget params for a single agent in either context.
 *
 * `agentKey` is the unique slot in the renderState map (e.g. 'primary',
 * 'classifier', a specialist slug, 'skeptic', 'default', …).
 *
 * Chat-specific fields (`key`, `accentToken`) are ignored in judge context.
 */
export interface AgentWidgetParams {
  /** Key used in `renderState.chatAgents` or `renderState.judgeAgents`. */
  agentKey: string;
  /** Agent Studio agent UUID. */
  id: string;
  /** Which renderState bucket to publish into. */
  context: AgentContext;
  /** Agent role. Chat: 'primary'|'specialist'|'classifier'. Judge: 'skeptic'|'referee'|'advocate'. */
  role?: string;
  /** Human-readable display name. */
  label?: string;
  /** Specialist slug (chat context only). */
  key?: string;
  /** CSS custom-property name for accent colour (chat context only). */
  accentToken?: string;
}

export interface AgentWidget {
  $$type: string;
  $$widgetType?: string;
  init?: () => void;
  render?: () => void;
  dispose?: () => void;
  getWidgetRenderState?: () => AgentDescriptor & { widgetParams: AgentWidgetParams };
  getRenderState?: (renderState: Record<string, unknown>) => Record<string, unknown>;
}

// ── Connector ─────────────────────────────────────────────────────────────────

export function connectAgent(renderFn: () => void = noop, unmountFn: () => void = noop) {
  return function agent(widgetParams: AgentWidgetParams): AgentWidget {
    const { agentKey, id, role, label, key, accentToken, context } = widgetParams;

    // Chat agents publish a richer descriptor; judge agents publish a minimal one.
    const descriptor: AgentDescriptor =
      context === 'chat'
        ? {
            id,
            role: role ?? '',
            key: key ?? agentKey,
            label: label ?? '',
            accentToken: accentToken ?? '--algolia-agent-primary',
          }
        : { id, role, label };

    const publishKey = context === 'chat' ? 'chatAgents' : 'judgeAgents';

    return {
      $$type: `algolia.${context}Agent`,

      init() {
        renderFn();
      },

      render() {
        renderFn();
      },

      dispose() {
        unmountFn();
      },

      getWidgetRenderState() {
        return { ...descriptor, widgetParams };
      },

      getRenderState(renderState) {
        return {
          ...renderState,
          [publishKey]: {
            ...(renderState[publishKey] as Record<string, unknown>),
            [agentKey]: descriptor,
          },
        };
      },
    };
  };
}

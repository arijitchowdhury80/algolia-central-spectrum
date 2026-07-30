/**
 * <algolia-agent> — unified declarative config-carrier custom element for
 * both chat agents and judge agents.
 *
 * A single element replaces the previous `<algolia-chat-agent>` /
 * `<algolia-judge-agent>` pair. Context is determined automatically from DOM
 * position: an element nested inside `<algolia-chat-confidence>` is treated as
 * a judge agent; anywhere else it is treated as a chat agent.
 *
 * When connected, the element creates an `agentWidget` with the appropriate
 * context and dispatches `algolia-widget-added` (bubbling). The event propagates
 * up through any `<algolia-chat-confidence>` parent (which has no listener) and
 * is caught by `<algolia-chat>`'s sub-orchestrator, which calls
 * `isInstance.addWidgets([widget])`. No additional wiring is required.
 *
 * When disconnected the element dispatches `algolia-widget-removed` so the
 * widget is cleanly removed from the IS instance.
 *
 * ── Chat agent (inside <algolia-chat>):
 *   <algolia-agent role="primary"    agent-id="…" label="Assistant"></algolia-agent>
 *   <algolia-agent role="specialist" key="code" agent-id="…" label="Code expert"
 *                  accent-token="--algolia-agent-specialist"></algolia-agent>
 *   <algolia-agent role="classifier" agent-id="…"></algolia-agent>
 *
 * ── Judge agent (inside <algolia-chat-confidence>):
 *   <algolia-chat-confidence mode="algolia">
 *     <algolia-agent role="skeptic"  agent-id="…"></algolia-agent>
 *     <algolia-agent role="referee"  agent-id="…"></algolia-agent>
 *     <algolia-agent role="advocate" agent-id="…"></algolia-agent>
 *   </algolia-chat-confidence>
 *
 * ── Single judge agent (no role — covers all temperaments):
 *   <algolia-chat-confidence mode="algolia">
 *     <algolia-agent agent-id="…"></algolia-agent>
 *   </algolia-chat-confidence>
 *
 * ── Attributes (all contexts) ────────────────────────────────────────────────
 *   agent-id      Algolia Agent Studio agent UUID  (required)
 *   role          Agent role (context-specific; optional for single judge agents)
 *   label         Human-readable display name (optional)
 *
 * ── Attributes (chat context only) ──────────────────────────────────────────
 *   key           Specialist routing slug (required when role="specialist")
 *   accent-token  CSS custom-property name for accent colour (optional;
 *                 defaults: specialist → --algolia-agent-specialist,
 *                           others   → --algolia-agent-primary)
 *
 * All attributes can be changed on a connected element: the widget is detached
 * and re-registered with the new values, so host code can retarget an agent
 * (e.g. swap `agent-id` for an A/B test) without touching the DOM structure.
 */

import {
  agentWidget,
  defaultInstance,
  type AgentContext,
  type AgentWidget,
} from '@algolia-central/chat-central';
import { ALGOLIA_WIDGET_ADDED, ALGOLIA_WIDGET_REMOVED } from '../instantsearch/constants';

export class AlgoliaAgentElement extends HTMLElement {
  private widget: AgentWidget | null = null;

  static get observedAttributes(): string[] {
    return ['role', 'key', 'agent-id', 'label', 'accent-token'];
  }

  // ── Context detection ──────────────────────────────────────────────────────

  /**
   * Detect whether this element is a judge agent (inside a confidence element)
   * or a chat agent (anywhere else). Uses the live DOM position at connection time.
   */
  private get agentContext(): AgentContext {
    return this.closest('algolia-chat-confidence') ? 'judge' : 'chat';
  }

  // ── Shared accessors ───────────────────────────────────────────────────────

  get agentId(): string {
    return this.getAttribute('agent-id')?.trim() ?? '';
  }

  get roleAttr(): string | undefined {
    return this.getAttribute('role')?.trim() || undefined;
  }

  get labelAttr(): string | undefined {
    return this.getAttribute('label')?.trim() || undefined;
  }

  // ── Chat-context accessors ─────────────────────────────────────────────────

  /**
   * Resolved label — falls back to role-based defaults sourced from
   * `defaultInstance` in chat-central so the fallback copy is overridable
   * from a single location.
   */
  private chatLabel(agentKey: string): string {
    if (this.labelAttr) return this.labelAttr;
    const role = this.roleAttr;
    if (role === 'primary') return defaultInstance.agents.primary.label;
    if (role === 'classifier') return defaultInstance.agents.classifier?.label ?? 'Classifier';
    return agentKey; // specialist: use the key as display name
  }

  /** Stable key for the chatAgents map. */
  private chatAgentKey(): string {
    const role = this.roleAttr;
    if (role === 'primary') return 'primary';
    if (role === 'classifier') return 'classifier';
    return this.getAttribute('key')?.trim() ?? '';
  }

  /** CSS custom property for this agent's accent colour. */
  private accentToken(): string {
    const explicit = this.getAttribute('accent-token')?.trim();
    if (explicit) return explicit;
    return this.roleAttr === 'specialist'
      ? '--algolia-agent-specialist'
      : '--algolia-agent-primary';
  }

  // ── Judge-context accessors ────────────────────────────────────────────────

  /** Stable key for the judgeAgents map: role name or 'default'. */
  private judgeAgentKey(): string {
    return this.roleAttr ?? 'default';
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  connectedCallback(): void {
    this.style.display = 'none';
    this.register();
  }

  /**
   * Re-register with the new configuration.
   *
   * `observedAttributes` was declared without this callback, so retargeting a
   * live agent — the natural way to point the widget at a different Agent Studio
   * agent from host code — was accepted by the DOM and then ignored. Registration
   * is idempotent (unregister-then-register), so re-running it is the whole fix.
   *
   * `key` and `accent-token` only feed the chat-context branch of `register()`
   * (`chatAgentKey`/`accentToken` — see above); a judge agent never reads
   * either, so churning the widget for those changes there would be pure
   * overhead with no observable effect.
   */
  attributeChangedCallback(name: string, previous: string | null, next: string | null): void {
    if (!this.isConnected || previous === next) return;
    if (this.agentContext === 'judge' && (name === 'key' || name === 'accent-token')) return;
    this.unregister();
    this.register();
  }

  disconnectedCallback(): void {
    this.unregister();
  }

  // ── Registration ───────────────────────────────────────────────────────────

  /** Build the agent widget for the current attributes and announce it. */
  private register(): void {
    const id = this.agentId;
    if (!id) return;

    if (this.agentContext === 'chat') {
      const agentKey = this.chatAgentKey();
      if (!agentKey) return; // role-less or key-less chat agent — skip

      this.widget = agentWidget({
        context: 'chat',
        agentKey,
        id,
        role: this.roleAttr,
        key: agentKey,
        label: this.chatLabel(agentKey),
        accentToken: this.accentToken(),
      });
    } else {
      const agentKey = this.judgeAgentKey();
      this.widget = agentWidget({
        context: 'judge',
        agentKey,
        id,
        role: this.roleAttr,
        label: this.labelAttr,
      });
    }

    this.dispatchEvent(
      new CustomEvent(ALGOLIA_WIDGET_ADDED, {
        bubbles: true,
        cancelable: true,
        detail: this.widget,
      }),
    );
  }

  /** Detach the current widget, if any. Safe to call when nothing is registered. */
  private unregister(): void {
    if (!this.widget) return;
    this.dispatchEvent(
      new CustomEvent(ALGOLIA_WIDGET_REMOVED, {
        bubbles: true,
        cancelable: true,
        detail: this.widget,
      }),
    );
    this.widget = null;
  }
}

if (!customElements.get('algolia-agent')) {
  customElements.define('algolia-agent', AlgoliaAgentElement);
}

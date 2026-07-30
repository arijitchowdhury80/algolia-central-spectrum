/**
 * <algolia-chat-confidence> — a declarative config-carrier custom element.
 *
 * In the InstantSearch widget topology this element acts as a leaf widget:
 * when connected it creates a `chatConfidenceWidget` and dispatches
 * `algolia-widget-added` (bubbling) so the parent `<algolia-chat>` element
 * (acting as a sub-orchestrator) can call `search.addWidgets([widget])`.
 * When disconnected it dispatches `algolia-widget-removed` so the parent
 * can remove it from InstantSearch.
 *
 * Judge agents follow the same `agents` pattern used by the chat widget.
 * Supply agents that represent judges — either one agent that covers all
 * judge roles, or multiple agents assigned to specific roles (skeptic /
 * referee / advocate). The element renders nothing (display:none) and is
 * purely a config vessel.
 *
 * Usage — single agent (most common):
 *   <algolia-chat-confidence mode="algolia" agent-id="<uuid>">
 *   </algolia-chat-confidence>
 *
 * Usage — multiple agents with explicit roles:
 *   <algolia-chat-confidence mode="algolia"
 *     agents='[{"id":"<uuid-a>","role":"skeptic"},
 *              {"id":"<uuid-b>","role":"referee"},
 *              {"id":"<uuid-c>","role":"advocate"}]'>
 *   </algolia-chat-confidence>
 *
 * Usage — hosted judge service:
 *   <algolia-chat-confidence mode="hosted" url="https://..." api-key="...">
 *   </algolia-chat-confidence>
 *
 * Attributes
 *   mode      "hosted" | "algolia" | "off"    (optional; default "hosted")
 *   agent-id  Single Agent Studio UUID (shorthand for agents=[{id}])
 *   agents    JSON array of JudgeAgentDescriptor objects (overrides agent-id)
 *   url       Override URL for the hosted judge service (optional)
 *   api-key   Auth key for the hosted judge service (optional)
 *
 * All attributes can be changed on a connected element — the widget is detached
 * and re-registered with the new values, so judging can be turned on or off, or
 * repointed at another service, at runtime.
 */

import {
  chatConfidenceWidget,
  type JudgeMode,
  type JudgeAgentDescriptor,
} from '@algolia-central/chat-central';
import { ALGOLIA_WIDGET_ADDED, ALGOLIA_WIDGET_REMOVED } from '../instantsearch/constants';
// Side-effect: ensures <algolia-agent> / <algolia-agent> CEs are defined so
// any <algolia-agent> children of this element connect and dispatch correctly.
import './AgentElement';

function parseAgentsAttr(el: Element): JudgeAgentDescriptor[] | undefined {
  const raw = el.getAttribute('agents');
  if (!raw?.trim()) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as JudgeAgentDescriptor[];
  } catch {
    console.warn('[algolia-chat-confidence] Could not parse `agents` attribute as JSON array.');
  }
  return undefined;
}

export class AlgoliaChatConfidenceElement extends HTMLElement {
  private widget: ReturnType<typeof chatConfidenceWidget> | null = null;

  static get observedAttributes(): string[] {
    return ['mode', 'agent-id', 'agents', 'url', 'api-key'];
  }

  // ── Property accessors ─────────────────────────────────────────────────────

  get judgeMode(): JudgeMode {
    const v = this.getAttribute('mode');
    if (v === 'algolia' || v === 'off') return v;
    return 'hosted';
  }

  /**
   * Build the agents array from either the `agents` JSON attribute (takes
   * precedence) or the shorthand `agent-id` attribute.
   */
  get judgeAgents(): JudgeAgentDescriptor[] | undefined {
    const fromJson = parseAgentsAttr(this);
    if (fromJson) return fromJson;
    const id = this.getAttribute('agent-id')?.trim();
    if (id) return [{ id }];
    return undefined;
  }

  get judgeUrl(): string | undefined {
    const v = this.getAttribute('url');
    return v && v.trim() ? v.trim() : undefined;
  }

  get judgeApiKey(): string | undefined {
    const v = this.getAttribute('api-key');
    return v && v.trim() ? v.trim() : undefined;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  connectedCallback(): void {
    // Hide the element itself. `display:none` does NOT prevent light-DOM
    // children (<algolia-judge-agent>) from connecting and dispatching their
    // `algolia-widget-added` events — custom-element lifecycle fires on DOM
    // insertion, independent of visibility.
    this.style.display = 'none';
    this.register();
  }

  /**
   * Re-register with the new configuration.
   *
   * `observedAttributes` was declared without this callback, so switching a live
   * embed between `mode="off"` and `mode="algolia"`, or repointing it at a
   * different judge service, was silently ignored.
   *
   * Not every observed attribute can actually move the needle on the
   * constructed widget, so skip the churn when it can't:
   *   - `agent-id` is only shorthand for `agents` (see `judgeAgents`) — once
   *     an explicit `agents` JSON array is present it wins outright, so
   *     `agent-id` changing underneath it is a no-op.
   *   - `url`/`api-key` only reach the hosted judge service; they're inert
   *     outside `mode="hosted"`.
   */
  attributeChangedCallback(name: string, previous: string | null, next: string | null): void {
    if (!this.isConnected || previous === next) return;
    if (name === 'agent-id' && parseAgentsAttr(this)) return;
    if ((name === 'url' || name === 'api-key') && this.judgeMode !== 'hosted') return;
    this.unregister();
    this.register();
  }

  disconnectedCallback(): void {
    this.unregister();
  }

  // ── Registration ───────────────────────────────────────────────────────────

  private register(): void {
    this.widget = chatConfidenceWidget({
      mode: this.judgeMode,
      agents: this.judgeAgents,
      url: this.judgeUrl,
      apiKey: this.judgeApiKey,
    });

    this.dispatchEvent(
      new CustomEvent(ALGOLIA_WIDGET_ADDED, {
        bubbles: true,
        cancelable: true,
        detail: this.widget,
      }),
    );
  }

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

if (!customElements.get('algolia-chat-confidence')) {
  customElements.define('algolia-chat-confidence', AlgoliaChatConfidenceElement);
}

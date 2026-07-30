/**
 * InstanceConfig — the typed contract every embed instance fills in.
 *
 * Structure components read branding, agent identity, sample questions,
 * source facets, and copy ONLY from an InstanceConfig — never hardcoded.
 * This makes the widget fully templatizable: a new embed just supplies its
 * own InstanceConfig (or overrides subsets via HTML attributes + slots).
 */
import type { WidgetStrings } from './strings';

/** Which skin this instance's primary look uses. */
export type InstanceTheme = 'spectrum' | 'algolia';

/**
 * The window size mode the chat panel opens in.
 *
 *   `'normal'`    — centered 85vw × 85vh modal with a dimmed backdrop (default).
 *   `'docked'`    — anchored bottom-right corner panel; host page stays interactive.
 *   `'maximized'` — full-viewport modal.
 *
 * Set via `default-open-mode` on `<algolia-chat>`. The user's last chosen mode
 * is persisted to `localStorage` and takes priority over this default on
 * subsequent visits.
 */
export type ChatSizeMode = 'normal' | 'docked' | 'maximized';

/** Role of an agent within the widget orchestration. Re-exported here so
 *  config consumers keep importing from `./instance` without knowing the
 *  internal connector module layout. */
export type { AgentRole } from '../connectAgent';

export interface AgentDescriptor {
  /** Live Agent Studio agent ID. */
  id: string;
  /** Unique key used to identify this agent in segments and routing (e.g.
   *  `primary`, `code`, `design`). For the primary agent this is always
   *  `'primary'`; for the classifier it is always `'classifier'`. */
  key: string;
  /** Display label shown in chips / the handoff marker / error copy. */
  label: string;
  /** `--algolia-*` custom-property NAME (e.g. `--algolia-agent-primary`) used for this
   *  agent's accent color. Components read it via `var(${accentToken})` —
   *  never a raw hex value. */
  accentToken: string;
}

/** Minimal descriptor for judge-panel agents (no accentToken — they are never
 *  rendered as chat participants; IDs are wired in the lab/server judge client). */
export interface JudgeAgentDescriptor {
  id: string;
  label: string;
}

/** All agents that drive the chat experience for one widget instance. */
export interface AgentsConfig {
  /** The always-on front agent that answers every query. */
  primary: AgentDescriptor;
  /** Zero or more specialist agents the classifier can route to. */
  specialists: AgentDescriptor[];
  /** Optional classifier agent. When absent, no deep-dive is ever offered. */
  classifier?: AgentDescriptor;
}

export interface SourceFacet {
  /** The hit's raw `source` facet value from the index (e.g. `ReactAria`). */
  value: string;
  /** Human-readable label for the source pill group. */
  label: string;
}

export interface InstanceConfig {
  /** Stable slug, e.g. `spectrum`. */
  id: string;
  /** The company/brand this instance represents, e.g. "Algolia Central". */
  brandName: string;
  /** The product/corpus title shown in the header, e.g. "Adobe Spectrum". */
  productTitle: string;
  /** One-line subtitle under the product title. */
  subtitle: string;
  logo: {
    /** Header logo (the client's asset — looks like a client-branded product). */
    header: string;
    /** Small mark used elsewhere (e.g. favicon-scale contexts). */
    mark: string;
  };
  /**
   * URL of the icon shown on the header "New conversation" button. Supplied by
   * the embedding site so the glyph is never hardcoded in the widget — set via
   * the `new-chat-icon` HTML attribute or an `<img slot="new-chat-icon">` child
   * on `<algolia-chat>`. When empty or omitted the widget renders its built-in
   * fallback icon so the button is never blank.
   */
  newChatIcon: string;
  /** The fixed "powered by Algolia" attribution — present on every instance,
   *  regardless of theme (see PoweredByAlgolia.tsx). */
  poweredBy: {
    label: string;
    logo: string;
  };
  /** Human-readable name of the corpus this instance is grounded in. */
  corpusName: string;
  theme: InstanceTheme;
  agents: AgentsConfig;
  /** Sample questions grouped into titled sections (each section ≥3), shown in
   *  the empty state and the "Sample questions" popover. */
  sampleQuestions: { section: string; questions: string[] }[];
  /** Known `source` facet values in this instance's index, in display order. */
  sourceFacets: SourceFacet[];
  /** Short grounding/trust disclaimer shown in the empty state. */
  disclaimer: string;
  /** Optional NEUTRAL judge-backend agent for the client-side in-browser engine
   *  (mode=algolia). One agent acts purely as the engine's LLM seam; the 3 blind
   *  judges + gate run in the browser. Overridable via VITE_JUDGE_AGENT_ID. */
  judgeBackend?: JudgeAgentDescriptor;
  /** All user-facing strings rendered by the widget. Override any subset via
   *  the `strings` JSON attribute (or `<script slot="strings">`) to localize
   *  or rebrand copy without rebuilding the bundle. */
  strings: WidgetStrings;
  /** Welcome hero configuration for the empty state.
   *
   *  `show`    — master toggle for the welcome hero. When false the entire
   *              welcome region (default hero or slotted HTML) is omitted; the
   *              sample-question chips and disclaimer still render. Set via the
   *              `show-welcome` HTML attribute (defaults to true).
   *  `present` — when true the default hero (eyebrow + heading + description) is
   *              replaced by the consumer's `<div slot="welcome">` projected
   *              HTML. Ignored when `show` is false. */
  welcome: { present: boolean; show: boolean };
  /**
   * URL of the signed-in user's profile image. Rendered as a circular avatar
   * next to every user prompt bubble. Falls back to an anonymous person icon
   * when empty or omitted.
   *
   * Set via the `user-avatar` HTML attribute or an `<img slot="user-avatar">`
   * child on `<algolia-chat>`.
   */
  userAvatar: string;
  /**
   * The window size mode the panel opens in when first launched (or when the
   * user has no saved preference in `localStorage`).
   *
   * `'normal'`    — centered 85vw × 85vh modal with backdrop (default).
   * `'docked'`    — compact bottom-right corner panel; no backdrop.
   * `'maximized'` — full-viewport modal.
   *
   * Once a user explicitly changes the mode via the header controls their
   * choice is saved to `localStorage` and takes priority over this default
   * on all subsequent visits. Clear `localStorage` key `algolia-chat-size-mode`
   * to reset to the admin default.
   *
   * Set via `default-open-mode` on `<algolia-chat>`.
   */
  defaultOpenMode: ChatSizeMode;
  /**
   * URL of the icon shown on the collapsed launcher button. When omitted the
   * widget renders its built-in Algolia mark, which inherits the button's text
   * colour so it stays legible on any accent.
   *
   * Supply a single-colour asset — it sits on the accent-filled button.
   *
   * Set via `launcher-icon` on `<algolia-chat>`, or an
   * `<img slot="launcher-icon">` child.
   */
  launcherIcon: string;
  /**
   * Whether proactive auto-opening is allowed by default, before the visitor has
   * expressed a preference. Defaults to true (opt-out).
   *
   * Set false to ship proactive engagement off until a visitor enables it via the
   * `auto-engage-toggle` control. A stored visitor choice always wins over this.
   *
   * Set via `auto-engage="false"` on `<algolia-chat>`.
   */
  autoEngage: boolean;
  /**
   * How long the launcher's analyzing indicator may stay on before it clears
   * itself, in milliseconds.
   *
   * A safety net for callers that set it and never resolve (a rejected request,
   * an early return). Raise it if your upstream decision legitimately takes
   * longer than the default 30s.
   *
   * Set via `analyzing-timeout` on `<algolia-chat>`.
   */
  analyzingTimeoutMs: number;
  /**
   * Show a header control letting the visitor turn proactive auto-opening on or
   * off. Only meaningful for hosts that drive `engage()`, so it is opt-in — a
   * widget that never opens itself would otherwise offer a toggle that does
   * nothing.
   *
   * The visitor's choice is saved to `localStorage` under
   * `algolia-chat:auto-engage` and is honoured even when the control is hidden.
   *
   * Set via `auto-engage-toggle` on `<algolia-chat>`.
   */
  autoEngageToggle: boolean;
}

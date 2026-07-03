/**
 * Core data contracts for the chat UI. Ported unchanged from
 * _legacy_plaincss/src/types.ts — the protocol/shape is stack-agnostic.
 */

/** The two agents in the panel. Identity is never color-only in the UI — every
 *  chip pairs this with an icon + text label. */
export type AgentKind = 'generic' | 'technical';

/** A prior turn as sent back to Agent Studio in `messages[]`. */
export interface HistoryEntry {
  role: 'user' | 'assistant';
  content: string;
}

/** One grounded citation, normalized from a raw Agent Studio `a:` hit. */
export interface AnswerSource {
  /** Stable dedup id — prefers objectID, falls back to url. */
  id: string;
  title: string;
  url?: string;
  /** The hit's `source` facet, e.g. SpectrumDesignDocs / ReactSpectrumS2. */
  source?: string;
}

/** Lifecycle of a single agent's contribution within a turn. */
export type SegmentStatus = 'loading' | 'streaming' | 'success' | 'error';

/** One agent's answer segment. A turn has one Generic segment, and a second
 *  Technical segment only when the handoff sentinel fired. */
export interface AnswerSegment {
  agent: AgentKind;
  status: SegmentStatus;
  /** Streamed text, sentinel already stripped. */
  text: string;
  sources: AnswerSource[];
  /** Count of tool-result frames (`a:`) seen — drives the "searched · N sources"
   *  trace line independent of dedup count. */
  searchCount: number;
  /** Present when status === 'error'. Human-readable, never a raw stack. */
  error?: string;
  /** Raw, un-normalized `a:` hit objects for this segment (as collected by
   *  agentStudio.ts's collectHits) — kept alongside the normalized `sources`
   *  above ONLY so the live judge (lib/judgeClient.ts) can read each hit's
   *  full body/content text. `sources` (AnswerSource) intentionally drops
   *  that body text; the judge needs it to score grounding against the real
   *  record text, not just the title. Never rendered directly in chat UI. */
  rawHits?: Record<string, unknown>[];
}

/** One full user turn: the question plus the assistant answer, and — only if
 *  the user opts into a deeper dive — a second specialist segment.
 *
 *  Deep-dive is HUMAN-GATED (matches the RC2 reference): the front agent may
 *  *offer* a specialist deep-dive (via the handoff sentinel), but the
 *  specialist NEVER runs until the user clicks "yes". State machine:
 *    deepDiveOffered=false                        → no offer (nothing to do)
 *    deepDiveOffered=true,  handoff=false          → offer shown, awaiting user
 *    deepDiveOffered=false, deepDiveDeclined=true  → user declined the offer
 *    handoff=true                                  → user accepted; specialist ran
 */
export interface ChatTurn {
  id: string;
  query: string;
  segments: AnswerSegment[];
  /** True once the specialist deep-dive has actually run (segment[1] exists). */
  handoff: boolean;
  /** The front agent proposed a deep-dive and we're awaiting the user's choice. */
  deepDiveOffered: boolean;
  /** The user dismissed the deep-dive offer for this turn. */
  deepDiveDeclined?: boolean;
  /** A contextual next question the front agent suggested via its
   *  `[[FOLLOWUP: …]]` token — rendered as a one-click discovery card. */
  followUp?: string;
}

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
 *  Technical segment only when the user accepts the deep-dive offer. */
export interface AnswerSegment {
  agent: AgentKind;
  status: SegmentStatus;
  /** Streamed answer text (already clean — no in-band sentinel to strip). */
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
 *  Deep-dive is HUMAN-GATED (matches the RC2 reference): the client's own
 *  dedicated classifier agent (`ACS-classifier-neural`, lib/classifier.ts's
 *  `classifyOffer`, called via useChat.ts's `resolveOfferPatch`) *offers* a
 *  specialist deep-dive when its response is `SPECIALIST:`-prefixed, but the
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
  /** A contextual next question — `rest[0]` of the native suggestions after the
   *  `SPECIALIST:` offer (if any) is pulled out — rendered as a one-click
   *  discovery card. */
  followUp?: string;
  /** Query to send the specialist when the user accepts the deep-dive: always
   *  `turn.query` verbatim, set only when `deepDiveOffered` is true. NEVER a
   *  concatenation with Generic's answer (architecture-review Critical #1) —
   *  Generic's answer flows separately as `genericText`. */
  deepDiveQuery?: string;
}

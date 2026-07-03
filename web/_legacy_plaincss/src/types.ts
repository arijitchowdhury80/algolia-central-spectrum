/**
 * Core data contracts for the ACS chat UI. Kept in one small file since this
 * is a minimal single-thread app (no 2x2 matrix, no judge).
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
}

/** One full user turn: the question plus 1-2 agent segments (Generic, and
 *  Technical if handed off). */
export interface ChatTurn {
  id: string;
  query: string;
  segments: AnswerSegment[];
  handoff: boolean;
}

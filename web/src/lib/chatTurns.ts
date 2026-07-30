/**
 * chatTurns — the engine↔UI adapter. Maps react-instantsearch `useChat` render
 * state (`messages` + `status`) onto the `ChatTurn[]` contract the UI
 * components (`ChatPanel`, `ChatMessage`, `SourcePills`) consume.
 *
 * Pure, no React — this repo's test style (fixture + assert, no render harness).
 */
import { answerText, rawHitsFromParts, sourcesFromParts, type ChatMessageLike } from './chatMessage';
import { groupSources, totalSources } from './sources';
import type { AgentKind, AnswerSegment, ChatTurn, SegmentStatus } from '../types';

/** Native chat lifecycle → a segment status. Only a LATEST/live segment
 *  reflects the stream status; settled segments are always 'success'. */
function segmentStatus(isLive: boolean, liveStatus: string, text: string): SegmentStatus {
  if (!isLive) return 'success';
  if (liveStatus === 'error') return 'error';
  if (liveStatus === 'submitted' || liveStatus === 'streaming') {
    return text.trim() ? 'streaming' : 'loading';
  }
  return text.trim() ? 'success' : 'loading';
}

/**
 * Build one `AnswerSegment` from an assistant message (or a loading shell
 * when the assistant hasn't started). Shared by the Generic mapper below and
 * the Technical baton leg in `useChat`, so both legs project the same
 * `parts` → the production segment shape identically.
 */
export function buildSegment(
  assistant: ChatMessageLike | undefined,
  isLive: boolean,
  liveStatus: string,
  agent: AgentKind,
): AnswerSegment {
  if (!assistant) {
    return {
      agent,
      status: segmentStatus(isLive, liveStatus, ''),
      text: '',
      sources: [],
      searchCount: 0,
    };
  }
  const text = answerText(assistant.parts);
  const sources = sourcesFromParts(assistant.parts);
  return {
    agent,
    status: segmentStatus(isLive, liveStatus, text),
    text,
    sources,
    searchCount: totalSources(groupSources(sources)),
    rawHits: rawHitsFromParts(assistant.parts),
  };
}

/** The latest assistant message in a chat, or undefined if none yet.
 *  Used by the Technical baton leg (a separate `useChat` instance) to project
 *  its answer into a segment. */
export function latestAssistant(
  messages: readonly ChatMessageLike[],
): ChatMessageLike | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') return messages[i];
  }
  return undefined;
}

/**
 * Fold the `messages` array (alternating user/assistant) into `ChatTurn[]`. Each
 * `user` message opens a turn; the `assistant` message immediately after it (if
 * present) supplies the Generic segment's text + grounded sources.
 *
 * `liveStatus` (the `useChat` status) drives ONLY the last turn's
 * segment status so the "searching…/streaming" affordance shows on the active
 * answer, never on completed history.
 *
 * Deep-dive/baton/judge are layered on by the hook (`useChat`), not here
 * — this mapper is the pure text/sources projection.
 */
export function messagesToTurns(
  messages: readonly ChatMessageLike[],
  liveStatus: string,
): ChatTurn[] {
  const turns: ChatTurn[] = [];

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role !== 'user') continue;

    const query = answerText(m.parts);
    const next = messages[i + 1];
    const assistant = next && next.role === 'assistant' ? next : undefined;
    // "latest" = no user turn comes after this one.
    const isLatest = !messages.slice(i + 1).some((x) => x.role === 'user');

    turns.push({
      id: assistant?.id ?? m.id,
      query,
      segments: [buildSegment(assistant, isLatest, liveStatus, 'generic')],
      handoff: false,
      deepDiveOffered: false,
    });
  }

  return turns;
}

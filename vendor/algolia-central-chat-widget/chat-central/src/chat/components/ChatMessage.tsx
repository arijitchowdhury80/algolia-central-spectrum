import { MessageMarkdown } from './MessageMarkdown';
import { SourcePills } from './SourcePills';
import { ErrorCard } from './ErrorCard';
import { DiscoveryCard } from './DiscoveryCard';
import { DeepDivePrompt } from './DeepDivePrompt';
import { ThinkingIndicator } from './ThinkingIndicator';
import { ConfidenceBadge } from '../../judge/components/ConfidenceBadge';
import { useJudge, type JudgeTarget } from '../../judge/useJudge';
import { activeInstance, getAgentByKey } from '../../config/active';
import { useWidgetState } from '../widgetContext';
import type { JudgeVerdict } from '../../judge/types';
import type { AnswerSegment, ChatTurn } from '../types';

/**
 * Resolve who produced an answer, for display.
 *
 * There are two registries of agents and they are populated by different paths:
 *
 *   1. `renderState.agents` (the widget store) — built from the `<algolia-agent>`
 *      elements in the page. This is what `useChat` uses to CALL an agent, so it
 *      is always correct and always present.
 *   2. `activeInstance.agents` (the instance config) — only populated when a
 *      caller passes agents through `applyRuntimeConfig`. With declarative
 *      `<algolia-agent>` markup it is NEVER populated: `specialists` stays `[]`
 *      (see config/defaults.ts).
 *
 * The label used to be resolved from (2) alone, falling back to
 * `activeInstance.agents.primary`. With markup-configured agents that meant a
 * specialist answer silently rendered with the PRIMARY agent's label and accent
 * colour — every card read "Assistant" in the same colour, no matter which agent
 * answered, so a handed-off answer was indistinguishable from the generalist's.
 * Confirmed in a live DOM: two cards from two different agents, both
 * `label: "Assistant"`, both `--algolia-agent-primary`.
 *
 * Preferring the store fixes it at the source of truth, and the old lookups stay
 * as fallbacks so `applyRuntimeConfig`-based setups behave exactly as before.
 */
function useAgentMeta(agentKey: string) {
  const { agents } = useWidgetState();
  return agents[agentKey] ?? getAgentByKey(agentKey) ?? activeInstance.agents.primary;
}

interface BadgeState {
  showBadge: boolean;
  badgeVerdict: JudgeVerdict | undefined;
  scoring: boolean;
}

function computeBadgeState(
  segment: AnswerSegment,
  judgeStatus: ReturnType<typeof useJudge>['status'],
  verdict: JudgeVerdict | undefined,
): BadgeState {
  // Show whatever verdict we HAVE, and fall back to the scoring state only when
  // there is genuinely nothing to show.
  //
  // This used to key purely off `judgeStatus !== 'done'` and discard the verdict
  // while judging. With the two-phase judge that silently threw away the
  // grounding result: measured, the badge held "scoring…" for 30.3s while a
  // complete, final grounding verdict had been sitting in the hook since 8ms.
  // The status is still honest — the panel really is still running — so the fix
  // belongs here, in what the badge is given, not in the status.
  const hasVerdictError = judgeStatus === 'error' || !!verdict?.error;
  const scoring = judgeStatus !== 'done' && !hasVerdictError;
  // Only show the badge once the judge has actually fired (status leaves 'idle').
  // While the segment is still streaming / the consent gate is open, canJudge is
  // false and the judge hasn't started — showing "scoring…" before it begins is
  // dishonest and confuses users who click "No thanks" expecting a score.
  const showBadge = judgeStatus !== 'idle' && !!segment.text.trim() && segment.status !== 'error';
  return { showBadge, badgeVerdict: scoring ? undefined : verdict, scoring };
}

function SegmentFooter({
  segment,
  canJudge,
  question,
  onOpenJudge,
}: {
  segment: AnswerSegment;
  canJudge: boolean;
  question: string;
  onOpenJudge: (verdict: JudgeVerdict, question: string) => void;
}) {
  const target: JudgeTarget | null = canJudge
    ? { id: `${segment.agent}`, question, segment }
    : null;
  const { status: judgeStatus, verdict } = useJudge(target);
  const { showBadge, badgeVerdict, scoring } = computeBadgeState(segment, judgeStatus, verdict);

  if (!segment.sources.length && !showBadge) return null;
  return (
    // Wraps because this row has to survive the docked panel, which is
    // min(420px, 100vw - 32px). Source labels are real names ("React Spectrum
    // S2"), not slugs, so at that width the last row and the confidence badge
    // ran into each other rather than reflowing — the badge sat on top of the
    // source text. Wrapping drops the badge onto its own line when the two no
    // longer fit side by side, and changes nothing at full width.
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <div className="min-w-0 flex-1 basis-48">
        {segment.sources.length > 0 && <SourcePills sources={segment.sources} />}
      </div>
      {showBadge && (
        <ConfidenceBadge
          verdict={badgeVerdict}
          scoring={scoring}
          onOpenJudge={
            badgeVerdict && !badgeVerdict.error
              ? () => onOpenJudge(badgeVerdict, question)
              : undefined
          }
        />
      )}
    </div>
  );
}

interface SegmentState {
  busy: boolean;
  waiting: boolean;
  emptyResult: boolean;
  canJudge: boolean;
  showFooter: boolean;
}

function computeSegmentState(segment: AnswerSegment): SegmentState {
  const busy = segment.status === 'loading' || segment.status === 'streaming';
  const hasText = !!segment.text.trim();
  const waiting = segment.status === 'loading' || (segment.status === 'streaming' && !hasText);
  const emptyResult = segment.status === 'success' && !hasText;
  const canJudge = segment.status === 'success' && hasText;
  /**
   * The footer (source pills + confidence badge) waits for the answer.
   *
   * `segment.sources` is populated from the search tool frames, which arrive
   * BEFORE the first token of prose. Showing the footer on `sources.length > 0`
   * therefore rendered the sources while the card still read "Writing the
   * answer…" — and because the answer was empty, the sources were the only
   * content, so the card appeared to arrive back-to-front.
   *
   * Gating on text means the reader always sees the answer first and its
   * supporting evidence beneath it, which is also the order the eye expects.
   */
  const showFooter = segment.status !== 'error' && hasText;
  return { busy, waiting, emptyResult, canJudge, showFooter };
}

/** One answer card. Each finished answer also carries its own Confidence chip —
 *  the composite grounding-judge score — which opens the full breakdown drawer. */
// Pre-existing render branching (waiting/empty/error/footer), predates the 2026-08 lint-config adoption.
// eslint-disable-next-line complexity
function SegmentView({
  segment,
  turnId,
  question,
  onRetry,
  onOpenJudge,
}: {
  segment: AnswerSegment;
  turnId: string;
  question: string;
  onRetry: () => void;
  onOpenJudge: (verdict: JudgeVerdict, question: string) => void;
}) {
  const { busy, waiting, emptyResult, canJudge, showFooter } = computeSegmentState(segment);
  const meta = useAgentMeta(segment.agent);
  const targetId = `${turnId}:${segment.agent}`;

  // A specialist answer gets its own card treatment (styles/index.css). Driven off
  // `role`, not the key, so any embedder's specialist slug picks it up. The
  // data attribute is exposed so a host page can target the card too.
  const isSpecialist = meta.role === 'specialist';

  return (
    <div
      className={`flex flex-col gap-3 rounded-algolia-xl p-6 ${
        isSpecialist ? 'algolia-answer-card--specialist' : 'algolia-answer-card--primary'
      }`}
      data-agent-role={meta.role || undefined}
      data-agent-key={meta.key || undefined}
      aria-busy={busy}
    >
      <div className="flex items-center gap-2">
        <span className="algolia-agent-label text-[10px] font-algolia-bold uppercase tracking-[0.14em]">
          {meta.label}
        </span>
      </div>

      {waiting && <ThinkingIndicator />}

      {segment.text && <MessageMarkdown text={segment.text} />}

      {emptyResult && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-algolia-sm text-algolia-text-muted">
          <span>{activeInstance.strings.message.empty}</span>
          <button
            type="button"
            onClick={onRetry}
            className="rounded-algolia-full border border-algolia-border px-3 py-1 text-algolia-xs font-algolia-medium text-algolia-text transition-colors duration-algolia-fast ease-algolia-ease hover:border-algolia-accent hover:bg-algolia-surface-hover"
          >
            {activeInstance.strings.message.tryAgain}
          </button>
        </div>
      )}

      {segment.status === 'error' && <ErrorCard agent={segment.agent} onRetry={onRetry} />}

      {showFooter && (
        <SegmentFooter
          segment={{ ...segment, agent: targetId }}
          canJudge={canJudge}
          question={question}
          onOpenJudge={onOpenJudge}
        />
      )}
    </div>
  );
}

export interface ChatMessageProps {
  turn: ChatTurn;
  onRetry: (turnId: string) => void;
  onPickFollowUp: (question: string) => void;
  onOpenJudge: (verdict: JudgeVerdict, question: string) => void;
  onDeepDive: (turnId: string) => void;
  onDecline: (turnId: string) => void;
  isStreaming: boolean;
}

/** Name the specialist in the deep-dive offer. Same two-registry problem as
 *  `useAgentMeta`: with `<algolia-agent>` markup, `activeInstance.agents.specialists`
 *  is empty, so this fell through to the generic fallback string and the offer never
 *  named the specialist it was offering. `storeAgents` is the render-state map. */
// Pre-existing two-registry fallback chain, predates the 2026-08 lint-config adoption.
// eslint-disable-next-line complexity
function resolveSpecialistLabel(
  turn: ChatMessageProps['turn'],
  storeAgents: Record<string, { key: string; label: string; role: string }>,
): string {
  const fromStore = turn.deepDiveSpecialist
    ? storeAgents[turn.deepDiveSpecialist]?.label
    : Object.values(storeAgents).find((a) => a.role === 'specialist')?.label;
  const fromConfig = turn.deepDiveSpecialist
    ? getAgentByKey(turn.deepDiveSpecialist)?.label
    : activeInstance.agents.specialists[0]?.label;
  return fromStore ?? fromConfig ?? activeInstance.strings.deepDive.fallbackSpecialist;
}

/** Circular avatar shown to the right of every user prompt bubble.
 *  Shows the provided image when `userAvatar` is set, otherwise an anonymous
 *  person icon inside a muted circle. */
function UserAvatar() {
  const { userAvatar, strings } = activeInstance;
  if (userAvatar) {
    return (
      <img
        src={userAvatar}
        alt={strings.user.avatarAlt}
        className="h-8 w-8 shrink-0 rounded-algolia-full object-cover"
      />
    );
  }
  return (
    <span
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-algolia-full bg-algolia-surface-2 text-algolia-text-muted"
      aria-label={strings.user.anonymousAlt}
      role="img"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 20c0-3.866 3.582-7 8-7s8 3.134 8 7" />
      </svg>
    </span>
  );
}

/** One full turn: the user's question bubble and the assistant answer card(s). */
export function ChatMessage({
  turn,
  onRetry,
  onPickFollowUp,
  onOpenJudge,
  onDeepDive,
  onDecline,
  isStreaming,
}: ChatMessageProps) {
  const isStreamingTurn = turn.segments.some(
    (s) => s.status === 'loading' || s.status === 'streaming',
  );
  const { agents: storeAgents } = useWidgetState();
  return (
    <div className="flex flex-col gap-3.5">
      {/* User bubble row: bubble on the left of the avatar, both pushed right */}
      <div className="flex items-end justify-end gap-2">
        <div className="algolia-glow-accent max-w-[80%] whitespace-pre-wrap break-words rounded-algolia-xl rounded-br-algolia-md bg-algolia-accent px-5 py-3 text-algolia-sm text-algolia-text-on-accent">
          {turn.query}
        </div>
        <UserAvatar />
      </div>
      <div className="flex flex-col gap-3.5" aria-live="polite" aria-busy={isStreamingTurn}>
        {turn.segments.map((segment) => (
          <SegmentView
            key={`${turn.id}-${segment.agent}`}
            segment={segment}
            turnId={turn.id}
            question={turn.query}
            onRetry={() => onRetry(turn.id)}
            onOpenJudge={onOpenJudge}
          />
        ))}
        {turn.deepDiveOffered && (
          <DeepDivePrompt
            specialistLabel={resolveSpecialistLabel(turn, storeAgents)}
            onAccept={() => onDeepDive(turn.id)}
            onDecline={() => onDecline(turn.id)}
            disabled={isStreaming}
          />
        )}
        {turn.followUp && !isStreamingTurn && (
          <DiscoveryCard question={turn.followUp} onAsk={onPickFollowUp} disabled={isStreaming} />
        )}
      </div>
    </div>
  );
}

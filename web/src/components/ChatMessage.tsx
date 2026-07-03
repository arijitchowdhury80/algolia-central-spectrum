import { MessageMarkdown } from './MessageMarkdown';
import { SourcePills } from './SourcePills';
import { ErrorCard } from './ErrorCard';
import { DeepDivePrompt } from './DeepDivePrompt';
import { DiscoveryCard } from './DiscoveryCard';
import { ThinkingIndicator } from './ThinkingIndicator';
import { activeInstance } from '../config/active';
import type { AnswerSegment, ChatTurn } from '../types';

/** One answer card. Borderless + soft shadow (floats, not boxy), with a titled
 *  heading band (accent bar + agent label) so each response reads as its own
 *  card — the default assistant answer and, on request, the specialist deep-dive
 *  are each self-titled rather than sharing a "which bot" chip. */
function SegmentView({ segment, onRetry }: { segment: AnswerSegment; onRetry: () => void }) {
  const busy = segment.status === 'loading' || segment.status === 'streaming';
  const hasText = !!segment.text.trim();
  const waiting = segment.status === 'loading' || (segment.status === 'streaming' && !hasText);
  const emptyResult = segment.status === 'success' && !hasText;
  const meta = activeInstance.agents[segment.agent];
  return (
    <div className="flex flex-col gap-3 rounded-ac-xl bg-ac-surface p-6 shadow-ac-2" aria-busy={busy}>
      <div className="flex items-center gap-2">
        <span
          className="h-3.5 w-1 rounded-ac-full"
          style={{ backgroundColor: `var(${meta.accentToken})` }}
          aria-hidden="true"
        />
        <span className="text-[10px] font-ac-bold uppercase tracking-[0.14em] text-ac-text-muted">{meta.label}</span>
      </div>

      {waiting && <ThinkingIndicator />}

      {segment.text && <MessageMarkdown text={segment.text} />}

      {emptyResult && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-ac-sm text-ac-text-muted">
          <span>No response came back this time.</span>
          <button
            type="button"
            onClick={onRetry}
            className="rounded-ac-full border border-ac-border px-3 py-1 text-ac-xs font-ac-medium text-ac-text transition-colors duration-ac-fast ease-ac-ease hover:border-ac-accent hover:bg-ac-surface-hover"
          >
            Try again
          </button>
        </div>
      )}

      {segment.status === 'error' && <ErrorCard agent={segment.agent} onRetry={onRetry} />}

      {segment.status === 'success' && segment.sources.length > 0 && <SourcePills sources={segment.sources} />}
    </div>
  );
}

export interface ChatMessageProps {
  turn: ChatTurn;
  onRetry: (turnId: string) => void;
  onDeepDive: (turnId: string) => void;
  onDecline: (turnId: string) => void;
  onPickFollowUp: (question: string) => void;
  isStreaming: boolean;
}

/** One full turn: the user's question bubble, the assistant answer card, and —
 *  only if the user accepts the offer — a specialist deep-dive card. The offer
 *  appears after the answer while awaiting the user's choice. */
export function ChatMessage({ turn, onRetry, onDeepDive, onDecline, onPickFollowUp, isStreaming }: ChatMessageProps) {
  const isStreamingTurn = turn.segments.some((s) => s.status === 'loading' || s.status === 'streaming');
  const showOffer = turn.deepDiveOffered && !turn.handoff && !turn.deepDiveDeclined;
  return (
    <div className="flex flex-col gap-3.5">
      <div className="ac-glow-accent ml-auto max-w-[85%] whitespace-pre-wrap break-words rounded-ac-xl rounded-br-ac-md bg-ac-accent px-5 py-3 text-ac-sm text-ac-text-on-accent">
        {turn.query}
      </div>
      <div className="flex flex-col gap-3.5" aria-live="polite" aria-busy={isStreamingTurn}>
        {turn.segments.map((segment) => (
          <SegmentView key={`${turn.id}-${segment.agent}`} segment={segment} onRetry={() => onRetry(turn.id)} />
        ))}
        {showOffer && (
          <DeepDivePrompt
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

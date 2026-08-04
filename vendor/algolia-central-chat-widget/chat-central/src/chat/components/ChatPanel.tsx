import { useEffect, useRef, type ReactNode } from 'react';
import { ChatMessage } from './ChatMessage';
import { EmptyState } from './EmptyState';
import type { JudgeVerdict } from '../../judge/types';
import type { ChatTurn } from '../types';

/**
 * How close to the bottom (px) still counts as "the reader is following the
 * stream". A few pixels of slack absorbs sub-pixel layout rounding and the
 * momentum tail of a trackpad fling, so following isn't dropped spuriously.
 */
const AT_BOTTOM_SLACK_PX = 120;

export interface ChatPanelProps {
  turns: ChatTurn[];
  onPickSample: (question: string) => void;
  onRetry: (turnId: string) => void;
  onDeepDive: (turnId: string) => void;
  onDecline: (turnId: string) => void;
  onPickFollowUp: (question: string) => void;
  onOpenJudge: (verdict: JudgeVerdict, question: string) => void;
  isStreaming: boolean;
  /** Optional content rendered beneath the welcome hero in the empty state. */
  emptyStateFooter?: ReactNode;
}

/** The scrollable message list. Auto-scrolls to the newest turn as it
 *  streams; shows EmptyState before the first turn. */
export function ChatPanel({
  turns,
  onPickSample,
  onRetry,
  onDeepDive,
  onDecline,
  onPickFollowUp,
  onOpenJudge,
  isStreaming,
  emptyStateFooter,
}: ChatPanelProps) {
  const endRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  /** Is the reader following the stream, or have they scrolled up to read? */
  const stickToBottom = useRef(true);
  /** Last touch Y, so a drag can be told from a flick. */
  const touchY = useRef<number | null>(null);

  /**
   * Follow the newest turn as it streams.
   *
   * `turns` is a new array on every streamed token, so this effect runs
   * continuously while an answer arrives. Two consequences to handle:
   *
   * 1. `behavior: 'smooth'` queued animations on top of one another, so the
   *    panel visibly jittered for the whole of a long answer.
   * 2. Scrolling unconditionally yanked the reader back to the bottom even when
   *    they had deliberately scrolled up to re-read something earlier.
   *
   * So: jump instantly (an instant scroll cannot visibly jitter, however often
   * it runs), and only while the reader is still following the stream.
   */
  useEffect(() => {
    if (!stickToBottom.current) return;
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [turns]);

  /**
   * Does the reader still want to follow the stream?
   *
   * Detaching is driven by EXPLICIT INPUT — wheel, touch drag, and the navigation
   * keys — never by scroll position or scroll direction. Two earlier attempts
   * failed on exactly that point:
   *
   *   - Position at render time: while streaming, content grows faster than the
   *     panel scrolls, so the container always looks "scrolled up" and following
   *     switches off after the first token.
   *   - Direction from scroll events: the browser's scroll anchoring lowers
   *     scrollTop when content is inserted, which is indistinguishable from the
   *     reader dragging upward, so following switches off mid-answer.
   *
   * Input events have no such ambiguity: they only fire when the reader acts.
   * Re-attaching still uses position, because returning to the bottom is exactly
   * what "follow again" looks like.
   */
  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (e.deltaY < 0) stickToBottom.current = false;
  };

  const onTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    touchY.current = e.touches[0]?.clientY ?? null;
  };

  const onTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    const y = e.touches[0]?.clientY ?? null;
    // Dragging DOWN scrolls the content UP — i.e. back into history.
    if (touchY.current !== null && y !== null && y > touchY.current) {
      stickToBottom.current = false;
    }
    touchY.current = y;
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowUp' || e.key === 'PageUp' || e.key === 'Home') {
      stickToBottom.current = false;
    } else if (e.key === 'End') {
      stickToBottom.current = true;
    }
  };

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom <= AT_BOTTOM_SLACK_PX) stickToBottom.current = true;
  };

  if (turns.length === 0) {
    // A proactive greeting occupies this same empty-state area. Showing it
    // underneath the full hero (heading + sample chips) pushed the greeting
    // and its own chips below the fold in the docked panel, with nothing to
    // scroll it into view. Suppress the hero's heading/chips when a greeting
    // is present so the greeting renders in full instead.
    const hasGreeting = Boolean(emptyStateFooter);
    return (
      <div className="flex flex-1 flex-col items-center overflow-y-auto px-4 pb-8 pt-6 sm:px-6 sm:pt-10">
        <EmptyState onPick={onPickSample} hideHero={hasGreeting} />
        {emptyStateFooter && <div className="w-full max-w-algolia-measure">{emptyStateFooter}</div>}
      </div>
    );
  }

  return (
    <div
      ref={listRef}
      onScroll={onScroll}
      onWheel={onWheel}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onKeyDown={onKeyDown}
      className="flex flex-1 flex-col gap-7 overflow-y-auto px-4 py-6 sm:px-6"
    >
      {turns.map((turn) => (
        <ChatMessage
          key={turn.id}
          turn={turn}
          onRetry={onRetry}
          onDeepDive={onDeepDive}
          onDecline={onDecline}
          onPickFollowUp={onPickFollowUp}
          onOpenJudge={onOpenJudge}
          isStreaming={isStreaming}
        />
      ))}
      <div ref={endRef} />
    </div>
  );
}

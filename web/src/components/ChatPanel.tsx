import { useEffect, useRef } from 'react';
import { ChatMessage } from './ChatMessage';
import { EmptyState } from './EmptyState';
import type { JudgeVerdict } from '../lib/judgeClient';
import type { ChatTurn } from '../types';

export interface ChatPanelProps {
  turns: ChatTurn[];
  onPickSample: (question: string) => void;
  onRetry: (turnId: string) => void;
  onDeepDive: (turnId: string) => void;
  onDecline: (turnId: string) => void;
  onPickFollowUp: (question: string) => void;
  onOpenJudge: (verdict: JudgeVerdict, question: string) => void;
  isStreaming: boolean;
}

/** The scrollable message list. Auto-scrolls to the newest turn as it
 *  streams; shows EmptyState before the first turn. */
export function ChatPanel({ turns, onPickSample, onRetry, onDeepDive, onDecline, onPickFollowUp, onOpenJudge, isStreaming }: ChatPanelProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns]);

  if (turns.length === 0) {
    return (
      <div className="flex flex-1 items-start justify-center overflow-y-auto pb-8 pt-6 sm:pt-10">
        <EmptyState onPick={onPickSample} />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-7 overflow-y-auto py-6">
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

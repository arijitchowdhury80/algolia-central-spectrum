import { EmptyState } from './EmptyState';
import { Message } from './Message';
import type { ChatTurn } from '../types';

export interface ThreadProps {
  turns: ChatTurn[];
  onPickSample: (question: string) => void;
  onRetry: (turnId: string) => void;
}

/** The scrolling message thread. Shows EmptyState before the first turn. */
export function Thread({ turns, onPickSample, onRetry }: ThreadProps) {
  if (turns.length === 0) {
    return (
      <div className="thread thread--empty">
        <EmptyState onPick={onPickSample} />
      </div>
    );
  }

  return (
    <div className="thread">
      {turns.map((turn) => (
        <Message key={turn.id} turn={turn} onRetry={onRetry} />
      ))}
    </div>
  );
}

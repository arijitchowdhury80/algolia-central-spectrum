import { Fragment } from 'react';
import { AgentChip } from './AgentChip';
import { HandoffDivider } from './HandoffDivider';
import { SourcePills } from './SourcePills';
import { ToolTrace } from './ToolTrace';
import { ErrorCard } from './ErrorCard';
import type { AnswerSegment, ChatTurn } from '../types';

interface TextPart {
  type: 'text' | 'code';
  content: string;
  lang?: string;
}

/** Split streamed text on fenced code blocks (```lang\n...\n```). Plain-text
 *  parts preserve whitespace via CSS (white-space: pre-wrap); code parts
 *  render in a horizontally-scrollable <pre><code> so long lines never force
 *  the page to scroll sideways at 375px. Deliberately not a full markdown
 *  renderer — see build spec: plain-text + code-fence handling for v1. */
function parseFencedText(text: string): TextPart[] {
  const parts: TextPart[] = [];
  const regex = /```(\w*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', content: text.slice(lastIndex, match.index) });
    }
    parts.push({ type: 'code', content: match[2], lang: match[1] || undefined });
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) {
    parts.push({ type: 'text', content: text.slice(lastIndex) });
  }
  return parts;
}

function FormattedText({ text }: { text: string }) {
  const parts = parseFencedText(text);
  return (
    <>
      {parts.map((part, i) =>
        part.type === 'code' ? (
          <pre className="answer-code" key={i}>
            <code>{part.content.replace(/\n$/, '')}</code>
          </pre>
        ) : (
          <p className="answer-text" key={i}>
            {part.content}
          </p>
        ),
      )}
    </>
  );
}

function SegmentView({
  segment,
  onRetry,
}: {
  segment: AnswerSegment;
  onRetry: () => void;
}) {
  const busy = segment.status === 'loading' || segment.status === 'streaming';
  return (
    <div className="segment" aria-busy={busy}>
      <div className="segment__header">
        <AgentChip agent={segment.agent} status={segment.status} />
        {segment.status === 'loading' && (
          <span className="typing-dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        )}
      </div>

      {segment.text && <FormattedText text={segment.text} />}

      {segment.status === 'error' && <ErrorCard agent={segment.agent} onRetry={onRetry} />}

      {segment.status === 'success' && (
        <>
          <ToolTrace searchCount={segment.searchCount} />
          <SourcePills sources={segment.sources} />
        </>
      )}
    </div>
  );
}

export interface MessageProps {
  turn: ChatTurn;
  onRetry: (turnId: string) => void;
}

/** One full turn: the user's question bubble, then the Generic segment, and
 *  (if handed off) the divider + Technical segment. */
export function Message({ turn, onRetry }: MessageProps) {
  const isStreamingTurn = turn.segments.some(
    (s) => s.status === 'loading' || s.status === 'streaming',
  );
  return (
    <div className="message-turn">
      <div className="user-bubble">{turn.query}</div>
      <div
        className="assistant-turn"
        aria-live="polite"
        aria-busy={isStreamingTurn}
      >
        {turn.segments.map((segment, i) => (
          <Fragment key={`${turn.id}-${segment.agent}`}>
            {i === 1 && turn.handoff && <HandoffDivider />}
            <SegmentView segment={segment} onRetry={() => onRetry(turn.id)} />
          </Fragment>
        ))}
      </div>
    </div>
  );
}

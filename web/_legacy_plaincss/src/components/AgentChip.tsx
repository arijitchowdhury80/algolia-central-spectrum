import type { AgentKind, SegmentStatus } from '../types';

const AGENT_LABEL: Record<AgentKind, string> = {
  generic: 'Generic',
  technical: 'Technical',
};

/** Simple glyphs paired with the text label — identity is never color-only. */
const AGENT_ICON: Record<AgentKind, string> = {
  generic: '◆', // diamond
  technical: '⚙', // gear
};

export interface AgentChipProps {
  agent: AgentKind;
  status?: SegmentStatus;
}

/** Agent identity chip: icon + text label + accent color. Pulses while the
 *  segment is loading/streaming (respects prefers-reduced-motion via CSS). */
export function AgentChip({ agent, status }: AgentChipProps) {
  const busy = status === 'loading' || status === 'streaming';
  return (
    <span className={`agent-chip agent-chip--${agent}${busy ? ' agent-chip--busy' : ''}`}>
      <span className="agent-chip__icon" aria-hidden="true">
        {AGENT_ICON[agent]}
      </span>
      <span className="agent-chip__label">{AGENT_LABEL[agent]}</span>
    </span>
  );
}

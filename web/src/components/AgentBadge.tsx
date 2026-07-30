import { activeInstance } from '../config/active';
import type { AgentKind, SegmentStatus } from '../types';

export interface AgentBadgeProps {
  agent: AgentKind;
  status?: SegmentStatus;
}

/** Simple glyphs paired with the text label — identity is never color-only. */
const AGENT_ICON: Record<AgentKind, string> = {
  generic: '◆', // diamond
  technical: '⚙', // gear
};

/**
 * Agent identity chip: icon + text label + accent color. The accent color is
 * a per-agent `--ac-*` custom-property NAME from the active instance config
 * (`accentToken`), resolved via `var(...)` in an inline style — Tailwind's
 * static class scanning can't pick up a dynamic token name, so this is the
 * one legitimate escape hatch for consuming the token contract dynamically.
 * Still zero raw hex.
 */
export function AgentBadge({ agent, status }: AgentBadgeProps) {
  const meta = activeInstance.agents[agent];
  const busy = status === 'loading' || status === 'streaming';
  const accent = `var(${meta.accentToken})`;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-ac-full border px-2.5 py-1 text-ac-xs font-ac-medium ${
        busy ? 'motion-safe:animate-pulse' : ''
      }`}
      style={{
        color: accent,
        borderColor: accent,
        backgroundColor: `color-mix(in srgb, ${accent} 12%, transparent)`,
      }}
    >
      <span aria-hidden="true">{AGENT_ICON[agent]}</span>
      <span>{meta.label}</span>
    </span>
  );
}

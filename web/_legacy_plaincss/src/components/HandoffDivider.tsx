import { AgentChip } from './AgentChip';

/** The signature UI element: a visible divider marking Generic -> Technical
 *  handoff within a single assistant turn. Both agent chips + an arrow. */
export function HandoffDivider() {
  return (
    <div className="handoff-divider" role="separator" aria-label="Handed off from Generic to Technical agent">
      <AgentChip agent="generic" />
      <span className="handoff-divider__arrow" aria-hidden="true">
        &rarr;
      </span>
      <AgentChip agent="technical" />
    </div>
  );
}

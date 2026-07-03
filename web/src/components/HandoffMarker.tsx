import { activeInstance } from '../config/active';

/**
 * Divider that introduces the specialist's deep-dive answer (shown only after
 * the user accepted the deep-dive offer). Deliberately NOT a "Generic ->
 * Technical" two-bot handoff chip — the user sees one assistant plus, on
 * request, a clearly-labelled specialist deep-dive. The specialist name comes
 * from the active instance config (template goal).
 */
export function HandoffMarker() {
  const specialist = activeInstance.agents.technical.label;
  return (
    <div
      role="separator"
      aria-label={`${specialist} deep dive`}
      className="my-0.5 flex items-center gap-2.5 py-1"
    >
      <span className="h-px flex-1 bg-ac-border" aria-hidden="true" />
      <span className="inline-flex items-center gap-1.5 text-ac-xs font-ac-medium text-ac-text-secondary">
        <span aria-hidden="true">⚙</span>
        {specialist} deep dive
      </span>
      <span className="h-px flex-1 bg-ac-border" aria-hidden="true" />
    </div>
  );
}

import { useState } from 'react';

export interface ToolTraceProps {
  searchCount: number;
}

/** Secondary-tier collapsible line: "searched · N sources". Collapsed by
 *  default; expanding is purely cosmetic in this minimal build (the source
 *  pills below already show the detail), but the toggle keeps the element
 *  interactive/accessible per the design spec. */
export function ToolTrace({ searchCount }: ToolTraceProps) {
  const [expanded, setExpanded] = useState(false);
  if (searchCount === 0) return null;
  return (
    <button
      type="button"
      className="tool-trace"
      aria-expanded={expanded}
      onClick={() => setExpanded((v) => !v)}
    >
      <span className="tool-trace__caret" aria-hidden="true">
        {expanded ? '▾' : '▸'}
      </span>
      searched &middot; {searchCount} source{searchCount === 1 ? '' : 's'}
    </button>
  );
}

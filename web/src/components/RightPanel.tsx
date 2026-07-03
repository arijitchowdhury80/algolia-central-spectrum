import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

/** Resize bounds + default, per spec. Conceptually ported from RC3
 *  (AlgoliaRAG-Google/rc3-phoenix/src/pages/Index.tsx:13-56) — same
 *  min/max/default and "drag delta off the left edge" math — but
 *  self-contained in one component instead of living in the page. */
const MIN_WIDTH = 300;
const MAX_WIDTH = 640;
const DEFAULT_WIDTH = 400;

export interface RightPanelProps {
  children: ReactNode;
}

/**
 * The judge panel's chrome: resizable + collapsible on desktop (>=1024px,
 * Tailwind `lg`), full-screen overlay-with-scrim below that. `children`
 * (JudgePanel) is rendered identically in both layouts.
 */
export function RightPanel({ children }: RightPanelProps) {
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  // Collapsed by default: the grounding judge is ACS's differentiator but must
  // stay out of the default eyeline and never colour perceived speed. It fires
  // on demand when the user expands the rail (the answer never waits on it).
  const [collapsed, setCollapsed] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    function onMove(e: globalThis.PointerEvent) {
      if (!dragRef.current) return;
      // Handle sits on the LEFT edge of the panel — dragging left (mouse
      // moves toward smaller clientX) widens the panel.
      const delta = dragRef.current.startX - e.clientX;
      const next = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, dragRef.current.startWidth + delta));
      setWidth(next);
    }
    function onUp() {
      if (!dragRef.current) return;
      dragRef.current = null;
      setDragging(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, []);

  const onResizeStart = useCallback(
    (e: ReactPointerEvent) => {
      dragRef.current = { startX: e.clientX, startWidth: width };
      setDragging(true);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    },
    [width],
  );

  return (
    <>
      {/* Desktop: docked column, collapsible to a thin rail. Hidden below lg —
          the mobile trigger + overlay below take over at that breakpoint. */}
      {collapsed ? (
        <aside
          className="hidden shrink-0 flex-col items-center border-l border-ac-border bg-ac-surface py-3 lg:flex"
          style={{ width: '2.5rem' }}
          aria-label="Judge panel (collapsed)"
        >
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            aria-label="Expand judge panel"
            title="Expand judge panel"
            className="rounded-ac-sm p-1.5 text-ac-text-secondary transition-colors duration-ac-fast ease-ac-ease hover:bg-ac-surface-hover hover:text-ac-text"
          >
            <span aria-hidden="true">&lsaquo;</span>
          </button>
        </aside>
      ) : (
        <aside
          className="relative hidden shrink-0 flex-col overflow-hidden border-l border-ac-border bg-ac-surface lg:flex"
          style={{ width: `${width}px` }}
          aria-label="Grounding verdict panel"
        >
          {/* Left-edge resize handle */}
          <div
            onPointerDown={onResizeStart}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize judge panel"
            title="Drag to resize"
            className={`absolute inset-y-0 left-0 z-10 w-1.5 cursor-col-resize transition-colors duration-ac-fast ease-ac-ease hover:bg-ac-border-strong ${
              dragging ? 'bg-ac-border-strong' : 'bg-transparent'
            }`}
          />
          <div className="flex shrink-0 items-center justify-end border-b border-ac-border px-2 py-1.5">
            <button
              type="button"
              onClick={() => setCollapsed(true)}
              aria-label="Collapse judge panel"
              title="Collapse judge panel"
              className="rounded-ac-sm p-1.5 text-ac-text-secondary transition-colors duration-ac-fast ease-ac-ease hover:bg-ac-surface-hover hover:text-ac-text"
            >
              <span aria-hidden="true">&rsaquo;</span>
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">{children}</div>
        </aside>
      )}

      {/* Mobile/tablet (<1024px): floating trigger + full-screen overlay w/ scrim. */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        aria-label="Open grounding verdict panel"
        title="Grounding verdict"
        className="fixed bottom-24 right-4 z-30 flex h-12 w-12 items-center justify-center rounded-ac-full border border-ac-border bg-ac-accent text-ac-lg text-ac-text-on-accent shadow-ac-2 lg:hidden"
      >
        <span aria-hidden="true">⚖</span>
      </button>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 flex lg:hidden" role="dialog" aria-modal="true" aria-label="Grounding verdict panel">
          <button
            type="button"
            className="flex-1 border-0 bg-black/40 p-0"
            onClick={() => setMobileOpen(false)}
            aria-label="Close grounding verdict panel"
          />
          <aside
            className="flex h-full w-full max-w-sm shrink-0 flex-col overflow-hidden bg-ac-surface shadow-ac-3"
            style={{ animation: `acs-right-panel-in var(--ac-dur-slow) var(--ac-ease)` }}
          >
            <div className="flex shrink-0 items-center justify-between border-b border-ac-border px-3 py-2">
              <span className="text-ac-sm font-ac-medium text-ac-text-secondary">Judge</span>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                aria-label="Close judge panel"
                className="rounded-ac-sm p-1.5 text-ac-text-secondary transition-colors duration-ac-fast ease-ac-ease hover:bg-ac-surface-hover hover:text-ac-text"
              >
                <span aria-hidden="true">&times;</span>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">{children}</div>
          </aside>
          <style>{`
            @keyframes acs-right-panel-in {
              from { transform: translateX(100%); }
              to { transform: translateX(0); }
            }
          `}</style>
        </div>
      )}
    </>
  );
}

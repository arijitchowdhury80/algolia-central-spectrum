/**
 * ChatWidget — the custom element's React root.
 *
 * Renders a floating action button (FAB) that opens the chat in one of three
 * window modes — docked, normal, or maximized:
 *
 *   docked     — anchored bottom-right corner panel (no backdrop, host page
 *                stays interactive). Min-size floors guarantee a usable space.
 *   normal     — centered 85vw × 85vh modal with a dimmed backdrop (default).
 *   maximized  — full-viewport modal.
 *
 * The last used mode is persisted to localStorage so the user returns to the
 * same size on the next session.
 *
 * State machine:
 *   docked ──expand──▶ normal ──maximize──▶ maximized
 *   docked ◀──minimize── normal ◀──restore── maximized
 *   any mode ──close──▶ closed
 *
 * The modal is rendered inline in the shadow tree (NOT createPortal to
 * document.body) — portal-to-body would escape the shadow root and lose all
 * injected styles (tokens, theme, Tailwind). position:fixed still works
 * because the shadow host is not a containing block.
 *
 * The WidgetApi contract exposes open/ask to host-page scripts.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppHeader, type SizeMode } from './components/AppHeader';
import { ChatPanel } from './components/ChatPanel';
import { Composer } from './components/Composer';
import { PoweredByAlgolia } from './components/PoweredByAlgolia';
import { SampleQuestions } from './components/SampleQuestions';
import { ProactiveGreeting } from './components/ProactiveGreeting';
import { JudgeDrawer } from '../judge/components/JudgeDrawer';
import { useChat } from './useChat';
import { getRuntimeEnv } from '../config/runtime';
import { activeInstance, useActiveConfig } from '../config/active';
import { proactiveStore, useProactive } from '../config/proactive';
import { WidgetStoreProvider } from './widgetContext';
import type { JudgeVerdict } from '../judge/types';
import type { WidgetApi, WidgetStore } from '../chatRenderer';

// Re-exported for local importers; the canonical definition lives in chatRenderer.ts.
export type { WidgetApi };

export interface ChatWidgetProps {
  apiRef?: { current: WidgetApi | null };
  /** Reactive store from the IS renderer harness. Provides agents + confidence
   *  to the entire subtree via WidgetStoreProvider. */
  widgetStore?: WidgetStore;
  /** Called on every open/close transition so the host can emit a DOM event. */
  onOpenChange?: (open: boolean) => void;
}

// ---------------------------------------------------------------------------
// Size-mode persistence
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'algolia-chat-size-mode';

/**
 * Read the user's persisted mode preference from localStorage.
 * Falls back to `adminDefault` (the `default-open-mode` attribute value)
 * when no user preference has been saved yet, letting the admin control the
 * initial experience without overriding the user's explicit choices.
 */
function readPersistedMode(adminDefault: SizeMode): SizeMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'docked' || v === 'normal' || v === 'maximized') return v;
  } catch {
    /* storage unavailable — fall through to admin default */
  }
  return adminDefault;
}

/**
 * Persist the user's explicit mode choice. Called only when the user clicks
 * a mode-change control (minimize / maximize / restore / expand), NOT on
 * programmatic opens, so the admin default governs first-time visitors.
 */
function persistMode(mode: SizeMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* storage unavailable */
  }
}

// ---------------------------------------------------------------------------
// Panel geometry
// ---------------------------------------------------------------------------

interface PanelGeometry {
  style: React.CSSProperties;
  className: string;
}

/**
 * Panel height, published as a CSS custom property.
 *
 * Overlays inside the panel (the sample-questions popover today) need to bound
 * themselves to the panel, but they cannot read it in CSS: their containing
 * block is whatever small positioned row they sit in, so a percentage height
 * resolves against ~32px and `vh` resolves against a window the panel does not
 * fill. Publishing the panel's own height here gives them the one number they
 * actually need, and it stays correct automatically when the mode changes.
 */
const PANEL_HEIGHT_VAR = '--algolia-chat-panel-height';

/** Build the geometry, mirroring `height` into the custom property. */
function panelGeometry(
  height: string,
  style: React.CSSProperties,
  className: string,
): PanelGeometry {
  return {
    style: { ...style, height, [PANEL_HEIGHT_VAR]: height } as React.CSSProperties,
    className,
  };
}

function getPanelGeometry(mode: SizeMode): PanelGeometry {
  if (mode === 'docked') {
    return panelGeometry(
      'min(640px, calc(100vh - 104px))',
      {
        position: 'fixed',
        // Above the launcher (z-40) and level with the modal overlay (z-50), so
        // the docked panel's header controls are never buried by sibling layers.
        zIndex: 50,
        bottom: '88px', // clears the FAB (56px height + 16px gap + 16px inset)
        right: '16px',
        width: 'min(420px, calc(100vw - 32px))',
        minWidth: '320px',
        minHeight: '480px',
      },
      'overflow-hidden rounded-algolia-xl shadow-algolia-3',
    );
  }
  if (mode === 'maximized') {
    return panelGeometry('100vh', { width: '100vw' }, 'overflow-hidden');
  }
  // normal
  return panelGeometry(
    '85vh',
    { width: '85vw' },
    'overflow-hidden rounded-algolia-xl shadow-algolia-3',
  );
}

// ---------------------------------------------------------------------------
// Chat content (inner panel, mode-agnostic)
// ---------------------------------------------------------------------------

interface ChatContentProps {
  onClose: () => void;
  initialMessage?: string;
  sizeMode: SizeMode;
  onToggleSize: () => void;
  onRestore: () => void;
}

function ChatContent({
  onClose,
  initialMessage,
  sizeMode,
  onToggleSize,
  onRestore,
}: ChatContentProps) {
  const { turns, isStreaming, sendMessage, retryTurn, runDeepDive, declineDeepDive, reset } =
    useChat();
  const { greeting, suggestions, personaLabel } = useProactive();
  const [judgeView, setJudgeView] = useState<{
    verdict: JudgeVerdict;
    question: string;
  } | null>(null);

  const firedRef = useRef(false);
  useEffect(() => {
    if (firedRef.current || !initialMessage) return;
    firedRef.current = true;
    void sendMessage(initialMessage);
  }, [initialMessage, sendMessage]);

  return (
    <div className="relative flex h-full flex-col overflow-hidden font-algolia-sans text-algolia-text">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-algolia-bg" />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            'radial-gradient(55rem 38rem at 12% -8%, color-mix(in srgb, var(--algolia-accent) 13%, transparent), transparent 58%), radial-gradient(48rem 36rem at 106% -6%, color-mix(in srgb, var(--algolia-accent) 9%, transparent), transparent 55%)',
        }}
      />

      <AppHeader
        onReset={() => { proactiveStore.reset(); reset(); }}
        onClose={onClose}
        sizeMode={sizeMode}
        onToggleSize={onToggleSize}
        onRestore={onRestore}
      />

      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="mx-auto flex w-full max-w-algolia-maxw flex-1 flex-col overflow-hidden">
          <ChatPanel
            turns={turns}
            onPickSample={(q) => void sendMessage(q)}
            onRetry={(id) => void retryTurn(id)}
            onDeepDive={(id) => void runDeepDive(id)}
            onDecline={declineDeepDive}
            onPickFollowUp={(q) => void sendMessage(q)}
            onOpenJudge={(verdict, question) => setJudgeView({ verdict, question })}
            isStreaming={isStreaming}
            emptyStateFooter={
              greeting ? (
                <ProactiveGreeting
                  greeting={greeting}
                  suggestions={suggestions}
                  personaLabel={personaLabel}
                  onPickSuggestion={(q) => {
                    proactiveStore.clearGreeting();
                    void sendMessage(q);
                  }}
                />
              ) : null
            }
          />
        </div>

        <div className="shrink-0 border-t border-algolia-border bg-algolia-surface">
          <div className="mx-auto flex w-full max-w-algolia-maxw flex-col gap-2 px-4 py-3 sm:px-6">
            <SampleQuestions onPick={(q) => void sendMessage(q)} disabled={isStreaming} />
            <Composer disabled={isStreaming} onSend={(q) => void sendMessage(q)} />
            <PoweredByAlgolia />
          </div>
        </div>
      </div>

      <JudgeDrawer
        open={judgeView !== null}
        verdict={judgeView?.verdict ?? null}
        question={judgeView?.question ?? ''}
        onClose={() => setJudgeView(null)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Floating action button (collapsed state)
// ---------------------------------------------------------------------------

/**
 * LauncherIcon — the glyph on the collapsed launcher button.
 *
 * Uses the host-supplied `launcher-icon` when present, otherwise the built-in
 * Algolia mark. The built-in path is filled with `currentColor` so it inherits
 * the button's on-accent text colour and stays legible whatever the accent is
 * (the standalone brand asset is solid Algolia blue, which would disappear
 * against a blue button).
 */
function LauncherIcon() {
  if (activeInstance.launcherIcon) {
    return (
      <img src={activeInstance.launcherIcon} alt="" aria-hidden className="h-6 w-6 shrink-0" />
    );
  }
  return (
    <svg width="22" height="22" viewBox="0 0 500 500.34" aria-hidden className="shrink-0">
      <path
        fill="currentColor"
        d="M250,0C113.38,0,2,110.16,.03,246.32c-2,138.29,110.19,252.87,248.49,253.67,42.71,.25,83.85-10.2,120.38-30.05,3.56-1.93,4.11-6.83,1.08-9.52l-23.39-20.74c-4.75-4.22-11.52-5.41-17.37-2.92-25.5,10.85-53.21,16.39-81.76,16.04-111.75-1.37-202.04-94.35-200.26-206.1,1.76-110.33,92.06-199.55,202.8-199.55h202.83V407.68l-115.08-102.25c-3.72-3.31-9.43-2.66-12.43,1.31-18.47,24.46-48.56,39.67-81.98,37.36-46.36-3.2-83.92-40.52-87.4-86.86-4.15-55.28,39.65-101.58,94.07-101.58,49.21,0,89.74,37.88,93.97,86.01,.38,4.28,2.31,8.28,5.53,11.13l29.97,26.57c3.4,3.01,8.8,1.17,9.63-3.3,2.16-11.55,2.92-23.6,2.07-35.95-4.83-70.39-61.84-127.01-132.26-131.35-80.73-4.98-148.23,58.18-150.37,137.35-2.09,77.15,61.12,143.66,138.28,145.36,32.21,.71,62.07-9.42,86.2-26.97l150.36,133.29c6.45,5.71,16.62,1.14,16.62-7.48V9.49C500,4.25,495.75,0,490.51,0H250Z"
      />
    </svg>
  );
}

/**
 * ChatFab — the collapsed launcher, rendered only while the panel is closed.
 *
 * While the concierge agent is deciding whether to proactively engage
 * (`isAnalyzing`), a ring spins around the logo and a soft pulse radiates from
 * the button. The logo itself stays put, so the button remains recognisable as
 * the chat launcher rather than turning into an anonymous spinner. Clicking
 * still opens the chat immediately — the indicator never blocks interaction.
 */
function ChatFab({ onClick }: { onClick: () => void }) {
  const { isAnalyzing } = useProactive();

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={
        isAnalyzing ? activeInstance.strings.widget.analyzing : activeInstance.strings.widget.openChat
      }
      aria-busy={isAnalyzing || undefined}
      className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-algolia-full bg-algolia-accent text-algolia-text-on-accent shadow-algolia-3 transition-all duration-algolia-base ease-algolia-ease hover:-translate-y-1 hover:bg-algolia-accent-hover hover:shadow-algolia-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-algolia-accent focus-visible:ring-offset-2"
    >
      {/* Pulse ring — telegraphs that something is being prepared */}
      {isAnalyzing && (
        <span
          aria-hidden
          className="absolute inline-flex h-full w-full rounded-algolia-full bg-algolia-accent opacity-40 motion-safe:animate-ping"
        />
      )}

      {/* Spinner ring, sized by its insets so `animate-spin`'s transform is not
          competing with any centring translate. */}
      {isAnalyzing && (
        <svg
          viewBox="0 0 48 48"
          fill="none"
          aria-hidden
          className="absolute inset-1 motion-safe:animate-spin"
        >
          <circle cx="24" cy="24" r="22" stroke="currentColor" strokeWidth="2.5" opacity="0.3" />
          {/* Sweep — a 90° arc that reads as motion against the track */}
          <path
            d="M46 24A22 22 0 0 0 24 2"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </svg>
      )}

      <LauncherIcon />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Chat modal / docked panel wrapper
// ---------------------------------------------------------------------------

interface ChatPanelWrapperProps {
  open: boolean;
  onClose: () => void;
  initialMessage?: string;
  sizeMode: SizeMode;
  onToggleSize: () => void;
  onRestore: () => void;
}

function ChatPanelWrapper({
  open,
  onClose,
  initialMessage,
  sizeMode,
  onToggleSize,
  onRestore,
}: ChatPanelWrapperProps) {
  // Keyboard dismiss
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // Scroll-lock only in modal modes (not docked — host page stays usable)
  useEffect(() => {
    if (!open || sizeMode === 'docked') {
      document.body.style.overflow = '';
      return;
    }
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open, sizeMode]);

  if (!open) return null;

  const { style, className } = getPanelGeometry(sizeMode);
  const isDocked = sizeMode === 'docked';

  // IMPORTANT: keep a single, stable wrapper <div> as the top-level element in
  // every mode. Switching between rendering the panel bare (docked) and wrapped
  // in a backdrop (normal/maximized) would change the tree shape and force React
  // to unmount + remount <ChatContent>, wiping the composer input and the
  // in-progress conversation whenever the user expands/minimizes the window.
  // Instead we toggle backdrop styling/attributes on the same wrapper element.
  //
  // The panel itself re-enables pointer events so it stays interactive even when
  // the docked wrapper is click-through (pointer-events-none keeps the host page
  // usable behind the docked panel).
  return (
    <div
      role={isDocked ? undefined : 'dialog'}
      aria-modal={isDocked ? undefined : true}
      aria-label={isDocked ? undefined : activeInstance.strings.widget.modalLabel}
      className={
        isDocked ? 'pointer-events-none' : 'fixed inset-0 z-50 flex items-center justify-center p-4'
      }
      style={isDocked ? undefined : { background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
      onClick={
        isDocked
          ? undefined
          : (e) => {
              if (e.target === e.currentTarget) onClose();
            }
      }
    >
      <div className={`pointer-events-auto ${className}`} style={style}>
        <ChatContent
          onClose={onClose}
          initialMessage={initialMessage}
          sizeMode={sizeMode}
          onToggleSize={onToggleSize}
          onRestore={onRestore}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChatWidget root
// ---------------------------------------------------------------------------

export function ChatWidget({ apiRef, widgetStore, onOpenChange }: ChatWidgetProps) {
  // Re-render when the host reconfigures the embed (an attribute change on
  // <algolia-chat>, or a direct applyRuntimeConfig call). Components below read
  // `activeInstance` at render time, so this is all live reconfiguration needs.
  useActiveConfig();
  const env = getRuntimeEnv();
  const [chatOpen, setChatOpen] = useState(false);
  // Initialise from localStorage if the user has saved a preference; otherwise
  // use the admin-configured default-open-mode (falls back to 'normal').
  const [sizeMode, setSizeMode] = useState<SizeMode>(() =>
    readPersistedMode(activeInstance.defaultOpenMode ?? 'normal'),
  );
  const [pendingMessage, setPendingMessage] = useState<string | undefined>(undefined);

  const setMode = useCallback((mode: SizeMode) => {
    setSizeMode(mode);
    persistMode(mode);
  }, []);

  const openChat = useCallback((prefill?: string) => {
    setPendingMessage(prefill);
    setChatOpen(true);
  }, []);

  const closeChat = useCallback(() => {
    setChatOpen(false);
    setPendingMessage(undefined);
  }, []);

  // Apply the host's configured auto-engage default. Done on mount rather than at
  // module load because config is only resolved once attributes are parsed. Runs
  // for direct chatWidget() consumers too, not just the custom element.
  useEffect(() => {
    proactiveStore.applyAutoEngageDefault(activeInstance.autoEngage);
  }, []);

  // Notify the host on real open/close transitions only. Driven off state rather
  // than the callers so it covers every path (launcher, Escape, backdrop, API)
  // and never double-fires when open() is called on an already-open panel.
  const wasOpenRef = useRef(chatOpen);
  useEffect(() => {
    if (wasOpenRef.current === chatOpen) return;
    wasOpenRef.current = chatOpen;
    onOpenChange?.(chatOpen);
  }, [chatOpen, onOpenChange]);

  useEffect(() => {
    if (!apiRef) return;
    apiRef.current = {
      open: () => openChat(),
      ask: (text: string) => openChat(text),
      setPersona: (agentId, label) => {
        proactiveStore.setPersona(agentId, label);
      },
      engage: ({ greeting, suggestions }) => {
        // Only open the panel if the greeting was accepted — the visitor may have
        // switched auto-engage off, in which case opening would defeat the point.
        const accepted = proactiveStore.engage(greeting, suggestions ?? []);
        if (accepted) openChat();
        return accepted;
      },
      setAnalyzing: (analyzing: boolean) => {
        proactiveStore.setAnalyzing(analyzing);
      },
      getAutoEngage: () => proactiveStore.getSnapshot().autoEngage,
      setAutoEngage: (enabled: boolean) => {
        proactiveStore.setAutoEngage(enabled);
      },
    };
    return () => {
      if (apiRef) apiRef.current = null;
    };
  }, [apiRef, openChat]);

  const content = (
    <>
      {!env && (
        <div className="fixed bottom-6 right-6 z-50 max-w-xs rounded-algolia-md border border-algolia-negative bg-algolia-negative-bg p-4 font-algolia-sans text-algolia-sm text-algolia-negative">
          {activeInstance.strings.widget.missingConfig}
        </div>
      )}
      {env && (
        <>
          {/* FAB — hidden when chat is open in any mode */}
          {!chatOpen && <ChatFab onClick={() => openChat()} />}

          <ChatPanelWrapper
            open={chatOpen}
            onClose={closeChat}
            initialMessage={pendingMessage}
            sizeMode={sizeMode}
            onToggleSize={() => setMode(sizeMode === 'docked' ? 'normal' : 'docked')}
            onRestore={() => setMode('normal')}
          />
        </>
      )}
    </>
  );

  if (widgetStore) {
    return <WidgetStoreProvider store={widgetStore}>{content}</WidgetStoreProvider>;
  }

  return <>{content}</>;
}

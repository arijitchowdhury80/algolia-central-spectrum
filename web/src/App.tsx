import { useEffect, useState } from 'react';
import { AppHeader } from './components/AppHeader';
import { ChatPanel } from './components/ChatPanel';
import { Composer } from './components/Composer';
import { JudgePanel } from './components/JudgePanel';
import { SampleQuestions } from './components/SampleQuestions';
import { RightPanel } from './components/RightPanel';
import { useChat } from './hooks/useChat';
import { getEnvConfig } from './lib/agents';

/** Validates required env config once at startup. Returns the config error
 *  message (if any) so App can render a clear, actionable notice instead of
 *  a blank screen or an uncaught exception. */
function useStartupEnvCheck(): string | null {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    try {
      getEnvConfig();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);
  return error;
}

/**
 * Chat column (left, max-width `--ac-maxw`) + the live grounding-judge
 * RightPanel (right), laid out as a flex row. The judge panel always
 * reflects the most recent assistant answer (JudgePanel recomputes it from
 * `turns` on every render) — no separate wiring needed as new turns stream
 * in. The powered-by footer stays docked under the chat column only.
 */
function AppShell() {
  const { turns, isStreaming, sendMessage, retryTurn, runDeepDive, declineDeepDive, reset } = useChat();

  return (
    <div className="relative flex h-dvh min-h-screen flex-col font-ac-sans text-ac-text">
      {/* Ambient Algolia wash: light canvas + two soft Nebula-Blue glows so the
          page has depth without a flat gray box. Fixed, behind all, inert. */}
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 bg-ac-bg" />
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10"
        style={{
          background:
            'radial-gradient(55rem 38rem at 12% -8%, color-mix(in srgb, var(--ac-accent) 13%, transparent), transparent 58%), radial-gradient(48rem 36rem at 106% -6%, color-mix(in srgb, var(--ac-accent) 9%, transparent), transparent 55%)',
        }}
      />
      <AppHeader onReset={reset} />

      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="mx-auto flex w-full max-w-ac-maxw flex-1 flex-col overflow-hidden px-4 sm:px-6">
            <ChatPanel
              turns={turns}
              onPickSample={sendMessage}
              onRetry={retryTurn}
              onDeepDive={runDeepDive}
              onDecline={declineDeepDive}
              onPickFollowUp={sendMessage}
              isStreaming={isStreaming}
            />
          </div>

          <div className="shrink-0 border-t border-ac-border bg-ac-surface">
            <div className="mx-auto flex w-full max-w-ac-maxw flex-col gap-2 px-4 py-3 sm:px-6">
              <SampleQuestions onPick={sendMessage} disabled={isStreaming} />
              <Composer disabled={isStreaming} onSend={sendMessage} />
            </div>
          </div>
        </div>

        <RightPanel>
          <JudgePanel turns={turns} />
        </RightPanel>
      </div>
    </div>
  );
}

export default function App() {
  const envError = useStartupEnvCheck();

  if (envError) {
    return (
      <div className="mx-auto mt-24 max-w-lg rounded-ac-md border border-ac-negative bg-ac-negative-bg p-6 text-ac-text">
        <h1 className="m-0 mb-2 text-ac-lg font-ac-bold">Configuration error</h1>
        <p className="m-0 text-ac-sm">{envError}</p>
      </div>
    );
  }

  return <AppShell />;
}

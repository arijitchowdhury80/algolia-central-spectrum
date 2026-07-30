/**
 * ChatApp — the chat screen. Lays out the header (AppHeader + Cost), the
 * scrolling ChatPanel, the SampleQuestions row, the Composer, and the
 * JudgeDrawer overlay, all wrapped in `<InstantSearch>` and driven by the
 * `useChat` engine. This is the top-level UI component `App` renders.
 */
import { useState } from 'react';
import { liteClient as algoliasearch } from 'algoliasearch/lite';
import { InstantSearch } from 'react-instantsearch';
import { AppHeader } from './AppHeader';
import { ChatPanel } from './ChatPanel';
import { Composer } from './Composer';
import { CostPage } from './CostPage';
import { JudgeDrawer } from './JudgeDrawer';
import { SampleQuestions } from './SampleQuestions';
import { useChat } from '../hooks/useChat';
import { getEnvConfig } from '../lib/agents';
import type { JudgeVerdict } from '../lib/judgeClient';

const { appId, searchKey } = getEnvConfig();
const searchClient = algoliasearch(appId, searchKey);

/** The chat surface. Must be a child of `<InstantSearch>` (the `useChat` engine
 *  requires that provider) — hence the split from `ChatApp`. */
function ChatSurface() {
  const { turns, isStreaming, sendMessage, retryTurn, runDeepDive, declineDeepDive, reset } = useChat();
  const [judgeView, setJudgeView] = useState<{ verdict: JudgeVerdict; question: string } | null>(null);
  const [view, setView] = useState<'chat' | 'cost'>('chat');

  return (
    <div className="relative flex h-dvh min-h-screen flex-col font-ac-sans text-ac-text">
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 bg-ac-bg" />
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10"
        style={{
          background:
            'radial-gradient(55rem 38rem at 12% -8%, color-mix(in srgb, var(--ac-accent) 13%, transparent), transparent 58%), radial-gradient(48rem 36rem at 106% -6%, color-mix(in srgb, var(--ac-accent) 9%, transparent), transparent 55%)',
        }}
      />
      <AppHeader onReset={reset} onOpenCost={() => setView('cost')} />

      {view === 'cost' ? (
        <div className="flex flex-1 flex-col overflow-hidden">
          <CostPage onClose={() => setView('chat')} />
        </div>
      ) : (
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="mx-auto flex w-full max-w-ac-maxw flex-1 flex-col overflow-hidden px-4 sm:px-6">
            <ChatPanel
              turns={turns}
              onPickSample={sendMessage}
              onRetry={retryTurn}
              onDeepDive={runDeepDive}
              onDecline={declineDeepDive}
              onPickFollowUp={sendMessage}
              onOpenJudge={(verdict, question) => setJudgeView({ verdict, question })}
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
      )}

      <JudgeDrawer
        open={judgeView !== null}
        verdict={judgeView?.verdict ?? null}
        question={judgeView?.question ?? ''}
        onClose={() => setJudgeView(null)}
      />
    </div>
  );
}

export function ChatApp() {
  return (
    <InstantSearch searchClient={searchClient} indexName="ACS_SPECTRUM_MULTI">
      <ChatSurface />
    </InstantSearch>
  );
}

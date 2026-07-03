import { useEffect, useRef, useState } from 'react';
import { Thread } from './components/Thread';
import { Composer } from './components/Composer';
import { useChat } from './hooks/useChat';
import { getEnvConfig } from './lib/agents';
import './styles/tokens.css';
import './styles/app.css';

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

function AppShell() {
  const { turns, isStreaming, sendMessage, retryTurn } = useChat();
  const threadEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns]);

  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="app-header__title">Spectrum Assistant</span>
        <span className="app-header__subtitle">Adobe Spectrum design + React docs</span>
      </header>

      <main className="app-main">
        <Thread turns={turns} onPickSample={sendMessage} onRetry={retryTurn} />
        <div ref={threadEndRef} />
      </main>

      <div className="app-composer-dock">
        <Composer disabled={isStreaming} onSend={sendMessage} />
      </div>
    </div>
  );
}

export default function App() {
  const envError = useStartupEnvCheck();

  if (envError) {
    return (
      <div className="startup-error">
        <h1>Configuration error</h1>
        <p>{envError}</p>
      </div>
    );
  }

  return <AppShell />;
}

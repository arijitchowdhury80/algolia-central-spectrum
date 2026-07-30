import { useEffect, useState } from 'react';
import { ChatApp } from './components/ChatApp';
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

  return <ChatApp />;
}

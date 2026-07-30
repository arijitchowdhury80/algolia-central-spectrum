/// <reference types="vite/client" />

// CSS imported with `?inline` returns the processed stylesheet as a string,
// which embed.tsx injects into the Shadow DOM.
declare module '*.css?inline' {
  const css: string;
  export default css;
}

// The widget takes all configuration at runtime (element attributes + slots),
// not from build-time env. These optional VITE_* reads remain only as a
// fallback for the dev harness / tests.
interface ImportMetaEnv {
  readonly VITE_ALGOLIA_APP_ID?: string;
  readonly VITE_ALGOLIA_SEARCH_API_KEY?: string;
  readonly VITE_JUDGE_URL?: string;
  readonly VITE_JUDGE_API_KEY?: string;
  readonly VITE_JUDGE_MODE?: string;
  readonly VITE_JUDGE_AGENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Algolia application ID (fallback for builds that don't use <algolia-chat> attributes). */
  readonly VITE_ALGOLIA_APP_ID?: string;
  /** Algolia search-only API key. */
  readonly VITE_ALGOLIA_SEARCH_API_KEY?: string;
  /** Base URL of the hosted judge HTTP service. Default: http://localhost:8788 */
  readonly VITE_JUDGE_URL?: string;
  /** Auth key for the hosted judge service (x-judge-api-key header). */
  readonly VITE_JUDGE_API_KEY?: string;
  /** Judge backend mode: 'hosted' | 'algolia' | 'off'. Default: 'hosted' */
  readonly VITE_JUDGE_MODE?: string;
  /** Agent Studio agent UUID for the in-browser judge (algolia mode). */
  readonly VITE_JUDGE_AGENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

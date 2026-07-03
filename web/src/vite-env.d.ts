/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ALGOLIA_APP_ID: string;
  readonly VITE_ALGOLIA_SEARCH_API_KEY: string;
  /** Base URL of the live judge HTTP service (lab/server `npm run judge:serve`).
   *  Defaults to http://localhost:8788 when unset — see lib/judgeClient.ts. */
  readonly VITE_JUDGE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

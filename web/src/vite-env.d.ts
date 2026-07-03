/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ALGOLIA_APP_ID: string;
  readonly VITE_ALGOLIA_SEARCH_API_KEY: string;
  /** Base URL of the live judge HTTP service. Defaults to http://localhost:8788
   *  when unset (local `npm run judge:serve`). For the hosted VPS judge set it to
   *  https://judge.contentengagement.info — see lib/judgeClient.ts. */
  readonly VITE_JUDGE_URL?: string;
  /** Shared secret sent as `x-lab-key` to the hosted judge backend (auth gate in
   *  lab/server/src/auth.ts). Browser-shipped, like AC2 — the server rate-limiter
   *  is the real abuse guard. Unset = no header (fine for an unauthenticated local
   *  judge). */
  readonly VITE_LAB_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

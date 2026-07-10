# 00 — Discovery (spike unknowns)

Both tracks' unknowns are already spiked and closed before this run started — no new discovery needed, auto-gate.

- **Track A's mechanism** (client-awaited classification call replacing the async `config.suggestions` read) uses the identical `callCompletions`/`parseCompletionStream` pattern already proven live in tonight's E2E test (`scripts/spikes/agent-tool-handoff/e2e-orchestrator-validation.mjs`, `callDirectAgent`) — 10/10 real trials. No new wire shape to discover.
- **Track B's mechanism** (orchestrator, 2 `client_side` tools, tool-call frame handling, resume shape) is proven across three separate spikes: `docs/spikes/2026-07-08-agent-to-agent-tool-VERDICT.md` (original tool schema + resume shape), `docs/spikes/2026-07-09-pure-orchestrator-VERDICT.md` (chaining mechanics, faked data), and tonight's `docs/spikes/2026-07-10-e2e-orchestrator-results.json` (chaining mechanics, REAL data, 10/10 after a test-script scoring-bug fix).
- **The one open product decision from the plan doc** (`docs/plans/2026-07-10-reconciled-handoff-architecture-build.md` §2, B0) — auto-chain vs. human-gate on Track B's specialist call — is resolved: Arijit chose auto-run Technical on chain.

Gate: AUTO (no unknowns remain unspiked).

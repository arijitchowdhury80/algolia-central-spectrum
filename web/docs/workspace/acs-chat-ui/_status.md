# ACS Chat UI — build status

Feature: fresh minimal 2-agent chat (Generic + Technical) on Adobe Spectrum corpus.
Reference: AC2 `web/` (wire protocol only; NOT the 2×2 matrix/judge shell).

## Progress
- [x] Design thinking (01-design-thinking.md)
- [x] Handoff protocol decided (02-handoff-protocol.md) + Generic agent redeployed w/ sentinel (live, verified)
- [x] Aesthetic selection (theme-dashboard) + UIUX constraints (07b)
- [x] Build (Vite + React 19 + TS) — compiles clean, 0 TS errors (built by Sonnet subagent)
- [x] Code review (self, T3): wire protocol port, baton logic, facets, XSS-safety all verified
- [ ] Browser smoke test (BLOCKED on search-only key mint — Arijit pasting master Admin key)
- [ ] UIUX checkpoint (in-browser) + ui-validator + done

## Validation risk surface (honest)
- `npm run build` (tsc + vite) PROVES: type safety, no compile errors, imports resolve.
- Does NOT prove: the live Agent Studio stream parses correctly, the search-only key is accepted by the completions endpoint, or the sentinel handoff fires end-to-end. Only the browser smoke test proves that. Gated on the key.

## Blocker
Browser search-only key for ACS_SPECTRUM_MULTI pending. Build proceeds with placeholder env.

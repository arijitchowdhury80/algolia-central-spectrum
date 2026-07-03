# Status — ac-chat-ux (Algolia-Central chat UX framework · ACS instance #1)

Feature: templatizable AC chat shell (structure = ours, skin = client design system). ACS = Adobe/Spectrum skin.

## Progress
- [x] Phase 1 Design Thinking → `01-design-thinking.md` (6 steps, framework + instance)
- [~] Step 7 Aesthetic → `07-aesthetic.md` (framework default = theme-clean; skin = Spectrum)
- [ ] Step 7.5 UI/UX constraints → `07b-uiux-constraints.md`
- [ ] Step 0 (build) Mint browser-safe SEARCH-ONLY Algolia key → `.env.local` as ALGOLIA_SEARCH_API_KEY
- [ ] Step 8 Scaffold Vite+React+TS app in `web/`; token contract `tokens.css`; port `agentStudioClient` from AC2
- [ ] Step 8 Build structure components (AppShell, ChatColumn, Composer, SourceCards, AgentThread, JudgeDrawer, SampleQuestions, EmptyState)
- [ ] Step 8 Spectrum skin theme + instanceConfig; prove skin swap
- [ ] Step 9 UI/UX checkpoint
- [ ] Step 10 Browser test (streaming, grounding frames, handoff, 375px, dark)
- [ ] Step 11 ui-validator + record-knowledge

## Key facts
- Backend LIVE: app `0EXRPAXB56`, index `ACS_SPECTRUM_MULTI`, neural on.
- Agents: Generic `13809d4b-6b6d-4297-b95c-a934bceef0b4` · Technical `63ab0c86-3493-416b-a771-a820ab25d83d`.
- Stack (match AC2 web): Vite + React + TS + vitest, hand-rolled CSS via CSS-variable tokens. No CSS framework.
- Port engine only from AC2 web (`lib/agentStudioClient`); build fresh minimal shell (NO 2×2 matrix/leaderboard).
- Protocol read-receipt REQUIRED before touching Agent Studio streaming frame format.

## Contract (freeze early)
`tokens.css` variable names = the API between our structure and any client design system. Structure consumes ONLY var(--token) + instanceConfig.

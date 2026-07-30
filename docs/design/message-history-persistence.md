# Message-history persistence — design (DEFERRED, NOT YET IMPLEMENTED)

**Status:** design only. No code implements this yet. Written so the flow is documented before it is built. Implement only on an explicit go.

## Why this exists

Agent Studio is **stateless** — every completions call is independent, carries no server-side memory. Continuity is entirely the client's job: before each turn the client re-sends the whole conversation as `messages: [...history, {role:'user', content}]` (`web/src/lib/agentStudio.ts:224`). Two consequences:

1. **Refresh = amnesia.** `turns` lives only in React state (`web/src/hooks/useChat.tsx`); a page reload wipes the conversation.
2. **Cost grows per turn** because history is resent each time — the `useChat` transport replays prior messages on each turn.

This doc covers **persistence** (surviving refresh) — a separate concern from context management (what we replay to the model, already handled).

## The tiered model (pick by requirement, not by fanciness)

| Tier | Tech | Survives | Cost | When |
|---|---|---|---|---|
| 0 | React state (today) | nothing | free | demo baseline |
| 1 | **localStorage / sessionStorage** | refresh, tab close | free, client-side | the 90% answer for a single-device chat |
| 2 | **IndexedDB** (via `idb-keyval`/Dexie) | same + large/structured | free, client-side | many conversations, attachments, >5MB |
| 3 | Backend DB | cross-device, login | $ + infra | only when a feature (cross-device, sharing, admin analytics) demands it |

**Key insight — scale is a non-issue for Tiers 1–2.** Storage lives on each user's own machine: 100k users = 100k independent ~5MB pots, zero server storage, nothing to back up. The real scaling cost of stateless chat is **LLM compute** (history resent per turn), not storage. A backend (Tier 3) is forced by *cross-user/cross-device features*, never by storage scale.

### Tier-1 specifics (the likely first build)
- ~5MB quota is **per origin, total** (all keys for the deployed domain combined) — not per conversation. A text turn is ~1–2KB, so thousands of turns fit; the ceiling is hit by hoarding many conversations or storing hit/source-card payloads.
- **Version the schema:** store `{ version, turns }`; on load, if the version mismatches, migrate or discard — never crash. Wrap parse in try/catch (corrupt storage → reset, not white-screen).
- **Persist the trimmed shape, not raw tool payloads** — store what `turnToHistory` already produces (prose, summarized), never `rawHits`. Keeps it small and avoids re-poisoning context.
- **Never store secrets** — localStorage is readable by any script on the page (XSS surface). The search-only key is already public; nothing else goes in.
- Handle `QuotaExceededError`: evict the oldest conversation on failure.

## CRITICAL: one persistence layer, not two

Persistence is **OFF** — a refresh wipes the conversation. The chat engine (`useChat`) uses `react-instantsearch` `useChat` for transport only and does not enable its built-in `sessionStorage` persistence. The app's turn model is `ChatTurn[]` (`lib/chatTurns.ts`), which includes the Technical baton as `segments[1]` — a shape the react-instantsearch message store doesn't model. **So when persistence is built, own Tier 1 localStorage here**, keyed off `ChatTurn[]`; do not adopt the react-instantsearch store. Implement this whenever chat history is prioritized.

## Relationship to personalization

The future user-profile block (`docs/ARCHITECTURE.md` "Personalization (future)") is a *different* artifact (a small always-injected profile) but shares the same store. Build the store once with a small interface (`save/load/clear`) behind which Tier 1/2/3 can swap — so the templatized Algolia-Central shell can later move localStorage → backend without touching chat logic.

## Not doing (and why)
- **Claude's file-based memory-tool pattern** (`/memories` dir, client-executed file ops): designed for autonomous multi-session task agents, overkill for a Q&A demo. The injected-profile + client persistence above captures the value at a fraction of the complexity.

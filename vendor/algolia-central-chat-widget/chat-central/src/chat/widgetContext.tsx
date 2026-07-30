/**
 * widgetContext — React context that streams IS render state into the chat tree.
 *
 * `WidgetStoreProvider` wraps the chat UI tree with the external store created
 * in `chatRenderer.tsx`. Child components call `useWidgetState()` to subscribe
 * via `useSyncExternalStore` so they receive live updates whenever IS fires a
 * new render cycle (e.g. when a child `<algolia-chat-agent>` or
 * `<algolia-chat-confidence>` element connects or disconnects).
 *
 * Fallback: when no store is in context (e.g. tests, Storybook, legacy embed
 * without IS), `useWidgetState()` returns a stable empty state so consumers
 * can still fall back to the activeInstance singleton gracefully.
 */

import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import type { WidgetStore, WidgetState } from '../chatRenderer';

const emptyState: WidgetState = { agents: {}, confidence: null };

const emptyStore: WidgetStore = {
  getSnapshot: () => emptyState,
  subscribe: () => () => {},
  update: () => {},
};

const WidgetContext = createContext<WidgetStore>(emptyStore);

/** Wrap the chat UI tree with the renderer's external store. */
export function WidgetStoreProvider({
  store,
  children,
}: {
  store: WidgetStore;
  children: ReactNode;
}) {
  return <WidgetContext.Provider value={store}>{children}</WidgetContext.Provider>;
}

/**
 * Subscribe to the current IS render state slice.
 * Returns `{ agents, confidence }` from the nearest `WidgetStoreProvider`.
 * Falls back to `{ agents: {}, confidence: null }` when no provider is present.
 */
export function useWidgetState(): WidgetState {
  const store = useContext(WidgetContext);
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

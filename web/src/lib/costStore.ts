/**
 * costStore — session-wide cumulative cost ledger (spike plan §6).
 *
 * A tiny framework-free external store (subscribe/getSnapshot, read via
 * `useSyncExternalStore` — no new state-management dependency, consistent
 * with this app's existing pattern of plain hooks over `useState`/`useRef`,
 * e.g. useChat.ts/useJudge.ts). Deliberately outside React state because the
 * source of one entry (an agent's estimated cost, recorded once an answer
 * segment finishes) and the other (a judge's exact usage, recorded once its
 * verdict resolves) live in two different components/hooks that don't share
 * a parent's state — a small shared store is simpler than threading a setter
 * through both.
 *
 * `resetCostEntries()` is wired to the same "start over" action as
 * `useChat().reset()` — a new session should start with an empty ledger.
 */
import { useSyncExternalStore } from 'react';

export type CostKind = 'agent' | 'judge';
export type CostMethod = 'ESTIMATED' | 'EXACT';

export interface CostEntry {
  /** De-dupe key so a re-render (e.g. streaming text ticking in) can never
   *  double-record the same answer/verdict. Callers own uniqueness. */
  id: string;
  turnId: string;
  agent: 'generic' | 'technical';
  kind: CostKind;
  method: CostMethod;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

let entries: CostEntry[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

/** Record one cost entry. No-op (silently ignored) if `id` was already
 *  recorded — callers don't need their own dedupe guard. */
export function recordCost(entry: CostEntry): void {
  if (entries.some((e) => e.id === entry.id)) return;
  entries = [...entries, entry];
  emit();
}

export function getCostEntries(): CostEntry[] {
  return entries;
}

/** Clear the ledger — call on session reset (App.tsx wires this to useChat's reset). */
export function resetCostEntries(): void {
  entries = [];
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** React hook: the live, always-current list of cost entries for this session. */
export function useCostEntries(): CostEntry[] {
  return useSyncExternalStore(subscribe, getCostEntries);
}

export interface CostTotals {
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  agentCostUsd: number;
  judgeCostUsd: number;
}

/** Pure aggregation over a list of entries — exported so the session cost
 *  page and its tests don't have to duplicate the reduce. */
export function summarizeCostEntries(list: readonly CostEntry[]): CostTotals {
  let totalCostUsd = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let agentCostUsd = 0;
  let judgeCostUsd = 0;
  for (const e of list) {
    totalCostUsd += e.costUsd;
    totalInputTokens += e.inputTokens;
    totalOutputTokens += e.outputTokens;
    if (e.kind === 'agent') agentCostUsd += e.costUsd;
    else judgeCostUsd += e.costUsd;
  }
  return { totalCostUsd, totalInputTokens, totalOutputTokens, agentCostUsd, judgeCostUsd };
}

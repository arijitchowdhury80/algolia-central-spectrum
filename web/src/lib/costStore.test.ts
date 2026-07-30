import { describe, it, expect, beforeEach } from 'vitest';
import { recordCost, getCostEntries, resetCostEntries, summarizeCostEntries, type CostEntry } from './costStore';

function entry(overrides: Partial<CostEntry> = {}): CostEntry {
  return {
    id: 't1:generic:agent',
    turnId: 't1',
    agent: 'generic',
    kind: 'agent',
    method: 'ESTIMATED',
    model: 'gemini-2.5-flash',
    inputTokens: 100,
    outputTokens: 50,
    costUsd: 0.0001,
    ...overrides,
  };
}

describe('costStore', () => {
  beforeEach(() => resetCostEntries());

  it('records an entry and returns it from getCostEntries', () => {
    recordCost(entry());
    expect(getCostEntries()).toHaveLength(1);
  });

  it('de-dupes by id — recording the same id twice is a no-op', () => {
    recordCost(entry({ id: 'dupe' }));
    recordCost(entry({ id: 'dupe', costUsd: 999 })); // different payload, same id
    const all = getCostEntries();
    expect(all).toHaveLength(1);
    expect(all[0].costUsd).toBe(0.0001); // first write wins
  });

  it('resetCostEntries clears the ledger', () => {
    recordCost(entry());
    resetCostEntries();
    expect(getCostEntries()).toHaveLength(0);
  });

  it('summarizeCostEntries sums totals and splits agent vs judge', () => {
    const list: CostEntry[] = [
      entry({ id: 'a1', kind: 'agent', costUsd: 0.01, inputTokens: 10, outputTokens: 5 }),
      entry({ id: 'j1', kind: 'judge', method: 'EXACT', costUsd: 0.02, inputTokens: 20, outputTokens: 8 }),
    ];
    const totals = summarizeCostEntries(list);
    expect(totals.totalCostUsd).toBeCloseTo(0.03, 8);
    expect(totals.agentCostUsd).toBeCloseTo(0.01, 8);
    expect(totals.judgeCostUsd).toBeCloseTo(0.02, 8);
    expect(totals.totalInputTokens).toBe(30);
    expect(totals.totalOutputTokens).toBe(13);
  });

  it('summarizeCostEntries on an empty list is all zeros', () => {
    expect(summarizeCostEntries([])).toEqual({
      totalCostUsd: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      agentCostUsd: 0,
      judgeCostUsd: 0,
    });
  });
});

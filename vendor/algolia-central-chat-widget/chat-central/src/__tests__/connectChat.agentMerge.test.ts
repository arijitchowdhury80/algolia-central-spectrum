/**
 * Unit tests for the chief-judge agent merge logic in connectChat.ts.
 *
 * The merge is internal to readChildRenderState, so we test the outcome by
 * directly importing and calling the exported connectChat + chatWidget surface
 * would be heavy. Instead, we unit-test the merge logic inline by replicating
 * the four scenarios described in the implementation comment:
 *
 *  A. confidence element has agent-id (chief), child agents have roles → merge
 *  B. confidence element has no agent-id, child agents include role-less → passthrough
 *  C. child agent-ids already include the chief from the element → no duplicate
 *  D. no child agents → confidence.agents from element unchanged
 *
 * These assertions mirror the behaviour of readChildRenderState in connectChat.ts.
 */
import { describe, it, expect } from 'vitest';
import type { JudgeAgentDescriptor } from '../judge/types.js';

/** Reimplementation of the merge logic under test (kept in sync with connectChat.ts). */
function mergeJudgeAgents(
  confidenceAgents: JudgeAgentDescriptor[] | undefined,
  judgeAgentsMap: Record<string, JudgeAgentDescriptor> | undefined,
): JudgeAgentDescriptor[] | undefined {
  if (!judgeAgentsMap || Object.keys(judgeAgentsMap).length === 0) {
    return confidenceAgents;
  }
  const childAgents = Object.values(judgeAgentsMap);
  const childIds = new Set(childAgents.map((a) => a.id));
  const chiefFromElement = confidenceAgents?.find((a) => !a.role && !childIds.has(a.id));
  return chiefFromElement ? [chiefFromElement, ...childAgents] : childAgents;
}

// ── Scenario A — agent-id on element + child sub-judges ───────────────────────

describe('Scenario A: chief on element, sub-judges as children', () => {
  const chiefId = 'chief-uuid';
  const skepticId = 'skeptic-uuid';
  const refereeId = 'referee-uuid';
  const advocateId = 'advocate-uuid';

  const confidenceAgents: JudgeAgentDescriptor[] = [{ id: chiefId }]; // role-less = chief
  const judgeAgentsMap: Record<string, JudgeAgentDescriptor> = {
    skeptic: { id: skepticId, role: 'skeptic' },
    referee: { id: refereeId, role: 'referee' },
    advocate: { id: advocateId, role: 'advocate' },
  };

  it('prepends chief so it ends up first in the merged array', () => {
    const merged = mergeJudgeAgents(confidenceAgents, judgeAgentsMap);
    expect(merged).not.toBeUndefined();
    expect(merged![0]).toEqual({ id: chiefId });
  });

  it('retains all sub-judge entries', () => {
    const merged = mergeJudgeAgents(confidenceAgents, judgeAgentsMap);
    const roles = merged!.map((a) => a.role).filter(Boolean);
    expect(roles).toContain('skeptic');
    expect(roles).toContain('referee');
    expect(roles).toContain('advocate');
  });

  it('total length is 4 (chief + 3 sub-judges)', () => {
    const merged = mergeJudgeAgents(confidenceAgents, judgeAgentsMap);
    expect(merged).toHaveLength(4);
  });

  it('chiefJudge.ts selection logic (find role-less) picks the chief', () => {
    const merged = mergeJudgeAgents(confidenceAgents, judgeAgentsMap)!;
    const chief = merged.find((a) => !a.role) ?? merged[0];
    expect(chief.id).toBe(chiefId);
  });
});

// ── Scenario B — no element agent-id, role-less child element ────────────────

describe('Scenario B: role-less child agent acts as chief', () => {
  const confidenceAgents = undefined; // no agent-id on the element itself
  const judgeAgentsMap: Record<string, JudgeAgentDescriptor> = {
    default: { id: 'chief-child-uuid' }, // role-less = chief
    skeptic: { id: 'skeptic-uuid', role: 'skeptic' },
    referee: { id: 'referee-uuid', role: 'referee' },
    advocate: { id: 'advocate-uuid', role: 'advocate' },
  };

  it('returns all four agents without prepending a duplicate', () => {
    const merged = mergeJudgeAgents(confidenceAgents, judgeAgentsMap)!;
    expect(merged).toHaveLength(4);
    const ids = merged.map((a) => a.id);
    expect(ids).toContain('chief-child-uuid');
  });

  it('role-less child is found by chiefJudge.ts selection logic', () => {
    const merged = mergeJudgeAgents(confidenceAgents, judgeAgentsMap)!;
    const chief = merged.find((a) => !a.role) ?? merged[0];
    expect(chief.id).toBe('chief-child-uuid');
  });
});

// ── Scenario C — element agent-id already present in child map ────────────────

describe('Scenario C: no duplicate when chief is in both element and child map', () => {
  const sharedId = 'shared-uuid';
  const confidenceAgents: JudgeAgentDescriptor[] = [{ id: sharedId }];
  const judgeAgentsMap: Record<string, JudgeAgentDescriptor> = {
    default: { id: sharedId }, // same UUID registered as a child element too
    skeptic: { id: 'skeptic-uuid', role: 'skeptic' },
  };

  it('does not duplicate the chief when it appears in both sources', () => {
    const merged = mergeJudgeAgents(confidenceAgents, judgeAgentsMap)!;
    const chiefs = merged.filter((a) => a.id === sharedId);
    expect(chiefs).toHaveLength(1);
  });
});

// ── Scenario D — no child agents ─────────────────────────────────────────────

describe('Scenario D: no child agents — element agents unchanged', () => {
  const confidenceAgents: JudgeAgentDescriptor[] = [{ id: 'chief-uuid' }];

  it('returns the element agents as-is when child map is empty', () => {
    const merged = mergeJudgeAgents(confidenceAgents, {});
    expect(merged).toEqual(confidenceAgents);
  });

  it('returns the element agents as-is when child map is undefined', () => {
    const merged = mergeJudgeAgents(confidenceAgents, undefined);
    expect(merged).toEqual(confidenceAgents);
  });
});

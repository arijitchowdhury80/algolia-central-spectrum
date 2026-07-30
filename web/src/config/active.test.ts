import { describe, expect, it, vi } from 'vitest';
import { withDevAgentOverrides } from './active';
import type { InstanceConfig } from './instance';

// Synthetic fixture instance — pure string-plumbing test, not agent behavior
// (same line this repo already draws for buildTechnicalHistory's test per
// 05-plan.md Task A3). No real agent IDs needed.
const mockInstance: InstanceConfig = {
  id: 'mock',
  brandName: 'Mock Central',
  productTitle: 'Mock Product',
  subtitle: 'Mock subtitle',
  logo: { header: '/mock-header.svg', mark: '/mock-mark.svg' },
  poweredBy: { label: 'Powered by Algolia', logo: '/mock-algolia.svg' },
  corpusName: 'Mock corpus',
  theme: 'algolia',
  agents: {
    generic: { id: 'live-generic-id', label: 'Generic', accentToken: '--ac-agent-generic' },
    technical: { id: 'live-technical-id', label: 'Technical', accentToken: '--ac-agent-technical' },
    classifier: { id: 'live-classifier-id', label: 'Classifier (internal)', accentToken: '--ac-agent-classifier' },
  },
  sampleQuestions: [],
  sourceFacets: [],
  disclaimer: 'Mock disclaimer',
};

describe('withDevAgentOverrides', () => {
  it('is a no-op when rawOverrides is undefined (identity/no-op)', () => {
    const result = withDevAgentOverrides(mockInstance, undefined);
    expect(result).toEqual(mockInstance);
  });

  it('applies a matching override key onto agents, leaving other keys unchanged', () => {
    const result = withDevAgentOverrides(mockInstance, '{"generic":"dev-id-123"}');
    expect(result.agents.generic.id).toBe('dev-id-123');
    expect(result.agents.technical.id).toBe(mockInstance.agents.technical.id);
  });

  it('falls back to the unchanged instance on malformed JSON and logs console.error once', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = withDevAgentOverrides(mockInstance, 'not valid json');
    expect(result).toEqual(mockInstance);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  it('is inert against an unknown key — no key is invented on agents', () => {
    const result = withDevAgentOverrides(mockInstance, '{"nonexistentKey":"x"}');
    expect(result).toEqual(mockInstance);
    expect('nonexistentKey' in result.agents).toBe(false);
  });

  it('warns loudly via console.warn when any real override is applied', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    withDevAgentOverrides(mockInstance, '{"generic":"dev-id-123"}');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

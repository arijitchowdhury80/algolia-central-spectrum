/**
 * ACS (Algolia-Central-Spectrum) instance config — Adobe Spectrum docs.
 *
 * Agent IDs rebuilt 2026-07-08 via `scripts/agents/build_acs_agents.mjs`
 * (delete+recreate, so IDs changed) when Generic's handoff moved from a text
 * sentinel to a real `consult_technical_specialist` client-side tool call —
 * see docs/spikes/2026-07-08-agent-to-agent-tool-VERDICT.md. If these ever
 * drift, SESSION.md's "Agent IDs:" line is the source of truth.
 */
import type { InstanceConfig } from '../instance';

export const spectrumInstance: InstanceConfig = {
  id: 'spectrum',
  brandName: 'Algolia Central',
  productTitle: 'Adobe Spectrum',
  subtitle: 'Adobe Spectrum docs',
  logo: {
    header: '/brand/adobe-logo.svg',
    mark: '/brand/adobe-logo.svg',
  },
  poweredBy: {
    label: 'Powered by Algolia',
    logo: '/brand/algolia-mark.svg',
  },
  corpusName: 'Adobe Spectrum design + React code',
  theme: 'spectrum',
  agents: {
    generic: {
      id: 'a94ee722-f8c0-40e5-8610-6bc1c250f72a',
      label: 'Assistant',
      accentToken: '--ac-agent-generic',
    },
    technical: {
      id: 'a15c8b8c-cd5c-4222-ad80-d840b1c8cd2e',
      label: 'code specialist',
      accentToken: '--ac-agent-technical',
    },
  },
  sampleQuestions: [
    {
      section: 'Foundations',
      questions: [
        'Which accent color tokens does Spectrum provide?',
        'What type styles and sizes does Spectrum define?',
        'How does the Spectrum spacing and sizing scale work?',
      ],
    },
    {
      section: 'Choosing a component',
      questions: [
        'When should I use a ComboBox vs a Picker?',
        'When should I use a Dialog vs a Tray?',
        'ActionButton vs Button — which fits my use case?',
      ],
    },
    {
      section: 'Building in React',
      questions: [
        'How do I create a controlled ComboBox in React Spectrum?',
        'How do I add a date range picker in React?',
        'How do I build a form with validation in React Spectrum?',
      ],
    },
    {
      section: 'Versions & accessibility',
      questions: [
        'What changed between React Spectrum v3 and S2?',
        'How do I migrate a component from v3 to S2?',
        'How does React Spectrum handle keyboard navigation and ARIA?',
      ],
    },
  ],
  // Sources match the live ACS_SPECTRUM_MULTI corpus (Scout re-ingest 2026-07-02:
  // GitHub s2-docs + react-spectrum.adobe.com S2+V3; react-aria removed).
  sourceFacets: [
    { value: 'SpectrumDesignDocs', label: 'Spectrum Design Docs' },
    { value: 'ReactSpectrumS2', label: 'React Spectrum S2' },
    { value: 'ReactSpectrumV3', label: 'React Spectrum v3' },
  ],
  disclaimer: 'Grounded in Adobe Spectrum docs — every answer cites its source.',
};

export default spectrumInstance;

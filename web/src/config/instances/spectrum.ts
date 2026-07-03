/**
 * ACS (Algolia-Central-Spectrum) instance config — Adobe Spectrum docs.
 *
 * Agent IDs verified 2026-07-01 against SESSION.md + web/docs/workspace/
 * acs-chat-ui/02-handoff-protocol.md (both agree — see lib/agents.ts header
 * for the same note). If these ever drift, SESSION.md's "Agent IDs:" line is
 * the source of truth.
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
      id: '13809d4b-6b6d-4297-b95c-a934bceef0b4',
      label: 'Assistant',
      accentToken: '--ac-agent-generic',
    },
    technical: {
      id: '63ab0c86-3493-416b-a771-a820ab25d83d',
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

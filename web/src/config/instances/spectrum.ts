/**
 * ACS (Algolia-Central-Spectrum) instance config — Adobe Spectrum docs.
 *
 * Agent IDs updated 2026-07-09: the 2026-07-01 IDs were deleted server-side
 * during spike-branch redeploys of `scripts/agents/build_acs_agents.mjs`
 * (that script used to delete+recreate agents by name on every run — fixed
 * to PATCH in place, see that file's history). IDs below are the live,
 * currently-published `ACS-generic-neural` / `ACS-technical-neural` agents,
 * confirmed via `GET /agent-studio/1/agents` on 2026-07-09.
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
      id: '95826da6-d1b6-4b81-b061-bfb52b881356',
      label: 'Assistant',
      accentToken: '--ac-agent-generic',
    },
    technical: {
      id: 'ae127977-c728-4b7c-bc15-6502a77873d1',
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

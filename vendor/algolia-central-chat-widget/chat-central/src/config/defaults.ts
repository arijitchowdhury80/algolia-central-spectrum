/**
 * Neutral default instance — a look-less scaffold so the widget never crashes
 * before attributes/slots are applied. Real branding (logo, title, sample
 * questions, source facets) is supplied per embed via <algolia-chat>
 * attributes + child elements and merged in by config/runtime.ts.
 */
import type { InstanceConfig } from './instance';
import { defaultStrings } from './strings';

export const defaultInstance: InstanceConfig = {
  id: 'default',
  brandName: 'Algolia Central',
  productTitle: 'AI Assistant',
  subtitle: 'Grounded answers',
  logo: { header: '', mark: '' },
  newChatIcon: '',
  poweredBy: { label: 'Powered by Algolia', logo: '' },
  corpusName: 'the docs',
  theme: 'algolia',
  agents: {
    primary: { key: 'primary', id: '', label: 'Assistant', accentToken: '--algolia-agent-primary' },
    specialists: [],
    classifier: undefined,
  },
  sampleQuestions: [],
  sourceFacets: [],
  disclaimer: '',
  strings: defaultStrings,
  welcome: { present: false, show: true },
  userAvatar: '',
  defaultOpenMode: 'normal',
  launcherIcon: '',
  autoEngage: true,
  analyzingTimeoutMs: 30_000,
  autoEngageToggle: false,
};

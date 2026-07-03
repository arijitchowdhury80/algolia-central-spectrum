/**
 * InstanceConfig — the typed contract every `Algolia-Central-[Company]`
 * instance fills in. Structure components read branding, agent identity,
 * sample questions, source facets, and copy ONLY from an InstanceConfig —
 * never hardcoded. This is what makes the screen templatizable (Part 2 of
 * the build plan extracts this contract + the structure components into
 * Algolia-Central-Artifacts/UI/ as the reusable core).
 */

/** Which skin (src/themes/*.css) this instance's primary look uses. Every
 *  instance's primary skin is the CLIENT's design system; the Algolia
 *  attribution footer (PoweredByAlgolia) is invariant regardless of theme. */
export type InstanceTheme = 'spectrum' | 'algolia';

export interface AgentDescriptor {
  /** Live Agent Studio agent ID. */
  id: string;
  /** Display label shown in chips / the handoff marker / error copy. */
  label: string;
  /** `--ac-*` custom-property NAME (e.g. `--ac-agent-generic`) used for this
   *  agent's accent color. Components read it via `var(${accentToken})` —
   *  never a raw hex value. */
  accentToken: string;
}

export interface SourceFacet {
  /** The hit's raw `source` facet value from the index (e.g. `ReactAria`). */
  value: string;
  /** Human-readable label for the source pill group. */
  label: string;
}

export interface InstanceConfig {
  /** Stable slug, e.g. `spectrum`. */
  id: string;
  /** The company/brand this instance represents, e.g. "Algolia Central". */
  brandName: string;
  /** The product/corpus title shown in the header, e.g. "Adobe Spectrum". */
  productTitle: string;
  /** One-line subtitle under the product title. */
  subtitle: string;
  logo: {
    /** Header logo (the client's asset — looks like a client-branded product). */
    header: string;
    /** Small mark used elsewhere (e.g. favicon-scale contexts). */
    mark: string;
  };
  /** The fixed "powered by Algolia" attribution — present on every instance,
   *  regardless of theme (see PoweredByAlgolia.tsx). */
  poweredBy: {
    label: string;
    logo: string;
  };
  /** Human-readable name of the corpus this instance is grounded in. */
  corpusName: string;
  theme: InstanceTheme;
  agents: {
    generic: AgentDescriptor;
    technical: AgentDescriptor;
  };
  /** Sample questions grouped into titled sections (each section ≥3), shown in
   *  the empty state and the "Sample questions" popover. */
  sampleQuestions: { section: string; questions: string[] }[];
  /** Known `source` facet values in this instance's index, in display order. */
  sourceFacets: SourceFacet[];
  /** Short grounding/trust disclaimer shown in the empty state. */
  disclaimer: string;
}

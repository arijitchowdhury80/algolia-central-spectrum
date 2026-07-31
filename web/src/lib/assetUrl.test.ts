import { describe, it, expect } from 'vitest';
import { assetUrl } from './assetUrl';

/**
 * Observed on production 2026-07-30: the header logo requested
 * `/brand/algolia-logo.svg` and 404ed, because this app is served under `/app`
 * while that absolute URL resolves against the domain root, where the widget
 * site's asset subset lives. The base path is the whole point of this helper,
 * so both deployments are pinned.
 */
describe('assetUrl', () => {
  it('prefixes the production base so the asset resolves under /app', () => {
    expect(assetUrl('brand/algolia-logo.svg', '/app/')).toBe('/app/brand/algolia-logo.svg');
  });

  it('is a no-op at the root base used by the dev server', () => {
    expect(assetUrl('brand/algolia-logo.svg', '/')).toBe('/brand/algolia-logo.svg');
  });

  it('tolerates a leading slash on the path — no doubled slash', () => {
    expect(assetUrl('/brand/adobe-logo.svg', '/app/')).toBe('/app/brand/adobe-logo.svg');
  });

  it('adds the separator when a base arrives without its trailing slash', () => {
    expect(assetUrl('brand/adobe-logo.svg', '/app')).toBe('/app/brand/adobe-logo.svg');
  });

  it('falls back to root when the base is absent or empty', () => {
    expect(assetUrl('brand/adobe-logo.svg', undefined)).toBe('/brand/adobe-logo.svg');
    expect(assetUrl('brand/adobe-logo.svg', '')).toBe('/brand/adobe-logo.svg');
  });
});

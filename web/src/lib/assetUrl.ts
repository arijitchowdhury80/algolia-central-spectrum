/**
 * Resolve a file in `web/public/` against the build's base path.
 *
 * This app is built with `--base=/app/` (scripts/deploy/build_prod_site.sh) because
 * production serves it under `/app`, while the vendored widget site owns `/`. Vite
 * rewrites the base into asset URLs it can see — imports, and refs inside
 * index.html — but a hardcoded string like `src="/brand/x.svg"` in JSX is opaque to
 * it and ships unchanged. Such a URL then resolves against the ROOT of the domain,
 * i.e. the widget site's assets, not ours.
 *
 * Observed on production 2026-07-30: the header's Algolia logo requested
 * `/brand/algolia-logo.svg` and 404ed, because the root `brand/` directory carries
 * the widget site's subset and has no `algolia-logo.svg`. The neighbouring refs
 * (`adobe-logo.svg`, `algolia-mark.svg`) only appeared to work because files with
 * those names happen to exist at both paths — the same latent bug, silent.
 *
 * `BASE_URL` is `/app/` in a based production build and `/` under `npm run dev`,
 * and Vite guarantees the trailing slash, so callers pass a path with no leading
 * slash: `assetUrl('brand/algolia-logo.svg')`.
 *
 * `base` is a parameter only so the tests can pin both deployments. Under vitest
 * `import.meta.env` is backed by `process.env`, whose properties reject accessor
 * descriptors — it cannot be stubbed — so the default is read here and the value
 * is injectable. Production callers pass one argument.
 */
export function assetUrl(path: string, base = import.meta.env?.BASE_URL as string | undefined): string {
  const root = base || '/';
  const withSlash = root.endsWith('/') ? root : `${root}/`;
  return `${withSlash}${path.replace(/^\/+/, '')}`;
}

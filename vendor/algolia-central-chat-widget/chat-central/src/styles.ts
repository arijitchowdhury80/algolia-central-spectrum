/**
 * Widget style helpers — the seam between algolia-chat (custom element) and
 * chat-central (widget engine) for CSS injection.
 *
 * `buildWidgetStyles` assembles the full stylesheet to inject into the shadow
 * DOM: tokens.css + the selected theme skin + the Tailwind utilities stylesheet.
 * `ensureWidgetFont` loads the Google Fonts stylesheet once per page.
 *
 * algolia-chat calls:
 *   shadowStyle.textContent = buildWidgetStyles({ accentColor, theme, customSkinCss });
 *   ensureWidgetFont(fontHref);
 *
 * ## Skin resolution order (last wins)
 *   1. tokens.css    — neutral gray scaffold (frozen --algolia-* defaults)
 *   2. bundled skin  — selected by `theme` ('algolia' | 'spectrum')
 *   3. customSkinCss — developer-supplied override; replaces or extends the
 *                      bundled skin without a rebuild
 *   4. accentColor   — runtime hex override for accent + companion tokens
 *
 * ## Zero-rebuild token overrides
 *   A developer can override any token without providing customSkinCss by
 *   setting inline CSS custom properties on the <algolia-chat> element:
 *     <algolia-chat style="--algolia-accent:#e2361b; --algolia-radius-xl:4px;">
 *   Inline styles beat the injected :host rule, so this works for any token.
 */

import type { InstanceTheme } from './config/instance';

// These imports are processed by Vite's PostCSS pipeline (Tailwind + autoprefixer).
// The `?inline` suffix tells Vite to return the final CSS text as a string.
import tokensCss from './styles/tokens.css?inline';
import algoliaSkinCss from './styles/theme/algolia-adobe.css?inline';
import spectrumSkinCss from './styles/theme/spectrum.css?inline';
import tailwindCss from './styles/index.css?inline';

/** Default Google Fonts URL for the Sora + JetBrains Mono typefaces (algolia skin). */
export const DEFAULT_FONT_HREF =
  'https://fonts.googleapis.com/css2?family=Sora:wght@300;400;600&family=JetBrains+Mono:wght@400;500;600&display=swap';

// ---------------------------------------------------------------------------
// Bundled skin registry
// ---------------------------------------------------------------------------

const SKINS: Record<InstanceTheme, string> = {
  algolia: algoliaSkinCss,
  spectrum: spectrumSkinCss,
};

/**
 * The bundled skin names, derived from the registry so the list can never drift
 * from what `buildWidgetStyles` can actually resolve.
 */
export const WIDGET_THEMES = Object.keys(SKINS) as InstanceTheme[];

/**
 * Whether `value` names a bundled skin. Lets the custom element reject a typo'd
 * `theme` attribute loudly instead of silently falling back to the default skin
 * — a misspelled theme used to look exactly like "the theme doesn't work".
 */
export function isWidgetTheme(value: string | undefined): value is InstanceTheme {
  return value !== undefined && Object.prototype.hasOwnProperty.call(SKINS, value);
}

// ---------------------------------------------------------------------------
// Shadow DOM scoping helpers
// ---------------------------------------------------------------------------

/**
 * Rewrite selectors so CSS that normally targets `:root` / `body`-level
 * targets the shadow host instead. This lets the theme cascade work normally
 * inside a shadow root without leaking into the document.
 */
function scopeToHost(css: string): string {
  return css.replace(/:root\b/g, ':host').replace(/\bbody\b/g, ':host');
}

/**
 * Convert a 3- or 6-digit hex color string to an `r, g, b` triplet string
 * suitable for CSS custom properties. Returns null when the input is not a
 * valid hex color.
 */
export function hexToRgbTriplet(hex: string): string | null {
  const raw = hex.replace('#', '');
  let r: number, g: number, b: number;
  if (raw.length === 3) {
    r = parseInt(raw[0] + raw[0], 16);
    g = parseInt(raw[1] + raw[1], 16);
    b = parseInt(raw[2] + raw[2], 16);
  } else if (raw.length === 6) {
    r = parseInt(raw.slice(0, 2), 16);
    g = parseInt(raw.slice(2, 4), 16);
    b = parseInt(raw.slice(4, 6), 16);
  } else {
    return null;
  }
  if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
  return `${r}, ${g}, ${b}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface BuildWidgetStylesOptions {
  /** Optional hex accent color to override `--algolia-accent` and its variants. */
  accentColor?: string;
  /**
   * Which bundled skin to use. Defaults to `'algolia'`.
   * Pass `'spectrum'` to activate the Adobe Spectrum-styled skin.
   */
  theme?: InstanceTheme;
  /**
   * Developer-supplied CSS to inject after the bundled skin. Use this to
   * supply an entirely custom design system or to override individual tokens
   * without rebuilding the widget:
   *
   *   <style slot="theme">
   *     :host { --algolia-accent: #e2361b; --algolia-radius-xl: 4px; }
   *   </style>
   *
   * The CSS is scoped to `:host` automatically if the developer writes it
   * targeting `:root` — otherwise it is inserted verbatim after the skin.
   */
  customSkinCss?: string;
}

/**
 * Build the `:host` CSS block that overrides the accent colour and its
 * derived companion tokens. Derive companion tokens: hover = darkened ~15%,
 * tint = lightened ~90%.
 */
function buildAccentOverride(accent: string): string {
  const triplet = hexToRgbTriplet(accent);
  return `:host {
  --algolia-accent: ${accent};
  --algolia-accent-hover: color-mix(in srgb, ${accent} 85%, #000);
  --algolia-accent-tint: color-mix(in srgb, ${accent} 12%, #fff);
  --algolia-focus: ${accent};
  --algolia-agent-primary: ${accent};
  ${triplet ? `--algolia-accent-rgb: ${triplet};` : ''}
}`;
}

/**
 * Build the full stylesheet string to inject into the `<algolia-chat>` shadow
 * DOM. Combines the token defaults, the selected bundled skin, any developer-
 * supplied custom skin CSS, and the Tailwind utilities — all scoped to `:host`
 * so they don't bleed to the page.
 *
 * Skin resolution order (last declaration wins):
 *   tokens → bundled skin → customSkinCss → accentColor override
 */
export function buildWidgetStyles(opts?: BuildWidgetStylesOptions): string {
  const skin = SKINS[opts?.theme ?? 'algolia'] ?? algoliaSkinCss;
  const parts: string[] = [scopeToHost(tokensCss), scopeToHost(skin), tailwindCss];

  if (opts?.customSkinCss) {
    parts.push(scopeToHost(opts.customSkinCss));
  }
  if (opts?.accentColor) {
    parts.push(buildAccentOverride(opts.accentColor));
  }

  return parts.join('\n');
}

/**
 * Inject the Google Fonts `<link>` for the widget typefaces into `document.head`
 * exactly once. Subsequent calls with the same (or no) href are no-ops.
 *
 * Pass a custom `fontHref` to override the default Google Fonts URL — useful
 * for self-hosted fonts or CSP environments that block googleapis.com.
 */
export function ensureWidgetFont(fontHref?: string): void {
  const href = fontHref ?? DEFAULT_FONT_HREF;
  if (document.head.querySelector(`link[href="${CSS.escape(href)}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}

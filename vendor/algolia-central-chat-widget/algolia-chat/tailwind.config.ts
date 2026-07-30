import type { Config } from 'tailwindcss';

/**
 * Tailwind theme.extend wired to the `--algolia-*` token contract (src/styles/tokens.css).
 * Structure components consume ONLY these theme keys (or `var(--algolia-*)` directly in
 * inline styles when a dynamic token name is needed, e.g. per-agent accent color) —
 * never a raw hex value. The actual color/type/radius/shadow VALUES live in the skin
 * files (src/themes/*.css), not here. This file just teaches Tailwind's utility
 * classes to point at the CSS custom properties.
 */
export default {
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
    // chat-central source is bundled by algolia-chat's Vite build (via source
    // alias). Tailwind must scan it so utility classes used in the moved UI
    // components are included in the generated stylesheet.
    '../chat-central/src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        'algolia-bg': 'var(--algolia-bg)',
        'algolia-surface': 'var(--algolia-surface)',
        'algolia-surface-2': 'var(--algolia-surface-2)',
        'algolia-surface-hover': 'var(--algolia-surface-hover)',
        'algolia-border': 'var(--algolia-border)',
        'algolia-border-strong': 'var(--algolia-border-strong)',
        'algolia-text': 'var(--algolia-text)',
        'algolia-text-secondary': 'var(--algolia-text-secondary)',
        'algolia-text-muted': 'var(--algolia-text-muted)',
        'algolia-text-on-accent': 'var(--algolia-text-on-accent)',
        'algolia-accent': 'var(--algolia-accent)',
        'algolia-accent-hover': 'var(--algolia-accent-hover)',
        'algolia-accent-down': 'var(--algolia-accent-down)',
        'algolia-accent-tint': 'var(--algolia-accent-tint)',
        'algolia-link': 'var(--algolia-link)',
        'algolia-focus': 'var(--algolia-focus)',
        'algolia-positive': 'var(--algolia-positive)',
        'algolia-positive-bg': 'var(--algolia-positive-bg)',
        'algolia-notice': 'var(--algolia-notice)',
        'algolia-notice-bg': 'var(--algolia-notice-bg)',
        'algolia-negative': 'var(--algolia-negative)',
        'algolia-negative-bg': 'var(--algolia-negative-bg)',
        'algolia-informative': 'var(--algolia-informative)',
        'algolia-informative-bg': 'var(--algolia-informative-bg)',
        'algolia-agent-primary': 'var(--algolia-agent-primary)',
        'algolia-agent-specialist': 'var(--algolia-agent-specialist)',
      },
      fontFamily: {
        'algolia-sans': 'var(--algolia-font-sans)',
        'algolia-mono': 'var(--algolia-font-mono)',
      },
      fontSize: {
        'algolia-xs': 'var(--algolia-fs-xs)',
        'algolia-sm': 'var(--algolia-fs-sm)',
        'algolia-base': 'var(--algolia-fs-base)',
        'algolia-lg': 'var(--algolia-fs-lg)',
        'algolia-xl': 'var(--algolia-fs-xl)',
        'algolia-2xl': 'var(--algolia-fs-2xl)',
      },
      fontWeight: {
        'algolia-regular': 'var(--algolia-fw-regular)',
        'algolia-medium': 'var(--algolia-fw-medium)',
        'algolia-bold': 'var(--algolia-fw-bold)',
      },
      lineHeight: {
        'algolia-body': 'var(--algolia-lh-body)',
        'algolia-heading': 'var(--algolia-lh-heading)',
      },
      borderRadius: {
        'algolia-sm': 'var(--algolia-radius-sm)',
        'algolia-md': 'var(--algolia-radius-md)',
        'algolia-lg': 'var(--algolia-radius-lg)',
        'algolia-xl': 'var(--algolia-radius-xl)',
        'algolia-full': 'var(--algolia-radius-full)',
      },
      boxShadow: {
        'algolia-1': 'var(--algolia-shadow-1)',
        'algolia-2': 'var(--algolia-shadow-2)',
        'algolia-3': 'var(--algolia-shadow-3)',
        'algolia-focus': 'var(--algolia-shadow-focus)',
      },
      transitionDuration: {
        'algolia-fast': 'var(--algolia-dur-fast)',
        'algolia-base': 'var(--algolia-dur-base)',
        'algolia-slow': 'var(--algolia-dur-slow)',
      },
      transitionTimingFunction: {
        'algolia-ease': 'var(--algolia-ease)',
      },
      maxWidth: {
        'algolia-maxw': 'var(--algolia-maxw)',
        'algolia-measure': 'var(--algolia-measure)',
      },
    },
  },
  plugins: [],
} satisfies Config;

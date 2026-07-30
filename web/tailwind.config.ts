import type { Config } from 'tailwindcss';

/**
 * Tailwind theme.extend wired to the `--ac-*` token contract (src/styles/tokens.css).
 * Structure components consume ONLY these theme keys (or `var(--ac-*)` directly in
 * inline styles when a dynamic token name is needed, e.g. per-agent accent color) —
 * never a raw hex value. The actual color/type/radius/shadow VALUES live in the skin
 * files (src/themes/*.css), not here. This file just teaches Tailwind's utility
 * classes to point at the CSS custom properties.
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'ac-bg': 'var(--ac-bg)',
        'ac-surface': 'var(--ac-surface)',
        'ac-surface-2': 'var(--ac-surface-2)',
        'ac-surface-hover': 'var(--ac-surface-hover)',
        'ac-border': 'var(--ac-border)',
        'ac-border-strong': 'var(--ac-border-strong)',
        'ac-text': 'var(--ac-text)',
        'ac-text-secondary': 'var(--ac-text-secondary)',
        'ac-text-muted': 'var(--ac-text-muted)',
        'ac-text-on-accent': 'var(--ac-text-on-accent)',
        'ac-accent': 'var(--ac-accent)',
        'ac-accent-hover': 'var(--ac-accent-hover)',
        'ac-accent-down': 'var(--ac-accent-down)',
        'ac-accent-tint': 'var(--ac-accent-tint)',
        'ac-link': 'var(--ac-link)',
        'ac-focus': 'var(--ac-focus)',
        'ac-positive': 'var(--ac-positive)',
        'ac-positive-bg': 'var(--ac-positive-bg)',
        'ac-notice': 'var(--ac-notice)',
        'ac-notice-bg': 'var(--ac-notice-bg)',
        'ac-negative': 'var(--ac-negative)',
        'ac-negative-bg': 'var(--ac-negative-bg)',
        'ac-informative': 'var(--ac-informative)',
        'ac-informative-bg': 'var(--ac-informative-bg)',
        'ac-agent-generic': 'var(--ac-agent-generic)',
        'ac-agent-technical': 'var(--ac-agent-technical)',
      },
      fontFamily: {
        'ac-sans': 'var(--ac-font-sans)',
        'ac-mono': 'var(--ac-font-mono)',
      },
      fontSize: {
        'ac-xs': 'var(--ac-fs-xs)',
        'ac-sm': 'var(--ac-fs-sm)',
        'ac-base': 'var(--ac-fs-base)',
        'ac-lg': 'var(--ac-fs-lg)',
        'ac-xl': 'var(--ac-fs-xl)',
        'ac-2xl': 'var(--ac-fs-2xl)',
      },
      fontWeight: {
        'ac-regular': 'var(--ac-fw-regular)',
        'ac-medium': 'var(--ac-fw-medium)',
        'ac-bold': 'var(--ac-fw-bold)',
      },
      lineHeight: {
        'ac-body': 'var(--ac-lh-body)',
        'ac-heading': 'var(--ac-lh-heading)',
      },
      borderRadius: {
        'ac-sm': 'var(--ac-radius-sm)',
        'ac-md': 'var(--ac-radius-md)',
        'ac-lg': 'var(--ac-radius-lg)',
        'ac-xl': 'var(--ac-radius-xl)',
        'ac-full': 'var(--ac-radius-full)',
      },
      boxShadow: {
        'ac-1': 'var(--ac-shadow-1)',
        'ac-2': 'var(--ac-shadow-2)',
        'ac-3': 'var(--ac-shadow-3)',
        'ac-focus': 'var(--ac-shadow-focus)',
      },
      transitionDuration: {
        'ac-fast': 'var(--ac-dur-fast)',
        'ac-base': 'var(--ac-dur-base)',
        'ac-slow': 'var(--ac-dur-slow)',
      },
      transitionTimingFunction: {
        'ac-ease': 'var(--ac-ease)',
      },
      maxWidth: {
        'ac-maxw': 'var(--ac-maxw)',
        'ac-measure': 'var(--ac-measure)',
      },
    },
  },
  plugins: [],
} satisfies Config;

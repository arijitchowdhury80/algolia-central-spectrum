/**
 * Standalone entry point for the <algolia-brand> custom element.
 *
 * Usage (any HTML page — no framework required):
 *
 *   <script src="algolia-brand.js"></script>
 *
 *   <!-- Attribute form -->
 *   <algolia-brand
 *     logo="/brand/adobe-logo.svg"
 *     brand-name="Adobe Spectrum">
 *   </algolia-brand>
 *
 *   <!-- JS property form (preferred when setting dynamically) -->
 *   <script>
 *     const brand = document.querySelector('algolia-brand');
 *     brand.logo = '/brand/adobe-logo.svg';
 *     brand.brandName = 'Adobe Spectrum';
 *   </script>
 *
 * Theming: set CSS custom properties on or above the element host to override
 * the neutral defaults, e.g.:
 *   algolia-brand {
 *     --algolia-text: #1a1a1a;
 *     --algolia-brand-logo-size: 40px;
 *   }
 */

// Side-effect import — registers the custom element.
import './brand/BrandElement';

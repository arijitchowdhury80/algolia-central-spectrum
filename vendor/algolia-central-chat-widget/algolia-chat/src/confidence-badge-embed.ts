/**
 * Standalone entry point for the <algolia-confidence-badge> custom element.
 *
 * Usage (any HTML page — no framework required):
 *
 *   <script src="algolia-confidence-badge.js"></script>
 *
 *   <!-- Unavailable state (no verdict yet) -->
 *   <algolia-confidence-badge></algolia-confidence-badge>
 *
 *   <!-- Scoring in progress -->
 *   <algolia-confidence-badge scoring></algolia-confidence-badge>
 *
 *   <!-- Scored via attribute (JSON) -->
 *   <algolia-confidence-badge verdict='{"composite":8.1,...}'></algolia-confidence-badge>
 *
 *   <!-- Scored via JS property (preferred for objects) -->
 *   <script>
 *     const badge = document.querySelector('algolia-confidence-badge');
 *     badge.verdict = { composite: 8.1, gateTripped: false, flaggedClaims: [], ... };
 *     badge.addEventListener('open-judge', (e) => {
 *       console.log('Open drawer for', e.detail.verdict);
 *     });
 *   </script>
 *
 * Theming: set CSS custom properties on or above the element host to override
 * the neutral defaults, e.g.:
 *   algolia-confidence-badge { --algolia-positive: #1f9d55; --algolia-positive-bg: #e6f6ee; }
 */

// Side-effect import — registers the custom element.
import './judge/badge/ConfidenceBadgeElement';

/**
 * JSX intrinsic element declaration for <algolia-confidence-badge>.
 * TypeScript picks this up automatically because it lives inside the
 * paths covered by tsconfig.app.json's `include` glob.
 */

declare global {
  namespace JSX {
    interface IntrinsicElements {
      'algolia-confidence-badge': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      >;
    }
  }
}

export {};

/**
 * <algolia-brand> — a standalone, framework-agnostic custom element
 * that renders a logo + brand-name lockup.
 *
 * DATA IN
 *   logo        attribute  URL of the brand logo image
 *   logo        property   string (takes priority over the attribute)
 *   brand-name  attribute  Text label for the brand
 *   brandName   property   string (camelCase property mirror)
 *
 * Theming: all colors / type / spacing come from CSS custom properties (`--algolia-*`).
 * When nested inside <algolia-chat> (which injects the full token sheet)
 * the element inherits those properties automatically. When used standalone, the
 * fallbacks in brand.css produce a neutral rendering that callers can override
 * by setting `--algolia-*` on or above the element's host.
 *
 * Logo size is controllable via `--algolia-brand-logo-size` (default: 32px).
 */

import brandCss from './brand.css?inline';

export class BrandElement extends HTMLElement {
  private _logo = '';
  private _brandName = '';
  private _shadow: ShadowRoot | null = null;

  static get observedAttributes(): string[] {
    return ['logo', 'brand-name'];
  }

  // ── Property accessors ──────────────────────────────────────────────────────

  get logo(): string {
    return this._logo;
  }

  set logo(value: string) {
    this._logo = value ?? '';
    this._render();
  }

  get brandName(): string {
    return this._brandName;
  }

  set brandName(value: string) {
    this._brandName = value ?? '';
    this._render();
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  connectedCallback(): void {
    if (!this._shadow) {
      this._shadow = this.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = brandCss;
      this._shadow.appendChild(style);
    }
    this._render();
  }

  attributeChangedCallback(name: string, _old: string | null, next: string | null): void {
    const value = next ?? '';
    if (name === 'logo') {
      this._logo = value;
    } else if (name === 'brand-name') {
      this._brandName = value;
    }
    this._render();
  }

  // ── Rendering ───────────────────────────────────────────────────────────────

  private _render(): void {
    if (!this._shadow) return;

    const previous = this._shadow.querySelector('.brand');
    if (previous) previous.remove();

    const lockup = document.createElement('span');
    lockup.className = 'brand';

    if (this._brandName) {
      lockup.setAttribute('aria-label', this._brandName);
    }

    if (this._logo) {
      const img = document.createElement('img');
      img.className = 'brand__logo';
      img.src = this._logo;
      img.alt = this._brandName ? `${this._brandName} logo` : '';
      img.setAttribute('aria-hidden', this._brandName ? 'false' : 'true');
      lockup.appendChild(img);
    }

    if (this._brandName) {
      const name = document.createElement('span');
      name.className = 'brand__name';
      name.textContent = this._brandName;
      lockup.appendChild(name);
    }

    this._shadow.appendChild(lockup);
  }
}

// ─── Register ──────────────────────────────────────────────────────────────────

if (!customElements.get('algolia-brand')) {
  customElements.define('algolia-brand', BrandElement);
}

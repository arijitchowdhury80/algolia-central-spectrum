/**
 * The widget is loaded into the page under test as a prebuilt bundle rather
 * than imported, so TypeScript has no way to know what `<algolia-chat>`
 * exposes and `document.querySelector` inside `page.evaluate` falls back to
 * `Element`. Mirroring the public method surface here keeps those callbacks
 * type-checked; the source of truth is `AlgoliaChatElement` in
 * `algolia-chat/src/chat-embed.tsx`.
 */
export {};

declare global {
  interface AlgoliaChatTestElement extends HTMLElement {
    open(): void;
    ask(text: string): void;
    setPersona(agentId: string | null, label?: string): void;
    engage(opts: { greeting: string; suggestions?: string[] }): boolean;
    setAnalyzing(analyzing: boolean): void;
    /** @deprecated Superseded by `setVisitorDataSource`. */
    setContextProvider(provider: (() => unknown) | null): void;
    setVisitorDataSource(source: unknown): void;
  }

  interface HTMLElementTagNameMap {
    'algolia-chat': AlgoliaChatTestElement;
  }
}

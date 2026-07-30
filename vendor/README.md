# vendor/ — third-party code. DO NOT EDIT.

Everything under `vendor/` is owned by someone else and is vendored **read-only**.

## Why read-only, in one line

We must be able to diff against upstream forever and pull their updates cleanly. The moment a file here is edited, that ability is gone and every future update becomes a manual merge.

---

## `algolia-central-chat-widget/`

**Upstream:** https://github.com/smomin/algolia-central-chat-widget
**Author:** Algolia engineering. Follows Algolia's own standards.

Three packages:

| Package | Role |
|---|---|
| `chat-central/` | InstantSearch widget plumbing + the React chat UI + a judge engine |
| `algolia-chat/` | The distributable `<algolia-chat>` web component (Shadow DOM, IIFE bundles) |
| `website/` | Static demo site that embeds the compiled widget via `<script>` |

### The rule

**Do not modify any file in this tree.** Not to fix a bug, not to add a feature, not to reformat. If something here needs to change, either:

1. extend it from outside via its public API (see the seams below), or
2. raise it with Algolia engineering so the change lands upstream.

Anything that needs changing goes through a pull request upstream — never by editing this tree directly. That is the whole point: the diff against upstream is always exactly the set of changes that have been proposed, and nothing else.

### Public seams we extend through

These are documented in the packages' own READMEs and are the intended extension points — using them is not modification:

| Seam | What it is |
|---|---|
| `algolia-verdict` | `CustomEvent` dispatched on `document` after each judge verdict (`ALGOLIA_VERDICT_EVENT`) |
| `<algolia-confidence-badge>.verdict` | Public setter for the displayed verdict |
| `<algolia-confidence-badge>.scoring` | Public setter for the in-progress state |
| `<algolia-agent agent-id=… role=…>` | Declarative agent config, including judge agents |
| `LlmComplete` | The judge engine's only model seam — the same shape `@lab/judge` uses |

### How the hosted judge is wired in

The widget ships with an in-browser judge engine. This deployment points it at the hosted judge service in `lab/` instead, which is where the deterministic grounding gate lives. Two moves, both configuration, no engine edits:

1. **`mode="hosted"` + `url` + `api-key`** are set on `<algolia-chat-confidence>` by the enhancement layer (`web-widget/src/main.ts`) before the widget bundles load, so the judge client POSTs to `/api/judge` on the hosted service. Extra fields on the response (`grounded`, `termsChecked`, `unsupportedTerms`, `groundingMode`) pass through the client untouched, because it returns the panel verbatim.
2. **The badge reads those fields.** Absent them it renders the composite exactly as before, so this is additive for every other consumer.

Two traps worth knowing before touching it again:

- **The element captures its config at upgrade.** `connectedCallback` reads mode/url/api-key once. The enhancement layer must therefore run **synchronously**, not on `DOMContentLoaded` — waiting puts the writes after the widget bundles, and the page then shows `mode="hosted"` in the DOM while the network shows in-browser judge calls.
  `ConfidenceElement` does implement `attributeChangedCallback`, guarded by `if (!this.isConnected || previous === next) return;`. Writes land before the element connects, so the guard's early return fires rather than a live re-registration. Writing *after* upgrade would instead pass that guard and re-init mid-connection.
- **The client sends `x-judge-api-key`; the service also accepts `x-lab-key`.** Rather than fork the client over a header name, `lab/server/src/auth.ts` accepts both (same secret, same comparison) and both are in the CORS allow-list.

All three judge temperaments run the same model. Lenses differ by prompt, not by measuring instrument, with the deterministic check as the guard.

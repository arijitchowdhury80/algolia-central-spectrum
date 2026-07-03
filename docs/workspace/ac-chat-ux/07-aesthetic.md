# Step 7 — Aesthetic

## The nuance for a design-system framework
The "aesthetic" is NOT one fixed look — it's a **token contract** with a swappable skin. So the deliverable is:
1. **Framework default theme** — a deliberate house style so the shell never looks "generic AI" even un-skinned.
2. **Client skin** — instance #1 = Adobe Spectrum tokens applied over the same structure.

## Framework default = `theme-clean` lineage
Chosen because the mental model is a **focused, single-purpose grounded chat** (not a dashboard, not a report). Traits: ample whitespace, minimal chrome, one strong accent, generous reading measure. Fits "fresh minimal chat" exactly.
- Sans: system-ui / Inter fallback. Mono: ui-monospace (for code answers from Technical).
- Neutral surfaces, one accent (framework default = a calm indigo), restrained borders, soft radii, subtle shadows.
- Full light + dark via token values.

## Instance skin (ACS) = Adobe Spectrum
Override token VALUES only (structure untouched):
- Font: "Adobe Clean" stack → fallback `source-sans-pro, adobe-clean, system-ui` (real Adobe Clean is licensed; use the closest open fallback + allow a client to drop the licensed font via the skin's `@font-face`).
- Accent: Spectrum blue `#1473E6` (informative/accent-1000 region). Contrast text white.
- Radius: Spectrum uses small radii (4–8px) → tighter than framework default.
- Neutrals: Spectrum gray scale.
- Logo/wordmark: Adobe/Spectrum mark in header (asset slot).

## Why this proves the thesis
Building framework-default FIRST, then dropping in `spectrum.css` + `instance.spectrum.ts` to reskin with zero structural change, is the direct test of the two-layer contract. If the swap needs any structural edit, the contract is wrong — caught in instance #1.

## Distinctive (anti-generic-AI) elements
- **Receipts row** — grounded source cards under each answer (the product's signature).
- **Agent handoff thread** — a visible "Generic → Technical" marker with distinct agent chips.
- These two exist in no default chatbot; they carry the identity regardless of skin.

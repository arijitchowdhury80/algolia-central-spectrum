# Agent-to-Agent Client-Tool Spike — Findings Log

## Task 1: Baseline tool schema
- Agent probed: ACS-generic-neural (13809d4b-6b6d-4297-b95c-a934bceef0b4)
- Tool count: 1
- Tool[0] top-level keys: name, type, indices, mode, allowUnlistedIndices, description
- Tool "type" field present? **yes** — value if present: `algolia_search_index`
- Conclusion: today's tool = index-search only (Algolia search index integration). No client/webhook tool type discriminator yet.

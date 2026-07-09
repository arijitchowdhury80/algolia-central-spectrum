import { describe, expect, it } from 'vitest';
import { parseCompletionStream } from './agentStudio';

/**
 * B5 fixtures are pasted VERBATIM from the B4 empirical capture
 * (docs/spikes/2026-07-09-suggestions-frame-findings.md and its raw
 * *-frames-*.txt evidence files). Do not synthesize these — the whole point of
 * B4 was that the wire shape ≠ the docs shape.
 */

// The real SPECIALIST offer frame (generic agent, implementation query).
const SPECIALIST_FRAME =
  '2:[{"suggestions": ["SPECIALIST: See the exact props and a working code example for a controlled TextField with onChange and validation state in React Spectrum S2 TypeScript"]}]';

// The real ordinary (non-SPECIALIST) suggestion frame (generic agent, design query).
const ORDINARY_FRAME =
  '2:[{"suggestions": ["Understand how Spectrum 2 bridges the gap between professional and consumer-oriented applications to suit diverse enterprise needs."]}]';

// The OTHER prefix-2 payload that already rides this stream — message-metadata,
// verbatim from the ordinary capture. B5 must NOT read this as a suggestion.
const METADATA_FRAME =
  '2:[{"type": "message-metadata", "messageId": "alg_msg_XbiW5JyUdw9WAXF5", "messageMetadata": {}}]';

describe('parseCompletionStream — suggestions frame (prefix 2)', () => {
  it('extracts the SPECIALIST-prefixed suggestion from a real captured frame', () => {
    const parsed = parseCompletionStream([SPECIALIST_FRAME]);
    expect(parsed.suggestions).toEqual([
      'SPECIALIST: See the exact props and a working code example for a controlled TextField with onChange and validation state in React Spectrum S2 TypeScript',
    ]);
  });

  it('extracts an ordinary (non-SPECIALIST) suggestion from a real captured frame', () => {
    const parsed = parseCompletionStream([ORDINARY_FRAME]);
    expect(parsed.suggestions).toEqual([
      'Understand how Spectrum 2 bridges the gap between professional and consumer-oriented applications to suit diverse enterprise needs.',
    ]);
  });

  it('does NOT populate suggestions from a prefix-2 message-metadata frame (the overload risk)', () => {
    const parsed = parseCompletionStream([METADATA_FRAME]);
    expect(parsed.suggestions).toEqual([]);
  });

  it('discriminates within a mixed stream — metadata ignored, suggestion captured', () => {
    const parsed = parseCompletionStream([METADATA_FRAME, SPECIALIST_FRAME]);
    expect(parsed.suggestions).toEqual([
      'SPECIALIST: See the exact props and a working code example for a controlled TextField with onChange and validation state in React Spectrum S2 TypeScript',
    ]);
  });

  it('returns an empty suggestions array when no suggestion frame is present', () => {
    const parsed = parseCompletionStream(['0:"hello"', METADATA_FRAME]);
    expect(parsed.suggestions).toEqual([]);
  });

  it('skips a malformed prefix-2 payload without throwing', () => {
    const parsed = parseCompletionStream(['2:[{not valid json']);
    expect(parsed.suggestions).toEqual([]);
  });
});

describe('parseCompletionStream — no regression on already-handled frames', () => {
  // Real frames from the ordinary capture (docs/spikes/*-ordinary.txt), trimmed.
  const TOOL_CALL_FRAME =
    '9:{"toolCallId": "0af1b956", "toolName": "algolia_search_index_acs_spectrum_multi", "args": {"originalQuery": "when should I choose Spectrum"}}';
  const TOOL_RESULT_FRAME =
    'a:{"toolCallId": "0af1b956", "result": {"hits": [{"title": "illustrations", "url": "https://raw.githubusercontent.com/adobe/spectrum-design-data/main/docs/s2-docs/designing/illustrations.md"}]}}';

  it('still accumulates 0: text deltas', () => {
    const parsed = parseCompletionStream(['0:"Hello "', '0:"world"']);
    expect(parsed.content).toBe('Hello world');
  });

  it('still records 9: tool invocations', () => {
    const parsed = parseCompletionStream([TOOL_CALL_FRAME]);
    expect(parsed.toolInvocations).toHaveLength(1);
    expect(parsed.toolInvocations[0].tool_name).toBe('algolia_search_index_acs_spectrum_multi');
  });

  it('still collects a: tool-result hits', () => {
    const parsed = parseCompletionStream([TOOL_RESULT_FRAME]);
    expect(parsed.hits).toHaveLength(1);
    expect(parsed.hits[0].title).toBe('illustrations');
  });

  it('still captures 3: error frames', () => {
    const parsed = parseCompletionStream(['3:"boom"']);
    expect(parsed.error).toBe('boom');
  });

  it('a mixed real-shaped stream parses all frame types together', () => {
    const parsed = parseCompletionStream([
      METADATA_FRAME,
      TOOL_CALL_FRAME,
      TOOL_RESULT_FRAME,
      '0:"Answer text"',
      SPECIALIST_FRAME,
    ]);
    expect(parsed.content).toBe('Answer text');
    expect(parsed.toolInvocations).toHaveLength(1);
    expect(parsed.hits).toHaveLength(1);
    expect(parsed.suggestions).toEqual([
      'SPECIALIST: See the exact props and a working code example for a controlled TextField with onChange and validation state in React Spectrum S2 TypeScript',
    ]);
  });
});

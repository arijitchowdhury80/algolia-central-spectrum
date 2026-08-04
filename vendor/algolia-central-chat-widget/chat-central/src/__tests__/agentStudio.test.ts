/**
 * Unit tests for the ai-sdk-5 parser and runToolLoop in agentStudio.ts.
 *
 * All tests inject a mock `fetch` via the `fetchImpl` option so no network
 * calls are made.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  parseCompletionStream,
  callCompletions,
  runToolLoop,
  type CompletionsConfig,
  type CompletionsRequest,
} from '../shared/agentStudio.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a ReadableStream from a list of SSE data lines. */
function sseStream(lines: string[]): ReadableStream<Uint8Array> {
  const text = lines.map((l) => `data: ${l}\n`).join('\n') + '\n';
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

/** Build a minimal mock Response with a ReadableStream body. */
function mockResponse(lines: string[]): Response {
  return {
    ok: true,
    body: sseStream(lines),
    text: () => Promise.resolve(''),
  } as unknown as Response;
}

/**
 * A `fetch` mock typed against the real signature, so `mock.calls[n][1]` is a
 * `RequestInit` rather than `any` and request bodies can be read type-safely.
 */
type FetchMock = ReturnType<typeof vi.fn<typeof fetch>>;

/** Resolve each response in order, one per successive call. */
function fetchMock(...responses: Response[]): FetchMock {
  const mock = vi.fn<typeof fetch>();
  for (const res of responses) mock.mockResolvedValueOnce(res);
  return mock;
}

/** One part of an outgoing v5 UIMessage. */
interface RequestPart {
  type: string;
  text?: string;
  toolCallId?: string;
  state?: string;
  input?: Record<string, unknown>;
  output?: unknown;
}

interface RequestMessage {
  role: string;
  parts: RequestPart[];
}

/** Parse the JSON body the mock was called with on `callIndex`. */
function requestBody(mock: FetchMock, callIndex: number): { messages: RequestMessage[] } {
  const body = mock.mock.calls[callIndex][1]?.body;
  if (typeof body !== 'string') throw new Error('Expected a JSON string request body');
  return JSON.parse(body) as { messages: RequestMessage[] };
}

/** The tool-result part of the assistant message in a given request. */
function toolResultPart(mock: FetchMock, callIndex: number): RequestPart | undefined {
  const assistant = requestBody(mock, callIndex).messages.find((m) => m.role === 'assistant');
  return assistant?.parts.find((p) => p.state === 'output-available');
}

const cfg: CompletionsConfig = { appId: 'TESTAPP', searchKey: 'TEST_KEY', agentId: 'agent-1' };
const req: CompletionsRequest = { query: 'hello' };

// ── parseCompletionStream ─────────────────────────────────────────────────────

describe('parseCompletionStream', () => {
  it('accumulates text-delta events into content', () => {
    const lines = [
      'data: {"type":"text-delta","delta":"Hello"}',
      'data: {"type":"text-delta","delta":", world"}',
    ];
    const result = parseCompletionStream(lines);
    expect(result.content).toBe('Hello, world');
  });

  it('calls onText callback on each delta', () => {
    const lines = [
      'data: {"type":"text-delta","delta":"A"}',
      'data: {"type":"text-delta","delta":"B"}',
    ];
    const snapshots: string[] = [];
    parseCompletionStream(lines, (acc) => snapshots.push(acc));
    expect(snapshots).toEqual(['A', 'AB']);
  });

  it('collects tool-input-available as toolInvocations', () => {
    const lines = [
      'data: {"type":"tool-input-available","toolCallId":"call_1","toolName":"ask_specialist","input":{"specialist_key":"react","question":"Q?"}}',
    ];
    const result = parseCompletionStream(lines);
    expect(result.toolInvocations).toHaveLength(1);
    const tc = result.toolInvocations[0];
    expect(tc.tool_call_id).toBe('call_1');
    expect(tc.tool_name).toBe('ask_specialist');
    expect(tc.args).toEqual({ specialist_key: 'react', question: 'Q?' });
  });

  it('collects hits from tool-output-available with a hits array', () => {
    const output = {
      hits: [
        { url: '/foo', title: 'Foo' },
        { url: '/bar', title: 'Bar' },
      ],
    };
    const lines = [
      `data: {"type":"tool-output-available","toolCallId":"c1","output":${JSON.stringify(output)}}`,
    ];
    const result = parseCompletionStream(lines);
    expect(result.hits).toHaveLength(2);
    expect(result.hits[0]).toMatchObject({ url: '/foo', title: 'Foo' });
  });

  it('collects suggestions from data-suggestions', () => {
    const lines = [
      'data: {"type":"data-suggestions","data":{"suggestions":["Follow up A","Follow up B"]}}',
    ];
    const result = parseCompletionStream(lines);
    expect(result.suggestions).toEqual(['Follow up A', 'Follow up B']);
  });

  it('captures error events', () => {
    const lines = ['data: {"type":"error","message":"Something went wrong"}'];
    const result = parseCompletionStream(lines);
    expect(result.error).toBe('Something went wrong');
  });

  it('silently skips non-data lines and malformed JSON', () => {
    const lines = ['event: start', 'data: not-json{{{', 'data: {"type":"text-delta","delta":"ok"}'];
    const result = parseCompletionStream(lines);
    expect(result.content).toBe('ok');
    expect(result.error).toBeUndefined();
  });

  it('ignores unknown event types without errors', () => {
    const lines = [
      'data: {"type":"start"}',
      'data: {"type":"finish-step"}',
      'data: {"type":"text-delta","delta":"fine"}',
    ];
    const result = parseCompletionStream(lines);
    expect(result.content).toBe('fine');
  });
});

// ── callCompletions ───────────────────────────────────────────────────────────

describe('callCompletions', () => {
  it('streams and returns accumulated ParsedCompletion', async () => {
    const mockFetch = fetchMock(
      mockResponse([
        '{"type":"text-delta","delta":"Hello"}',
        '{"type":"text-delta","delta":" there"}',
      ]),
    );

    const result = await callCompletions(cfg, req, { fetchImpl: mockFetch });
    expect(result.content).toBe('Hello there');
    expect(mockFetch).toHaveBeenCalledOnce();

    // Verify the request body contains the user message in v5 parts format.
    expect(requestBody(mockFetch, 0).messages).toEqual([
      { role: 'user', parts: [{ type: 'text', text: 'hello' }] },
    ]);
  });

  it('throws on non-ok response', async () => {
    const mockFetch = vi.fn<typeof fetch>().mockResolvedValue({
      ok: false,
      status: 422,
      text: () => Promise.resolve('Bad format'),
    } as unknown as Response);

    await expect(callCompletions(cfg, req, { fetchImpl: mockFetch })).rejects.toThrow('422');
  });
});

// ── runToolLoop ───────────────────────────────────────────────────────────────

describe('runToolLoop', () => {
  it('returns immediately when no client-side tool calls are emitted', async () => {
    const mockFetch = fetchMock(mockResponse(['{"type":"text-delta","delta":"Direct answer"}']));

    const result = await runToolLoop(cfg, req, {}, { fetchImpl: mockFetch });

    expect(result.content).toBe('Direct answer');
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('executes registered handler and re-POSTs with tool result', async () => {
    const mockFetch = fetchMock(
      // Step 1: agent emits a tool call.
      mockResponse([
        '{"type":"tool-input-available","toolCallId":"tc1","toolName":"echo","input":{"msg":"ping"}}',
      ]),
      // Step 2: agent emits the final answer.
      mockResponse(['{"type":"text-delta","delta":"pong answer"}']),
    );

    const echoHandler = vi.fn().mockResolvedValue({ echoed: 'ping' });

    const result = await runToolLoop(cfg, req, { echo: echoHandler }, { fetchImpl: mockFetch });

    expect(echoHandler).toHaveBeenCalledOnce();
    expect(echoHandler).toHaveBeenCalledWith({ msg: 'ping' });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result.content).toBe('pong answer');

    // ai-sdk-5 UIMessage shape. The v4 spelling (type:'tool-invocation',
    // toolInvocationId, state:'result', args/result) is rejected with a 422.
    expect(toolResultPart(mockFetch, 1)).toMatchObject({
      type: 'tool-echo',
      toolCallId: 'tc1',
      state: 'output-available',
      input: { msg: 'ping' },
      output: { echoed: 'ping' },
    });
  });

  it('sends assistant history as a text part, not a synthetic tool part', async () => {
    const mockFetch = fetchMock(mockResponse(['{"type":"text-delta","delta":"ok"}']));

    await runToolLoop(
      cfg,
      {
        history: [
          { role: 'user', content: 'first question' },
          { role: 'assistant', content: 'first answer' },
        ],
        query: 'second question',
      },
      {},
      { fetchImpl: mockFetch },
    );

    const assistantMsg = requestBody(mockFetch, 0).messages.find((m) => m.role === 'assistant');
    expect(assistantMsg?.parts).toEqual([{ type: 'text', text: 'first answer' }]);
  });

  it('stops after maxSteps even when tool calls keep coming', async () => {
    // Every step returns a tool call so the loop would be infinite without maxSteps.
    let callCount = 0;
    const mockFetch = vi.fn<typeof fetch>().mockImplementation(() => {
      callCount++;
      return Promise.resolve(
        mockResponse([
          `{"type":"tool-input-available","toolCallId":"tc${String(callCount)}","toolName":"echo","input":{}}`,
        ]),
      );
    });

    await runToolLoop(
      cfg,
      req,
      { echo: vi.fn().mockResolvedValue({}) },
      { maxSteps: 3, fetchImpl: mockFetch },
    );

    // Should have called fetch exactly maxSteps times.
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('returns a structured toolError when a handler throws, without hanging', async () => {
    const mockFetch = fetchMock(
      mockResponse([
        '{"type":"tool-input-available","toolCallId":"tc1","toolName":"bad_tool","input":{}}',
      ]),
      mockResponse(['{"type":"text-delta","delta":"recovered"}']),
    );

    const throwingHandler = vi.fn().mockRejectedValue(new Error('handler blew up'));

    const result = await runToolLoop(
      cfg,
      req,
      { bad_tool: throwingHandler },
      { fetchImpl: mockFetch },
    );

    // The second call should have gone through (structured error sent back).
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(toolResultPart(mockFetch, 1)?.output).toMatchObject({
      success: false,
      error: { code: 'HANDLER_ERROR', message: 'handler blew up' },
    });
    expect(result.content).toBe('recovered');
  });

  it('returns a structured toolError when a handler times out', async () => {
    vi.useFakeTimers();

    const mockFetch = fetchMock(
      mockResponse([
        '{"type":"tool-input-available","toolCallId":"tc1","toolName":"slow_tool","input":{}}',
      ]),
      mockResponse(['{"type":"text-delta","delta":"after timeout"}']),
    );

    // Handler that never resolves.
    const neverResolves = vi.fn().mockImplementation(() => new Promise(() => {}));

    const loopPromise = runToolLoop(
      cfg,
      req,
      { slow_tool: neverResolves },
      { toolTimeoutMs: 100, fetchImpl: mockFetch },
    );

    // Advance timers past the timeout.
    await vi.runAllTimersAsync();

    const result = await loopPromise;

    expect(result.content).toBe('after timeout');
    expect(toolResultPart(mockFetch, 1)?.output).toMatchObject({
      success: false,
      error: expect.objectContaining({ code: 'HANDLER_ERROR' }) as unknown,
    });

    vi.useRealTimers();
  });

  it('never rewinds streamed text across a tool call', async () => {
    // Regression: each step gets a fresh parser starting at empty content, and
    // consumers overwrite their buffer with whatever onText reports. Unless the
    // step is rebased onto what came before, step 2 erases step 1's prose and
    // the user watches the answer rewind mid-stream.
    const mockFetch = fetchMock(
      mockResponse([
        '{"type":"text-delta","delta":"Checking your profile. "}',
        '{"type":"tool-input-available","toolCallId":"tc1","toolName":"get_visitor_profile","input":{}}',
      ]),
      mockResponse([
        '{"type":"text-delta","delta":"You prefer "}',
        '{"type":"text-delta","delta":"React."}',
      ]),
    );

    const snapshots: string[] = [];
    const result = await runToolLoop(
      cfg,
      req,
      { get_visitor_profile: vi.fn().mockResolvedValue({ persona: 'dev' }) },
      { callbacks: { onText: (acc) => snapshots.push(acc) }, fetchImpl: mockFetch },
    );

    // Every snapshot must extend the one before it — never shrink or diverge.
    for (let i = 1; i < snapshots.length; i++) {
      expect(snapshots[i].startsWith(snapshots[i - 1])).toBe(true);
    }
    expect(snapshots.at(-1)).toBe('Checking your profile. You prefer React.');
    expect(result.content).toBe('Checking your profile. You prefer React.');
  });

  it('reports hits from earlier steps in later onProgress callbacks', async () => {
    const mockFetch = fetchMock(
      mockResponse([
        '{"type":"tool-output-available","toolCallId":"b1","output":{"hits":[{"url":"/a","title":"A"}]}}',
        '{"type":"tool-input-available","toolCallId":"tc1","toolName":"echo","input":{}}',
      ]),
      mockResponse([
        '{"type":"tool-output-available","toolCallId":"b2","output":{"hits":[{"url":"/b","title":"B"}]}}',
      ]),
    );

    const hitCounts: number[] = [];
    await runToolLoop(
      cfg,
      req,
      { echo: vi.fn().mockResolvedValue({}) },
      {
        callbacks: { onProgress: (partial) => hitCounts.push(partial.hits.length) },
        fetchImpl: mockFetch,
      },
    );

    // Hit count must never drop — step 2 carries step 1's hit forward.
    expect(hitCounts).toEqual([...hitCounts].sort((a, b) => a - b));
    expect(hitCounts.at(-1)).toBe(2);
  });

  it('accumulates content and hits across multiple steps', async () => {
    const mockFetch = fetchMock(
      mockResponse([
        '{"type":"text-delta","delta":"Part 1 "}',
        '{"type":"tool-input-available","toolCallId":"tc1","toolName":"fetch_data","input":{}}',
      ]),
      mockResponse([
        '{"type":"text-delta","delta":"Part 2"}',
        '{"type":"tool-output-available","toolCallId":"built-in","output":{"hits":[{"url":"/a","title":"A"}]}}',
      ]),
    );

    const result = await runToolLoop(
      cfg,
      req,
      { fetch_data: vi.fn().mockResolvedValue({ data: 'ok' }) },
      { fetchImpl: mockFetch },
    );

    expect(result.content).toBe('Part 1 Part 2');
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]).toMatchObject({ url: '/a', title: 'A' });
  });
});

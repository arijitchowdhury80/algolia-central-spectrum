import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Writable } from "node:stream";

process.env.ALGOLIA_APP_ID = "TESTAPPID";
process.env.ALGOLIA_SEARCH_API_KEY = "test-real-key-never-forwarded-to-client";

const { handleAgentStudioProxy, handleInstantSearchProxy, __testing } = await import("./searchProxy.js");

function fakeReq(body: string, url = "/"): IncomingMessage {
  const chunks = [Buffer.from(body)];
  const req = {
    url,
    headers: {},
    [Symbol.asyncIterator]: async function* () {
      for (const c of chunks) yield c;
    },
  };
  return req as unknown as IncomingMessage;
}

/** A real Writable so `Readable.fromWeb(upstream.body).pipe(res)` has a valid
 *  destination — a plain object stub isn't a stream and `.pipe()` throws. */
function fakeRes(): ServerResponse & { _status?: number; _body?: string; _headers?: Record<string, string> } {
  const chunks: Buffer[] = [];
  const res = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(Buffer.from(chunk));
      cb();
    },
  }) as unknown as ServerResponse & { _status?: number; _body?: string; _headers?: Record<string, string> };
  (res as any).writeHead = vi.fn((status: number, headers?: Record<string, string>) => {
    res._status = status;
    res._headers = headers;
  });
  const realEnd = res.end.bind(res);
  (res as any).end = vi.fn((body?: string) => {
    if (typeof body === "string") res._body = body;
    else res._body = Buffer.concat(chunks).toString("utf8") || undefined;
    return realEnd();
  });
  return res;
}

describe("handleAgentStudioProxy", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it("rejects an agentId not on the allow-list, without calling fetch", async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    const res = fakeRes();
    await handleAgentStudioProxy(fakeReq('{"messages":[]}'), res, "some-random-agent-id");

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(res._status).toBe(403);
    expect(JSON.parse(res._body!).error).toContain("agentId not allowed");
  });

  it("forwards an allow-listed agentId with the real key attached, never the caller's body echoed with credentials", async () => {
    const allowedId = [...__testing.ALLOWED_AGENT_IDS][0];
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Map([["content-type", "text/event-stream"]]),
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("data: {}\n\n"));
          controller.close();
        },
      }),
    });
    (fetchSpy as any).mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => "text/event-stream" },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("data: {}\n\n"));
          controller.close();
        },
      }),
    });
    global.fetch = fetchSpy as unknown as typeof fetch;

    const res = fakeRes();
    await handleAgentStudioProxy(fakeReq('{"messages":[]}'), res, allowedId);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchSpy.mock.calls[0];
    expect(calledUrl).toContain(`/agent-studio/1/agents/${allowedId}/completions`);
    expect(calledInit.headers["X-Algolia-API-Key"]).toBe("test-real-key-never-forwarded-to-client");
  });

  it("never relays the upstream error body to the client", async () => {
    const allowedId = [...__testing.ALLOWED_AGENT_IDS][0];
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      body: null,
    }) as unknown as typeof fetch;

    const res = fakeRes();
    await handleAgentStudioProxy(fakeReq("{}"), res, allowedId);

    expect(res._status).toBe(500);
    expect(res._body).not.toContain("test-real-key-never-forwarded-to-client");
    expect(JSON.parse(res._body!)).toEqual({ error: "search proxy error" });
  });
});

describe("handleInstantSearchProxy", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it("rejects a request naming an index other than the allowed one", async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    const res = fakeRes();
    await handleInstantSearchProxy(fakeReq(JSON.stringify({ requests: [{ indexName: "some_other_index" }] })), res);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(res._status).toBe(403);
    expect(JSON.parse(res._body!).error).toContain("indexName not allowed");
  });

  it("forwards a request for the allowed index with the real key attached", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ results: [] }),
    });
    global.fetch = fetchSpy as unknown as typeof fetch;

    const res = fakeRes();
    await handleInstantSearchProxy(
      fakeReq(JSON.stringify({ requests: [{ indexName: __testing.ALLOWED_INDEX_NAME, params: "hitsPerPage=0" }] })),
      res,
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchSpy.mock.calls[0];
    expect(calledUrl).toContain("/1/indexes/*/queries");
    expect(calledInit.headers["X-Algolia-API-Key"]).toBe("test-real-key-never-forwarded-to-client");
    expect(res._status).toBe(200);
  });

  it("rejects invalid JSON without touching fetch", async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    const res = fakeRes();
    await handleInstantSearchProxy(fakeReq("not json"), res);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(res._status).toBe(400);
  });
});

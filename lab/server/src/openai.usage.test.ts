import { describe, it, expect, vi } from "vitest";
import { makeOpenAIComplete } from "./openai.js";

function fakeOpenAIResponse(content: string, usage?: { prompt_tokens?: number; completion_tokens?: number }) {
  return {
    choices: [{ message: { content } }],
    ...(usage ? { usage } : {}),
  };
}

function mockFetch(body: unknown, status = 200): typeof fetch {
  return vi.fn(
    async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
  ) as unknown as typeof fetch;
}

describe("makeOpenAIComplete — exact token usage", () => {
  it("calls onUsage with prompt_tokens/completion_tokens when usage is present", async () => {
    const fetchImpl = mockFetch(fakeOpenAIResponse("hello", { prompt_tokens: 200, completion_tokens: 80 }));
    const complete = makeOpenAIComplete({ apiKey: "k", model: "gpt-4o-mini", fetchImpl });

    const onUsage = vi.fn();
    const out = await complete("prompt", { tag: "judge:advocate:round1", onUsage });

    expect(out).toBe("hello");
    expect(onUsage).toHaveBeenCalledWith({
      inputTokens: 200,
      outputTokens: 80,
      model: "gpt-4o-mini",
      tag: "judge:advocate:round1",
    });
  });

  it("does not call onUsage when usage is absent", async () => {
    const fetchImpl = mockFetch(fakeOpenAIResponse("hello"));
    const complete = makeOpenAIComplete({ apiKey: "k", model: "gpt-4o-mini", fetchImpl });

    const onUsage = vi.fn();
    await complete("prompt", { onUsage });

    expect(onUsage).not.toHaveBeenCalled();
  });

  it("posts to api.openai.com/v1 by default, and to a custom baseURL when set", async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify(fakeOpenAIResponse("ok")), { status: 200 });
    }) as unknown as typeof fetch;

    await makeOpenAIComplete({ apiKey: "k", model: "gpt-4o", fetchImpl })("p");
    await makeOpenAIComplete({
      apiKey: "k",
      model: "medium",
      baseURL: "https://inference.api.enablers.algolia.net/v1",
      fetchImpl,
    })("p");
    // trailing slash on baseURL must not double up
    await makeOpenAIComplete({ apiKey: "k", model: "medium", baseURL: "https://x/v1/", fetchImpl })("p");

    expect(urls[0]).toBe("https://api.openai.com/v1/chat/completions");
    expect(urls[1]).toBe("https://inference.api.enablers.algolia.net/v1/chat/completions");
    expect(urls[2]).toBe("https://x/v1/chat/completions");
  });

  it("still reports usage on the temperature-drop retry path", async () => {
    let call = 0;
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      call += 1;
      const body = JSON.parse(init.body as string) as { temperature?: number };
      if (call === 1 && body.temperature !== undefined) {
        return new Response(JSON.stringify({ error: { message: "temperature not supported" } }), { status: 400 });
      }
      return new Response(
        JSON.stringify(fakeOpenAIResponse("ok", { prompt_tokens: 5, completion_tokens: 5 })),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const complete = makeOpenAIComplete({ apiKey: "k", model: "gpt-4o", fetchImpl });
    const onUsage = vi.fn();
    const out = await complete("prompt", { temperature: 0.7, onUsage });

    expect(out).toBe("ok");
    expect(onUsage).toHaveBeenCalledWith({ inputTokens: 5, outputTokens: 5, model: "gpt-4o", tag: undefined });
  });
});

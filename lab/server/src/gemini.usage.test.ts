import { describe, it, expect, vi } from "vitest";
import { makeGeminiComplete } from "./gemini.js";

/** Minimal successful Gemini generateContent response, usageMetadata attached. */
function fakeGeminiResponse(text: string, usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }) {
  return {
    candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }],
    ...(usageMetadata ? { usageMetadata } : {}),
  };
}

function mockFetch(body: unknown, status = 200): typeof fetch {
  return vi.fn(
    async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
  ) as unknown as typeof fetch;
}

describe("makeGeminiComplete — exact token usage (real captured Gemini response shape)", () => {
  it("calls onUsage with promptTokenCount/candidatesTokenCount when usageMetadata is present", async () => {
    const fetchImpl = mockFetch(
      fakeGeminiResponse("hello world", { promptTokenCount: 123, candidatesTokenCount: 45 }),
    );
    const complete = makeGeminiComplete({ apiKey: "k", model: "gemini-2.5-flash", fetchImpl });

    const onUsage = vi.fn();
    const out = await complete("prompt", { tag: "judge:skeptic:round1", onUsage });

    expect(out).toBe("hello world");
    expect(onUsage).toHaveBeenCalledTimes(1);
    expect(onUsage).toHaveBeenCalledWith({
      inputTokens: 123,
      outputTokens: 45,
      model: "gemini-2.5-flash",
      tag: "judge:skeptic:round1",
    });
  });

  it("does not call onUsage when usageMetadata is absent (older/partial response)", async () => {
    const fetchImpl = mockFetch(fakeGeminiResponse("hello"));
    const complete = makeGeminiComplete({ apiKey: "k", model: "gemini-2.5-flash", fetchImpl });

    const onUsage = vi.fn();
    await complete("prompt", { onUsage });

    expect(onUsage).not.toHaveBeenCalled();
  });

  it("treats a present-but-zero token count as real usage, not absence", async () => {
    const fetchImpl = mockFetch(
      fakeGeminiResponse("hi", { promptTokenCount: 10, candidatesTokenCount: 0 }),
    );
    const complete = makeGeminiComplete({ apiKey: "k", model: "gemini-2.5-pro", fetchImpl });

    const onUsage = vi.fn();
    await complete("prompt", { onUsage });

    expect(onUsage).toHaveBeenCalledWith({ inputTokens: 10, outputTokens: 0, model: "gemini-2.5-pro", tag: undefined });
  });

  it("works with no onUsage passed at all (back-compat, no crash)", async () => {
    const fetchImpl = mockFetch(
      fakeGeminiResponse("hello", { promptTokenCount: 1, candidatesTokenCount: 1 }),
    );
    const complete = makeGeminiComplete({ apiKey: "k", model: "gemini-2.5-flash", fetchImpl });
    await expect(complete("prompt")).resolves.toBe("hello");
  });
});

import { describe, it, expect } from "vitest";
import { providerSpecs, resolveActiveProvider } from "./provider.js";

describe("provider resolution", () => {
  it("defaults to inference when nothing is forced", () => {
    expect(resolveActiveProvider({}).provider).toBe("inference");
  });

  it("resolves the inference provider (OpenAI-compatible enablers server)", () => {
    const spec = resolveActiveProvider({ JUDGE_PROVIDER: "inference" });
    expect(spec.provider).toBe("inference");
    expect(spec.keyVar).toBe("ALGOLIA_INFERENCE_API_KEY");
    expect(spec.judgeModel).toBe("medium");
    expect(spec.baseURL).toBe("https://inference.api.enablers.algolia.net/v1");
  });

  it("honors ALGOLIA_INFERENCE_BASE_URL + JUDGE_MODEL overrides for inference", () => {
    const spec = resolveActiveProvider({
      JUDGE_PROVIDER: "inference",
      ALGOLIA_INFERENCE_BASE_URL: "https://custom.example/v1",
      JUDGE_MODEL: "large",
    });
    expect(spec.baseURL).toBe("https://custom.example/v1");
    expect(spec.judgeModel).toBe("large");
  });

  it("leaves openai without a baseURL (it uses the SDK default host)", () => {
    expect(providerSpecs({}).openai.baseURL).toBeUndefined();
  });

  it("still resolves openai when forced", () => {
    expect(resolveActiveProvider({ JUDGE_PROVIDER: "openai" }).provider).toBe("openai");
  });
});

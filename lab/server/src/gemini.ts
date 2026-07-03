/**
 * gemini — concrete LlmComplete backed by Google's Gemini REST API.
 *
 * PORTED VERBATIM from AC2 lab/server/src/gemini.ts (self-contained, only
 * imports @lab/judge's types). The judge module is provider-agnostic (one
 * injected LlmComplete); this is the default provider for ACS.
 *
 * Wire contract (Protocol Read Receipt — ai.google.dev/api/generate-content,
 * verified live 2026-06-12 against the models list + a generateContent call):
 *   POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key=KEY
 *   Body:   { contents:[{ role, parts:[{text}] }], systemInstruction?, generationConfig:{ temperature, maxOutputTokens } }
 *   Read:   candidates[0].content.parts[].text   (concatenated — thinking models can return multiple parts)
 */
import type { LlmComplete, LlmCompleteOptions } from "@lab/judge";

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

interface GeminiPart {
  text?: string;
  thought?: boolean;
}
interface GeminiResponse {
  candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
  error?: { message?: string };
}

export interface GeminiClientConfig {
  readonly apiKey: string;
  readonly model: string;
  /** Network timeout per call, ms. Default 120000. */
  readonly timeoutMs?: number;
  /** Default output-token cap when a call doesn't specify one. */
  readonly maxOutputTokens?: number;
  /** Max retries on 429/5xx and network errors. Default 5. */
  readonly maxRetries?: number;
  /** Base backoff in ms (doubles per attempt). Default 2000; tests set ~1. */
  readonly backoffBaseMs?: number;
  /** fetch override (tests). */
  readonly fetchImpl?: typeof fetch;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function makeGeminiComplete(cfg: GeminiClientConfig): LlmComplete {
  const fetchImpl = cfg.fetchImpl ?? fetch;
  const timeoutMs = cfg.timeoutMs ?? 120_000;
  const defaultMaxTokens = cfg.maxOutputTokens ?? 8192;
  const maxRetries = cfg.maxRetries ?? 5;
  const backoffBaseMs = cfg.backoffBaseMs ?? 2000;

  return async function geminiComplete(
    prompt: string,
    opts?: LlmCompleteOptions,
  ): Promise<string> {
    const body: Record<string, unknown> = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        ...(typeof opts?.temperature === "number" ? { temperature: opts.temperature } : {}),
        maxOutputTokens: opts?.maxTokens ?? defaultMaxTokens,
      },
    };
    if (opts?.system) {
      body.systemInstruction = { parts: [{ text: opts.system }] };
    }

    // Retry on rate-limit (429), transient server errors (500/502/503/504), AND
    // thrown network errors (dropped connection / timeout) with exponential
    // backoff — a single blip must not crash a run or poison a score.
    let text = "";
    let res: Response | undefined;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        res = await fetchImpl(
          `${BASE}/${cfg.model}:generateContent?key=${cfg.apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: controller.signal,
          },
        );
      } catch (e) {
        // Network-level failure (fetch threw): retryable until we run out.
        if (attempt === maxRetries) {
          throw new Error(`Gemini network error after ${maxRetries} retries: ${(e as Error).message}`);
        }
        await sleep(Math.min(backoffBaseMs * 2 ** attempt, 32_000));
        continue;
      } finally {
        clearTimeout(timer);
      }
      text = await res.text();
      if (res.ok) break;
      const retryable =
        res.status === 429 || res.status === 500 || res.status === 502 || res.status === 503 || res.status === 504;
      if (!retryable || attempt === maxRetries) {
        throw new Error(`Gemini ${res.status}: ${text.slice(0, 500)}`);
      }
      // Backoff: base, 2x, 4x, 8x, 16x (capped at 32s).
      await sleep(Math.min(backoffBaseMs * 2 ** attempt, 32_000));
    }
    if (!res || !res.ok) {
      throw new Error(`Gemini request failed after ${maxRetries} retries`);
    }

    let json: GeminiResponse;
    try {
      json = JSON.parse(text) as GeminiResponse;
    } catch {
      throw new Error(`Gemini returned non-JSON: ${text.slice(0, 300)}`);
    }

    const cand = json.candidates?.[0];
    // Concatenate all answer parts; the judge's parser extracts the JSON object
    // even if a thinking summary precedes it.
    const out = (cand?.content?.parts ?? [])
      .filter((p) => p.thought !== true && typeof p.text === "string")
      .map((p) => p.text as string)
      .join("");
    if (!out) {
      throw new Error(
        `Gemini returned empty text (finishReason=${cand?.finishReason ?? "?"}): ${text.slice(0, 300)}`,
      );
    }
    return out;
  };
}

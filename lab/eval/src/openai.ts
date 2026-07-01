/**
 * openai — concrete LlmComplete backed by the OpenAI Chat Completions REST API.
 *
 * This is the only seam the AI Judge needs: it injects this `openaiComplete`
 * (matching @lab/judge's LlmComplete type) and never imports a vendor SDK.
 *
 * Wire contract (Protocol Read Receipt — OpenAI API reference, /v1/chat/completions):
 *   POST https://api.openai.com/v1/chat/completions
 *   Headers: Authorization: Bearer <key>, Content-Type: application/json
 *   Body:    { model, messages: [{role, content}], ... }
 *   Read:    response.choices[0].message.content
 *
 * Param compatibility: `max_tokens` is renamed `max_completion_tokens` on newer
 * models. NOTE (verified 2026-06-12 by direct probe): gpt-5.2 DOES accept both
 * `temperature` and `seed` (HTTP 200) — the earlier assumption that gpt-5.x
 * rejects non-default temperature was WRONG, and judge temperatures (0.0/0.2/0.3)
 * are in fact honored. The temperature-drop retry below is kept only as defensive
 * degradation for any future model that genuinely restricts the param.
 */
import type { LlmComplete, LlmCompleteOptions } from "@lab/judge";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

interface OpenAIChoice {
  message?: { content?: string | null };
}
interface OpenAIResponse {
  choices?: OpenAIChoice[];
  error?: { message?: string };
}

export interface OpenAIClientConfig {
  readonly apiKey: string;
  readonly model: string;
  /** Network timeout per call, ms. Default 120000. */
  readonly timeoutMs?: number;
  /** fetch override (tests). */
  readonly fetchImpl?: typeof fetch;
}

interface RequestBody {
  model: string;
  messages: { role: string; content: string }[];
  temperature?: number;
  max_completion_tokens?: number;
}

/**
 * Build an `openaiComplete(prompt, opts)` bound to a model + key.
 * Returns the assistant message content (trimmed of nothing — caller decides).
 */
export function makeOpenAIComplete(cfg: OpenAIClientConfig): LlmComplete {
  const fetchImpl = cfg.fetchImpl ?? fetch;
  const timeoutMs = cfg.timeoutMs ?? 120_000;

  async function call(body: RequestBody): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetchImpl(OPENAI_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cfg.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    if (!res.ok) {
      // Surface a typed error so the retry logic can inspect the message.
      const err = new Error(
        `OpenAI ${res.status}: ${text.slice(0, 500)}`,
      ) as Error & { status?: number; bodyText?: string };
      err.status = res.status;
      err.bodyText = text;
      throw err;
    }

    let json: OpenAIResponse;
    try {
      json = JSON.parse(text) as OpenAIResponse;
    } catch {
      throw new Error(`OpenAI returned non-JSON: ${text.slice(0, 300)}`);
    }
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new Error(
        `OpenAI response had no message content: ${text.slice(0, 300)}`,
      );
    }
    return content;
  }

  return async function openaiComplete(
    prompt: string,
    opts?: LlmCompleteOptions,
  ): Promise<string> {
    const messages: { role: string; content: string }[] = [];
    if (opts?.system) messages.push({ role: "system", content: opts.system });
    messages.push({ role: "user", content: prompt });

    const body: RequestBody = { model: cfg.model, messages };
    if (typeof opts?.temperature === "number") body.temperature = opts.temperature;
    if (typeof opts?.maxTokens === "number") {
      body.max_completion_tokens = opts.maxTokens;
    }

    try {
      return await call(body);
    } catch (e) {
      const err = e as Error & { bodyText?: string };
      const msg = err.bodyText ?? err.message ?? "";
      // gpt-5.x reasoning models reject non-default temperature → drop & retry.
      if (/temperature/i.test(msg) && body.temperature !== undefined) {
        delete body.temperature;
        return await call(body);
      }
      throw e;
    }
  };
}

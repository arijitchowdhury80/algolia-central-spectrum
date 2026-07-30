/**
 * auth — minimal protection for the publicly-exposed judge endpoint.
 *
 * PORTED VERBATIM from AC2 lab/server/src/auth.ts (self-contained, no
 * eval-pipeline deps). Dependency-free (native http). Two concerns:
 *   (1) a shared-secret header gate — the frontend sends `x-lab-key`, the
 *       server rejects anything that doesn't match LAB_API_KEY; and
 *   (2) a fixed-window per-IP rate limit, so an exposed endpoint can't be
 *       looped to run up the LLM bill (each judge call spends tokens = money).
 *
 * Auth is OPT-IN: with no LAB_API_KEY set the gate is OPEN, so local dev keeps
 * working untouched. Set LAB_API_KEY in prod to enforce it.
 *
 * Behind Cloudflare the socket peer is the tunnel (localhost) for every
 * request, so the real client IP arrives in the `CF-Connecting-IP` header —
 * rate-limit on that when present.
 */

/** Lowercase header name (node lowercases all incoming header keys). */
export const API_KEY_HEADER = "x-lab-key";

/**
 * Alternate header carrying the SAME secret.
 *
 * The vendored Algolia chat widget's hosted judge client
 * (`vendor/algolia-central-chat-widget/.../hostedJudgeClient.ts`) sends
 * `x-judge-api-key`. It is a third-party client we do not edit, and its header
 * name is arguably the better one — this service is a judge, not a "lab". So we
 * accept both rather than fork their client over a string.
 *
 * Probed live 2026-07-28: a request with only `x-judge-api-key` returned 401.
 * That is the failure this alias removes. It is NOT a weakening — the secret,
 * the comparison and the gate are identical; only the envelope differs.
 */
export const API_KEY_HEADER_ALT = "x-judge-api-key";

/** Length-checked, constant-time-ish compare to avoid an early-exit timing leak. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** True if the request may proceed. An empty/undefined expectedKey = gate OPEN.
 *
 *  Accepts the key in EITHER accepted header (see API_KEY_HEADER_ALT): pass the
 *  values of both and the first non-empty one is checked. A caller supplying
 *  just one header is unaffected. */
export function isAuthorized(
  headerValue: string | string[] | undefined,
  expectedKey: string | undefined,
  altHeaderValue?: string | string[] | undefined,
): boolean {
  if (!expectedKey) return true; // gate disabled (dev / localhost-only)
  const pick = (v: string | string[] | undefined): string | undefined =>
    Array.isArray(v) ? v[0] : v;
  const got = pick(headerValue) || pick(altHeaderValue);
  if (!got) return false;
  return safeEqual(got, expectedKey);
}

/** Resolve the client IP, preferring Cloudflare's forwarded header. */
export function clientIp(
  headers: Record<string, string | string[] | undefined>,
  fallback: string | undefined,
): string {
  const pick = (v: string | string[] | undefined): string | undefined =>
    Array.isArray(v) ? v[0] : v;
  const cf = pick(headers["cf-connecting-ip"]);
  const xff = pick(headers["x-forwarded-for"])?.split(",")[0]?.trim();
  return (cf || xff || fallback || "unknown").trim();
}

/** Fixed-window per-key rate limiter. Clock injectable for deterministic tests. */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Returns true if allowed; false if `key` is over the limit this window. */
  check(key: string): boolean {
    if (this.limit <= 0) return true; // disabled
    const t = this.now();
    const e = this.hits.get(key);
    if (!e || t >= e.resetAt) {
      this.hits.set(key, { count: 1, resetAt: t + this.windowMs });
      return true;
    }
    if (e.count >= this.limit) return false;
    e.count += 1;
    return true;
  }
}

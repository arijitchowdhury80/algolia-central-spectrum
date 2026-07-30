/**
 * trace — stage-level observability for a judge run.
 *
 * WHY THIS EXISTS
 * ---------------
 * The judge's cost was "49 seconds" and nobody could say where it went. Timing
 * the LLM calls in isolation gave 19.8s, the same panel over HTTP gave 27-56s,
 * and the browser saw 82.6s — three numbers for the same work, with the gaps
 * unexplained. Guessing at those gaps is how you end up capping something that
 * was never the cost. This makes every stage report its own duration.
 *
 * DESIGN
 * ------
 * Off by default and a no-op when off: `JUDGE_TRACE=1` (or `setTracing(true)`)
 * turns it on. It records, it never changes behaviour, and it never throws into
 * a judge run — an observability tool that can break the thing it observes is
 * worse than none.
 *
 * Timestamps are relative to `resetTrace()`, so a trace reads as a timeline
 * rather than a wall clock, and concurrent stages are visible as overlap.
 */

export interface TraceEvent {
  /** Stage name, e.g. `llm:judge:skeptic:round1`, `detGround`, `http:parse`. */
  readonly name: string;
  /** Milliseconds since resetTrace(). */
  readonly startMs: number;
  readonly endMs: number;
  readonly durationMs: number;
  /** Free-form size/count detail — chars in, chars out, retries, bytes. */
  readonly detail?: Readonly<Record<string, number | string>>;
}

/**
 * Read `JUDGE_TRACE` without assuming Node. This package is also bundled into
 * the browser widget, where a bare `process` reference is a ReferenceError at
 * load — an observability switch must not be able to break the thing it
 * observes, least of all by failing to start.
 */
function tracingFromEnv(): boolean {
  const g = globalThis as { process?: { env?: Record<string, string | undefined> } };
  return g.process?.env?.JUDGE_TRACE === "1";
}

let enabled = tracingFromEnv();
let origin = Date.now();
let events: TraceEvent[] = [];

export function setTracing(on: boolean): void {
  enabled = on;
}

export function isTracing(): boolean {
  return enabled;
}

/** Start a fresh timeline. Call once per request. */
export function resetTrace(): void {
  origin = Date.now();
  events = [];
}

export function getTrace(): readonly TraceEvent[] {
  return events;
}

/** Record a stage that has already happened, given its start time. */
export function markSince(
  name: string,
  startedAt: number,
  detail?: Record<string, number | string>,
): void {
  if (!enabled) return;
  const now = Date.now();
  events.push({
    name,
    startMs: startedAt - origin,
    endMs: now - origin,
    durationMs: now - startedAt,
    detail,
  });
}

/**
 * Time an async stage. Records even when it throws, because a stage that failed
 * slowly is exactly the kind of thing this is for.
 */
export async function span<T>(
  name: string,
  fn: () => Promise<T>,
  detail?: (result: T) => Record<string, number | string>,
): Promise<T> {
  if (!enabled) return fn();
  const startedAt = Date.now();
  try {
    const out = await fn();
    markSince(name, startedAt, detail?.(out));
    return out;
  } catch (e) {
    markSince(name, startedAt, { failed: 1 });
    throw e;
  }
}

/** Time a synchronous stage. */
export function spanSync<T>(
  name: string,
  fn: () => T,
  detail?: (result: T) => Record<string, number | string>,
): T {
  if (!enabled) return fn();
  const startedAt = Date.now();
  const out = fn();
  markSince(name, startedAt, detail?.(out));
  return out;
}

/**
 * Render the timeline oldest-first, with a bar showing when each stage ran.
 *
 * Offsets can be NEGATIVE and that is legitimate: work that happened before
 * `resetTrace()` — reading the request body off the socket — is reported
 * relative to a later origin. The scale is therefore anchored to the earliest
 * event rather than to zero. (First traced run crashed the process here on
 * `" ".repeat(-1)`; the guard below is why the renderer now cannot.)
 */
export function formatTrace(width = 48): string {
  if (events.length === 0) return "(tracing produced no events)";
  const first = Math.min(...events.map((e) => e.startMs));
  const last = Math.max(...events.map((e) => e.endMs));
  const total = Math.max(last - first, 1);
  const rows = [...events].sort((a, b) => a.startMs - b.startMs);
  const nameWidth = Math.max(...rows.map((r) => r.name.length));
  const lines = rows.map((e) => {
    const from = Math.min(width, Math.max(0, Math.floor(((e.startMs - first) / total) * width)));
    const len = Math.max(1, Math.round((e.durationMs / total) * width));
    const bar = `${" ".repeat(from)}${"█".repeat(Math.min(len, width - from))}`;
    const detail = e.detail
      ? `  ${Object.entries(e.detail)
          .map(([k, v]) => `${k}=${v}`)
          .join(" ")}`
      : "";
    return (
      `${e.name.padEnd(nameWidth)} ${String(e.startMs).padStart(6)}ms ` +
      `${String(e.durationMs).padStart(6)}ms |${bar.padEnd(width)}|${detail}`
    );
  });
  return lines.join("\n");
}

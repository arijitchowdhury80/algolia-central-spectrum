/**
 * buildInfo — makes deployment skew CHECKABLE with one curl.
 *
 * Root cause this exists to prevent (2026-07-19 CI auto-deploy build): a
 * running judge container has no way to say what code it's actually running. That's what
 * let a stale/wrong deployment go unnoticed for weeks. GET /health now
 * echoes the exact commit + build time baked into the image, so "is the VPS
 * running what's in the repo?" is a one-line comparison, not a docker exec
 * archaeology session.
 *
 * GIT_SHA / BUILT_AT are set as Docker ENV at build time (see
 * deploy/vps-judge/Dockerfile) — never computed at request time, so a
 * container always reports the commit it was actually built from, not
 * whatever happens to be checked out on the host right now.
 */

export interface BuildInfo {
  /** Full git commit SHA the image was built from, or "unknown" outside a build. */
  sha: string;
  /** ISO-8601 timestamp the image was built, or "unknown" outside a build. */
  builtAt: string;
}

export function getBuildInfo(env: NodeJS.ProcessEnv = process.env): BuildInfo {
  return {
    sha: env.GIT_SHA || "unknown",
    builtAt: env.BUILT_AT || "unknown",
  };
}

export function healthPayload(env: NodeJS.ProcessEnv = process.env): { ok: true } & BuildInfo {
  return { ok: true, ...getBuildInfo(env) };
}

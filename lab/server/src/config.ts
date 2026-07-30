/**
 * config — minimal env loader for the ACS judge service.
 *
 * PORTED (trimmed) from AC2 lab/server/src/config.ts. AC2's config.ts also
 * exports `loadConfig()` / `PanelConfig`, which depend on `./panels.js` (the
 * 2x2 eval-pipeline panel set — explicitly excluded from this port, see
 * ACS lab/server's deliverable notes). The judge slice (activeJudgeLlm.ts)
 * only ever needs the merged env map, so this file keeps just that: the
 * dependency-free `.env.local` parser + `getEnv()`.
 *
 * Env files, no external dotenv dependency:
 *   - root .env.local → GOOGLE_API_KEY / OPENAI_API_KEY (judge LLM keys)
 *   - web/.env.local  → not required by the judge; merged if present so this
 *                       stays a drop-in read of the same env AC2 used.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
// lab/server/src -> repo root is three levels up.
export const REPO_ROOT = resolve(__dirname, "..", "..", "..");

/** Minimal .env parser: KEY=VALUE lines, ignores comments/blank, strips quotes. */
function parseEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

/** Merged env: process.env wins, then web/.env.local, then root .env.local. */
function loadEnv(): Record<string, string> {
  const root = parseEnvFile(resolve(REPO_ROOT, ".env.local"));
  const web = parseEnvFile(resolve(REPO_ROOT, "web", ".env.local"));
  return { ...root, ...web, ...(process.env as Record<string, string>) };
}

const ENV = loadEnv();

/** The merged env map (process.env + .env.local files). Used by the provider resolver. */
export function getEnv(): Record<string, string | undefined> {
  return ENV;
}

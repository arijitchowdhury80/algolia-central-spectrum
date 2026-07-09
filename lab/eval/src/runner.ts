/**
 * ACS eval runner — scores the ACS agents (Generic / Technical) with the ported
 * @lab/judge (blind Skeptic/Referee/Advocate panel + grounding hard-gate).
 *
 * INDICATIVE ONLY until P2b judge calibration (the standing trust gate carried from
 * AC2). Reads ../../.env.local (ALGOLIA_APP_ID, ALGOLIA_ADMIN_API_KEY, GOOGLE_API_KEY).
 *
 * KNOWN STALE (found 2026-07-08, not fixed here — out of scope of that day's
 * work): the `Artifact` passed to `judgeArtifact` below uses `{question,
 * answer, sources:{id,url,text}}`, but the current @lab/judge `Artifact` type
 * is `{prompt, content, sources:{id,text,label}}` — this file predates that
 * schema and its scores are unlikely to reflect real judge output as-is. See
 * `orchestratorRunner.ts` for the corrected shape and hardcoded agent IDs
 * that also postdate this file (rebuilt with the client_side tool schema).
 *
 *   npx tsx src/runner.ts               # both agents, all questions
 *   npx tsx src/runner.ts ACS-technical-neural
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { judgeArtifact, DEFAULT_JUDGE_CONFIG, type Artifact } from "@lab/judge";
import { makeGeminiComplete } from "./gemini.js";

// Agent call that CAPTURES the retrieved body text (the ported agentRunner drops it).
// The judge needs real source text to assess grounding — passing titles floors every score.
type Hit = { id: string; url?: string; text?: string };
const SRC_TEXT_CAP = 1200; // per-source chars fed to the judge (bodies run to 90K)
async function askAgent(appId: string, key: string, agentId: string, question: string): Promise<{ answer: string; sources: Hit[] }> {
  const res = await fetch(`https://${appId}.algolia.net/agent-studio/1/agents/${agentId}/completions?compatibilityMode=ai-sdk-4`, {
    method: "POST", headers: { "X-Algolia-Application-Id": appId, "X-Algolia-API-Key": key, "Content-Type": "application/json", "User-Agent": "curl/8.4.0" },
    body: JSON.stringify({ messages: [{ role: "user", content: question }] }),
  });
  // never res.text() on this streaming endpoint — it intermittently truncates
  // the SSE body to empty, and Agent Studio caches that empty answer keyed on
  // the exact query (SESSION.md "KEY DEBUG LESSON"). Read via a reader.
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let raw = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    raw += decoder.decode(value, { stream: true });
  }
  let answer = ""; const sources: Hit[] = []; let n = 0;
  for (const line of raw.split("\n")) {
    const t = line.trim(); if (!t) continue;
    const i = t.indexOf(":"); if (i === -1) continue;
    const p = t.slice(0, i), pl = t.slice(i + 1);
    if (p === "0") { try { answer += JSON.parse(pl); } catch { /* */ } }
    else if (p === "a") {
      try {
        const r = JSON.parse(pl).result; const arr = Array.isArray(r) ? r : (r?.hits ?? []);
        for (const h of arr) { if (!h || (!h.url && !h.title)) continue; sources.push({ id: `S${++n}`, url: h.url, text: `${h.title ?? ""}\n${(h.body ?? h.description ?? "").slice(0, SRC_TEXT_CAP)}`.trim() }); }
      } catch { /* */ }
    }
  }
  return { answer, sources };
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..", "..");
const ENV: Record<string, string> = {};
for (const l of readFileSync(join(ROOT, ".env.local"), "utf8").split("\n")) {
  const t = l.trim(); if (!t || t.startsWith("#") || !t.includes("=")) continue;
  const i = t.indexOf("="); ENV[t.slice(0, i).trim()] = t.slice(i + 1).trim();
}
const APP = ENV.ALGOLIA_APP_ID, AKEY = ENV.ALGOLIA_ADMIN_API_KEY, GKEY = ENV.GOOGLE_API_KEY;
if (!APP || !AKEY || !GKEY) { console.error("need ALGOLIA_APP_ID, ALGOLIA_ADMIN_API_KEY, GOOGLE_API_KEY"); process.exit(1); }

const AGENTS: Record<string, string> = {
  "ACS-generic-neural": "13809d4b-6b6d-4297-b95c-a934bceef0b4",
  "ACS-technical-neural": "63ab0c86-3493-416b-a771-a820ab25d83d",
};
const only = process.argv[2];
const agentNames = only ? [only] : Object.keys(AGENTS);

const questions: { id: string; q: string; expectedBehavior: "answer" | "refuse" }[] =
  JSON.parse(readFileSync(join(__dirname, "questions.json"), "utf8"));

const llm = makeGeminiComplete({ apiKey: GKEY, model: ENV.JUDGE_LIVE_MODEL ?? "gemini-2.5-flash" });

const results: { agent: string; id: string; score: number; gate: boolean; err?: string }[] = [];
for (const agent of agentNames) {
  const id = AGENTS[agent];
  console.log(`\n=== ${agent} ===`);
  for (const { id: qid, q, expectedBehavior } of questions) {
    const run = await askAgent(APP, AKEY, id, q);
    const artifact: Artifact = {
      type: "algolia-answer",
      question: q,
      answer: run.answer,
      sources: run.sources,
      expectedBehavior,
    };
    const r = await judgeArtifact(artifact, DEFAULT_JUDGE_CONFIG, llm);
    const score = r.synthesis.finalScore;
    const gate = r.synthesis.gate?.tripped ?? false;
    console.log(`  ${qid.padEnd(8)} score=${score.toFixed(2)} ${gate ? "GATE" : "    "} hits=${run.sources.length}  "${q.slice(0, 42)}…"`);
    results.push({ agent, id: qid, score, gate });
  }
}

console.log("\n===== SUMMARY (INDICATIVE — pre-P2b calibration) =====");
for (const agent of agentNames) {
  const rows = results.filter((r) => r.agent === agent);
  const clean = rows.filter((r) => !r.gate && !r.err);
  const mean = clean.length ? clean.reduce((a, r) => a + r.score, 0) / clean.length : 0;
  console.log(`${agent}: mean(non-gated)=${mean.toFixed(2)}  gated=${rows.filter((r) => r.gate).length}/${rows.length}`);
}

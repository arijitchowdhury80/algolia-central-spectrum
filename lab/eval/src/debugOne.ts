/** One-off debug probe: run a single question through the orchestrator flow
 *  and dump the full judge panel output (per-judge rationale + violations),
 *  not just the summary score. Delete once the harness is validated. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { judgeArtifact, DEFAULT_JUDGE_CONFIG, type Artifact } from "@lab/judge";
import { makeGeminiComplete } from "./gemini.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..", "..");
const ENV: Record<string, string> = {};
for (const l of readFileSync(join(ROOT, ".env.local"), "utf8").split("\n")) {
  const t = l.trim();
  if (!t || t.startsWith("#") || !t.includes("=")) continue;
  const i = t.indexOf("=");
  ENV[t.slice(0, i).trim()] = t.slice(i + 1).trim();
}
const APP = ENV.ALGOLIA_APP_ID, AKEY = ENV.ALGOLIA_ADMIN_API_KEY, GKEY = ENV.GOOGLE_API_KEY;
const GENERIC_ID = "95826da6-d1b6-4b81-b061-bfb52b881356";

async function callAgent(agentId: string, question: string) {
  const res = await fetch(`https://${APP}.algolia.net/agent-studio/1/agents/${agentId}/completions?compatibilityMode=ai-sdk-4`, {
    method: "POST",
    headers: { "X-Algolia-Application-Id": APP!, "X-Algolia-API-Key": AKEY!, "Content-Type": "application/json", "User-Agent": "curl/8.4.0" },
    body: JSON.stringify({ messages: [{ role: "user", content: question }] }),
  });
  // never res.text() on this streaming endpoint — see orchestratorRunner.ts comment
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let raw = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    raw += decoder.decode(value, { stream: true });
  }
  let text = ""; const sources: { id: string; url?: string; text?: string }[] = []; let n = 0;
  for (const line of raw.split("\n")) {
    const t = line.trim(); if (!t) continue;
    const i = t.indexOf(":"); if (i === -1) continue;
    const p = t.slice(0, i), pl = t.slice(i + 1);
    if (p === "0") { try { text += JSON.parse(pl); } catch {} }
    else if (p === "a") {
      try {
        const r = JSON.parse(pl).result; const arr = Array.isArray(r) ? r : (r?.hits ?? []);
        for (const h of arr) {
          if (!h || (!h.url && !h.title)) continue;
          const raw2 = h.body ?? h.description ?? "";
          const fm = raw2.match(/^```?\s*\n?---\r?\n[\s\S]*?\r?\n---\r?\n?/);
          const stripped = (fm ? raw2.slice(fm[0].length) : raw2).replace(/^```\s*\n?/, "").slice(0, 3500);
          sources.push({ id: `S${++n}`, url: h.url, text: `${h.title ?? ""}\n${stripped}`.trim() });
        }
      } catch {}
    }
  }
  return { text: text.replace(/\[\[FOLLOWUP:[^\]]+\]\]/i, "").trim(), sources };
}

const q = process.argv[2] ?? "When should I use a ComboBox vs a Picker in Spectrum?";
const { text, sources } = await callAgent(GENERIC_ID, q);
console.log("=== ANSWER ===\n" + text);
console.log(`\n=== SOURCES (${sources.length}) ===`);
for (const s of sources) console.log(`- ${s.id} ${s.url}\n  ${s.text?.slice(0, 150)}...`);

const llm = makeGeminiComplete({ apiKey: GKEY!, model: "gemini-2.5-flash" });
const artifact: Artifact = { type: "algolia-answer", prompt: q, content: text, sources: sources.map((s) => ({ id: s.id, text: s.text ?? "", label: s.url })), expectedBehavior: "answer" };
const r = await judgeArtifact(artifact, DEFAULT_JUDGE_CONFIG, llm);
console.log("\n=== JUDGMENTS ===");
for (const j of r.judgments) {
  console.log(`\n-- ${j.judgeId} (${j.temperament}) weighted=${j.weightedScore.toFixed(2)} --`);
  for (const d of j.dimensionScores) console.log(`  ${d.dimensionId}: ${d.score} — ${d.rationale}`);
  if (j.groundingViolations.length) {
    console.log("  VIOLATIONS:");
    for (const v of j.groundingViolations) console.log(`    [${v.kind ?? "contradicted"} certainty=${v.certainty}] ${v.claim} — ${v.reason}`);
  }
  console.log(`  summary: ${j.summary}`);
}
console.log(`\n=== SYNTHESIS === final=${r.synthesis.finalScore} preGate=${r.synthesis.preGateScore} gate.tripped=${r.synthesis.gate.tripped}`);
console.log(r.synthesis.rationale);

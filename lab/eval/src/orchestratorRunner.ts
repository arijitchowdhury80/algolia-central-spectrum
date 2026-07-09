/**
 * ACS orchestrator eval — drives the REAL Generic -> tool-call -> Technical
 * flow (the 2026-07-08 client_side tool architecture, replacing the old text
 * sentinel), scores the COMBINED answer with the ported @lab/judge, and
 * reports whether the handoff mechanism itself fired correctly.
 *
 * This is deliberately separate from runner.ts (which scores each agent
 * standalone) — the point here is to prove the ORCHESTRATION, not just
 * per-agent answer quality: does Generic call the tool exactly when it
 * should, does the resolved query make sense, and does the combined answer
 * hold up under the judge.
 *
 * INDICATIVE ONLY — judge is uncalibrated (P2b never run). Every score in
 * this run's output must be read as directional, not authoritative (Arijit's
 * explicit call, 2026-07-08 — see CLAUDE.md's standing Goodhart warning).
 *
 *   npx tsx src/orchestratorRunner.ts [limit]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { judgeArtifact, DEFAULT_JUDGE_CONFIG, type Artifact } from "@lab/judge";
import { makeGeminiComplete } from "./gemini.js";

type Hit = { id: string; url?: string; text?: string };
type ToolCall = { toolCallId: string; toolName: string; query: string };
const SRC_TEXT_CAP = 3500;

/**
 * ROOT-CAUSE FIX (2026-07-08 pilot run): SpectrumDesignDocs records store body
 * as a fenced block opening with ~700-900 chars of pure YAML frontmatter
 * (title/source_url/tags/etc — zero descriptive content) before any real text.
 * A flat char-cap from position 0 was feeding the judge almost nothing but
 * that metadata, tanking grounding scores on every design-doc-sourced answer
 * — not a Generic-agent defect, a harness defect. Strip the frontmatter block
 * (between the first two `---` lines) before capping. ReactSpectrumS2/V3
 * records have no frontmatter and pass through unchanged.
 */
function extractRelevantBody(raw: string, cap: number): string {
  const fmMatch = raw.match(/^```?\s*\n?---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  const body = fmMatch ? raw.slice(fmMatch[0].length) : raw;
  return body.replace(/^```\s*\n?/, "").slice(0, cap);
}

/** Parsed result of one completions call: text (up to any tool-call pause),
 *  hits seen, and the tool call itself if one fired. */
interface AgentTurn {
  text: string;
  sources: Hit[];
  toolCall?: ToolCall;
}

const FOLLOWUP_RE = /\[\[FOLLOWUP:\s*([^\]]+?)\]\]/i;

async function callAgent(appId: string, key: string, agentId: string, question: string): Promise<AgentTurn> {
  const res = await fetch(`https://${appId}.algolia.net/agent-studio/1/agents/${agentId}/completions?compatibilityMode=ai-sdk-4`, {
    method: "POST",
    headers: { "X-Algolia-Application-Id": appId, "X-Algolia-API-Key": key, "Content-Type": "application/json", "User-Agent": "curl/8.4.0" },
    body: JSON.stringify({ messages: [{ role: "user", content: question }] }),
  });
  // KEY DEBUG LESSON (SESSION.md): node fetch + `await res.text()` on this
  // STREAMING endpoint intermittently truncates the SSE body to empty, and
  // Agent Studio then CACHES that empty answer keyed on the exact query —
  // poisoning it for every future identical call. Read via a streaming
  // reader instead, exactly like scripts/spikes/.../roundtrip-harness.mjs.
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let raw = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    raw += decoder.decode(value, { stream: true });
  }
  let text = "";
  const sources: Hit[] = [];
  let n = 0;
  let toolCall: ToolCall | undefined;
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    const i = t.indexOf(":");
    if (i === -1) continue;
    const p = t.slice(0, i), pl = t.slice(i + 1);
    if (p === "0") {
      try { text += JSON.parse(pl); } catch { /* skip malformed delta */ }
    } else if (p === "a") {
      try {
        const r = JSON.parse(pl).result;
        const arr = Array.isArray(r) ? r : (r?.hits ?? []);
        for (const h of arr) {
          if (!h || (!h.url && !h.title)) continue;
          const body = extractRelevantBody(h.body ?? h.description ?? "", SRC_TEXT_CAP);
          sources.push({ id: `S${++n}`, url: h.url, text: `${h.title ?? ""}\n${body}`.trim() });
        }
      } catch { /* skip malformed tool-result frame */ }
    } else if (p === "9") {
      try {
        const tc = JSON.parse(pl) as { toolCallId?: string; toolName?: string; args?: { query?: string } };
        if (tc.toolName === "consult_technical_specialist") {
          toolCall = { toolCallId: tc.toolCallId ?? "", toolName: tc.toolName, query: tc.args?.query ?? "" };
        }
      } catch { /* skip malformed tool-call frame */ }
    }
  }
  return { text: text.trim(), sources, toolCall };
}

function stripFollowup(text: string): { display: string; followUp?: string } {
  const m = text.match(FOLLOWUP_RE);
  return { display: text.replace(FOLLOWUP_RE, "").trim(), followUp: m ? m[1].trim() : undefined };
}

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
if (!APP || !AKEY || !GKEY) { console.error("need ALGOLIA_APP_ID, ALGOLIA_ADMIN_API_KEY, GOOGLE_API_KEY"); process.exit(1); }

// Live agent IDs (rebuilt 2026-07-08 with the client_side tool architecture —
// see web/src/config/instances/spectrum.ts, the source of truth for the app).
const GENERIC_ID = "95826da6-d1b6-4b81-b061-bfb52b881356";
const TECHNICAL_ID = "ae127977-c728-4b7c-bc15-6502a77873d1";

const limit = Number(process.argv[2]) || 100;
const allQuestions: { id: string; q: string; expectedBehavior: "answer" | "refuse"; expectedHandoff: boolean }[] =
  JSON.parse(readFileSync(join(__dirname, "questions-orchestrator.json"), "utf8"));
const questions = allQuestions.slice(0, limit);

const llm = makeGeminiComplete({ apiKey: GKEY, model: ENV.JUDGE_LIVE_MODEL ?? "gemini-2.5-flash" });

interface Row {
  id: string;
  q: string;
  expectedHandoff: boolean;
  actualHandoff: boolean;
  handoffCorrect: boolean;
  grounding: number;
  coverage: number;
  depth: number;
  relevance: number;
  finalScore: number;
  gate: boolean;
  err?: string;
}

const rows: Row[] = [];
let i = 0;
for (const { id, q, expectedBehavior, expectedHandoff } of questions) {
  i++;
  process.stdout.write(`[${i}/${questions.length}] ${id} `);
  try {
    const generic = await callAgent(APP, AKEY, GENERIC_ID, q);
    const { display, followUp } = stripFollowup(generic.text);
    let combinedAnswer = display;
    let combinedSources = generic.sources;
    const actualHandoff = !!generic.toolCall;

    if (generic.toolCall) {
      const technical = await callAgent(APP, AKEY, TECHNICAL_ID, generic.toolCall.query || q);
      const techDisplay = stripFollowup(technical.text).display;
      combinedAnswer = [display, techDisplay].filter(Boolean).join("\n\n");
      combinedSources = [...generic.sources, ...technical.sources];
    }

    // Real Artifact contract (lab/judge/src/types.ts): `content`, not `answer`;
    // sources are {id, text, label?} — no `url` field. The prior runner.ts in
    // this repo used a stale {answer, sources:{id,url,text}} shape that does
    // not match the current judge package.
    const artifact: Artifact = {
      type: "algolia-answer",
      prompt: q,
      content: combinedAnswer,
      sources: combinedSources.map((s) => ({ id: s.id, text: s.text ?? "", label: s.url })),
      expectedBehavior,
    };
    const r = await judgeArtifact(artifact, DEFAULT_JUDGE_CONFIG, llm);
    const score = r.synthesis.finalScore;
    const gate = r.synthesis.gate?.tripped ?? false;
    const handoffCorrect = actualHandoff === expectedHandoff;

    // Per-dimension scores live per-judge in judgments[].dimensionScores[], not
    // rolled up on synthesis — average each dimension across the panel here.
    const dimAvg = (id: string) => {
      const vals = r.judgments.flatMap((j) => j.dimensionScores.filter((d) => d.dimensionId === id).map((d) => d.score));
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : NaN;
    };

    rows.push({
      id, q, expectedHandoff, actualHandoff, handoffCorrect,
      grounding: dimAvg("grounding"),
      coverage: dimAvg("coverage"),
      depth: dimAvg("depth"),
      relevance: dimAvg("relevance"),
      finalScore: score, gate,
    });
    console.log(`score=${score.toFixed(2)} ${gate ? "GATE" : "    "} handoff=${actualHandoff ? "Y" : "N"}${handoffCorrect ? "" : " ✗WRONG"} followUp=${followUp ? "Y" : "N"} hits=${combinedSources.length}`);
  } catch (e) {
    console.log(`ERROR ${(e as Error).message}`);
    rows.push({ id, q, expectedHandoff, actualHandoff: false, handoffCorrect: false, grounding: NaN, coverage: NaN, depth: NaN, relevance: NaN, finalScore: NaN, gate: false, err: (e as Error).message });
  }
}

const outPath = join(__dirname, "..", "orchestrator-results.json");
writeFileSync(outPath, JSON.stringify(rows, null, 2));

console.log("\n===== SUMMARY (INDICATIVE — judge uncalibrated, P2b never run) =====");
const clean = rows.filter((r) => !r.gate && !r.err && !Number.isNaN(r.finalScore));
const mean = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : NaN);
console.log(`total=${rows.length}  errors=${rows.filter((r) => r.err).length}  gated=${rows.filter((r) => r.gate).length}`);
console.log(`handoff correct: ${rows.filter((r) => r.handoffCorrect).length}/${rows.length}`);
console.log(`mean finalScore (non-gated, non-error) = ${mean(clean.map((r) => r.finalScore)).toFixed(2)}`);
console.log(`mean grounding=${mean(clean.map((r) => r.grounding)).toFixed(2)}  coverage(breadth)=${mean(clean.map((r) => r.coverage)).toFixed(2)}  depth=${mean(clean.map((r) => r.depth)).toFixed(2)}  relevance(quality)=${mean(clean.map((r) => r.relevance)).toFixed(2)}`);
const perfect = rows.filter((r) => r.grounding === 10 && r.coverage === 10 && r.depth === 10 && r.relevance === 10 && r.handoffCorrect);
console.log(`perfect (10/10/10/10 + correct handoff): ${perfect.length}/${rows.length}`);
const failures = rows.filter((r) => r.err || r.gate || !r.handoffCorrect || r.finalScore < 7);
console.log(`\nfailures/low-scores (${failures.length}):`);
for (const f of failures) console.log(`  ${f.id}: score=${f.finalScore?.toFixed?.(2) ?? "N/A"} gate=${f.gate} handoffCorrect=${f.handoffCorrect} err=${f.err ?? ""} — "${f.q.slice(0, 60)}"`);
console.log(`\nwrote ${outPath}`);

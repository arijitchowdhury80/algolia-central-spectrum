# Deploying

Three deployables. None is automatic. Each is a deliberate step.

| # | Deployable | Target |
|---|---|---|
| 1 | Widget site (`/`, `/demo/`) | Vercel |
| 2 | Grounding judge | A container behind a reverse proxy |
| 3 | Agents | Agent Studio |

The corpus is not a deploy — see [Corpus](#corpus--not-a-deploy).

---

## 1. Widget site → Vercel

**Production deploys are manual.** `vercel.json` sets:

```json
"git": { "deploymentEnabled": { "main": false } }
```

Why: Vercel's Git integration was auto-deploying every push to `main`. On 2026-07-28 three pushes reached production unintentionally — one shipped a client expecting a judge field the deployed judge did not yet return, and the live confidence chip read "Grounding · unavailable" for about two hours. **Pushing is not a neutral act unless this setting is in place.**

Deploy:

```bash
vercel --prod --yes     # from the repo root; the project is linked via .vercel/
```

Vercel runs `scripts/deploy/build_prod_site.sh`, which builds four packages in dependency order — the two vendored widget packages, the enhancement layer, then the full-screen app — and assembles them with `scripts/widget/build_demo_site.mjs`.

### The build refuses to ship a misconfigured site

These are hard failures, not warnings. Each exists because the corresponding mistake reached production once.

| Check | Fails when |
|---|---|
| `VITE_JUDGE_URL` set | Missing — the client's judge calls would go to `localhost` |
| Judge key present in the bundle | Missing — every judge call would return 401 |
| Enhancement script on every widget page | A page hosting `<algolia-chat>` reached the output without `acs-enhance.js`, so it would ship the widget's own in-browser judge instead of ours |
| Proactive context assets present | `context/context-engine.js`, `personas.js` or `agents.generated.json` missing — the demo pages would load a 404 and track nothing |

The page list is derived from the vendored source rather than hardcoded, so a page added upstream is covered automatically.

### Environment

`VITE_JUDGE_URL` and `VITE_LAB_API_KEY` live in the Vercel project, not the repo. A local build without them produces a bundle whose judge calls go to `http://localhost:8788`.

Note the naming seam: the vendored client reads the secret as `VITE_JUDGE_API_KEY`; this project has always called it `VITE_LAB_API_KEY`. The build script exports both so either spelling resolves. Setting only one silently produced 401s on every judge call.

### Verify after deploying

Do not trust the deploy's own success message.

```bash
B=https://<your-deployment>

# surfaces respond
for p in / /demo/ /demo/button.html; do
  echo "$p -> $(curl -s -o /dev/null -w '%{http_code}' $B$p)"
done

# the demo pages carry our enhancement layer
curl -s $B/demo/button.html | grep -c acs-enhance.js

# the judge endpoint baked into the bundle is the real one
curl -s $B/acs-enhance.js | grep -oE 'https://[a-z.]+/acs'
```

Then load the site, ask a question, and read the chip. A changed bundle hash proves a deploy happened; it does not prove the feature works.

**The widget bundle is what carries the judge URL.** `judgeUrl()` prefers runtime config but falls back to the `VITE_JUDGE_URL` compiled into the bundle, and in practice the compiled value is what takes effect — setting the `url` attribute on `<algolia-chat-confidence>` alone does **not** repoint the judge. Confirm in the network tab: our judge is one call to the judge host; the widget's own engine is three calls to `algolia.net/agent-studio`.

---

## 2. Judge → container behind a reverse proxy

Runs as the `acs-lab-backend` container on the judge host.

**The `acs-judge-deploy.timer` is inactive**, so the judge never updates itself. It once drifted 20 commits behind `main` that way, which is how a client shipped against a judge lacking the fields it expected.

```bash
# 1. tag a rollback image FIRST
ssh -i ~/.ssh/<judge_deploy_key> <deployuser>@<JUDGE_HOST> \
  "sudo -n docker tag acs-lab-backend:latest acs-lab-backend:rollback-$(date +%Y%m%d)"

# 2. deploy — fast-forwards the checkout, rebuilds, health-checks by SHA
ssh -i ~/.ssh/<judge_deploy_key> <deployuser>@<JUDGE_HOST> \
  "cd ~/acs-judge && bash deploy/vps-deploy-judge.sh"
```

The script refuses a dirty checkout, rebuilds only when something under `lab/judge/`, `lab/server/` or `deploy/vps-judge/` changed, and fails loudly if the running container does not report the SHA it just built.

### Verify

```bash
curl -s https://<judge-host>/acs/health      # must report the SHA you deployed
```

A healthy container is not the same as a correct contract. Confirm it emits the fields the client needs — each panel should carry `grounded`, `unsupportedTerms`, `termsChecked` and `groundingMode`:

```bash
curl -s -X POST https://<judge-host>/acs/api/ground \
  -H 'content-type: application/json' -H "x-judge-api-key: $KEY" \
  -d '{"question":"…","panels":[{"panelId":"p1","answer":"…","sources":[…]}]}'
```

Without the key you get `{"error":"unauthorized"}`. `/api/ground` runs the deterministic gate only and spends no tokens; `/api/judge` runs the full panel and does.

### Rollback

```bash
ssh -i ~/.ssh/<judge_deploy_key> <deployuser>@<JUDGE_HOST> \
  "sudo -n docker tag acs-lab-backend:rollback-YYYYMMDD acs-lab-backend:latest && \
   cd ~/acs-judge && sudo -n docker compose -f deploy/vps-judge/docker-compose.yml up -d"
```

---

## 3. Agents → Agent Studio

```bash
node scripts/agents/build_acs_agents.mjs
```

Agents are **PATCHed in place**, never deleted and recreated, so their IDs stay stable — those IDs are embedded in page markup and in `context/agents.generated.json`.

Snapshot before changing anything:

```bash
node scripts/agents/snapshot_panel_agents.mjs     # writes to scripts/agents/snapshots/
node scripts/agents/restore_agent_from_snapshot.mjs <agent> <snapshot>
```

**Before running the build script, check `MAIN_MODEL` in `scripts/agents/agentConfig.mjs`.** It currently declares a model that differs from what the live agents run, so running the script as-is would change their model.

The judge agents are rubric-agnostic by design: the rubric travels with each request from `lab/judge`. Baking a rubric back into their instructions breaks any other consumer of the same agents.

---

## Corpus — not a deploy

`ACS_SPECTRUM_MULTI` is shared live data. Changing it takes effect immediately for every client, production included, with no deploy. Snapshot before mutating — `scripts/crawler/repair_citation_urls.mjs` writes a baseline before it touches any record, for exactly this reason.

**Client-side caveat:** an already-rendered turn keeps the sources it was answered from — a corpus change is invisible in it. The widget holds turns in memory only (no `sessionStorage`/`localStorage` persistence in `chat-central`), so a page reload is enough to pick up corrected records.

---

## Order of operations

When a change spans layers, deploy **backend before client**. The 2026-07-28 incident was exactly this inverted: the client shipped first and spent two hours asking the judge for a field it could not produce.

Batch changes into one deploy per surface rather than shipping a series of small ones.

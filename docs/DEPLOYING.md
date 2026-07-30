# Deploying ACS

Three deployables. None is automatic. Each needs an explicit go-ahead per deploy.

---

## 1. Web app → `algolia-central-spectrum.vercel.app`

**Production deploys are MANUAL.** `vercel.json` sets:

```json
"git": { "deploymentEnabled": { "main": false } }
```

Why: Vercel's Git integration was auto-deploying **every push to `main`**. On 2026-07-28 three pushes reached production unintentionally — one shipped a chat client expecting a judge field the deployed judge did not yet return, so the live Confidence chip read "Grounding · unavailable" for about two hours. Pushing is not a neutral act unless this setting is in place.

Deploy:

```bash
vercel --prod --yes          # from the repo root; the project is linked via .vercel/
```

Notes:

- `vercel.json` is schema-validated. It **rejects comment keys** — a `"//"` key fails the deploy with `Invalid vercel.json - should NOT have additional property`. Keep prose in this file instead.
- Vercel reads `git.deploymentEnabled` from the pushed commit, so it applies from the first push that contains it. Confirm in **Project Settings → Git** rather than assuming.
- Env vars (`VITE_JUDGE_URL`, `VITE_LAB_API_KEY`) live in the Vercel project, not in the repo. A local `npm run build` without them produces a bundle whose judge calls go to `http://localhost:8788` — which is exactly what made the chip look like it had disappeared on 2026-07-28. For a representative local preview:

```bash
cd web
VITE_JUDGE_URL=https://judge.contentengagement.info/acs VITE_LAB_API_KEY=<key> npm run build
npx vite preview --port 5200
```

**Verify after deploying** (do not trust the deploy's own success message):

```bash
# 1. the served bundle changed
curl -s https://algolia-central-spectrum.vercel.app/ | grep -oE 'index-[A-Za-z0-9_]+\.js'
# 2. it contains what you shipped — probe a string only the new code has
```

Then load the site, ask a question, and read the chip. The bundle hash changing proves a deploy happened; it does not prove the feature works.

---

## 2. Judge backend → `judge.contentengagement.info/acs`

Runs as the `acs-lab-backend` container on the `chowmes` VPS (`72.61.72.147`, user `chowmesadmin`, key `~/.ssh/chowmes_ed25519`).

**The `acs-judge-deploy.timer` is INACTIVE**, so the judge never updates itself. It moved 20 commits behind `main` this way, which is how a client got deployed against a judge that didn't have the fields it expected.

Deploy:

```bash
# 1. tag a rollback image FIRST
ssh -i ~/.ssh/chowmes_ed25519 chowmesadmin@72.61.72.147 \
  "sudo -n docker tag acs-lab-backend:latest acs-lab-backend:rollback-$(date +%Y%m%d)"

# 2. run the deploy script (fast-forwards the checkout, rebuilds, health-checks by SHA)
ssh -i ~/.ssh/chowmes_ed25519 chowmesadmin@72.61.72.147 \
  "cd /home/chowmesadmin/acs-judge && bash deploy/vps-deploy-judge.sh"
```

The script refuses to run against a dirty checkout, only rebuilds when something under `lab/judge/`, `lab/server/`, or `deploy/vps-judge/` changed, and fails loudly if the running container doesn't report the SHA it just built.

**Verify:**

```bash
curl -s https://judge.contentengagement.info/acs/health     # must report the SHA you deployed
```

Then confirm it emits the fields the client needs — a healthy container is not the same as a correct contract:

```bash
ssh -i ~/.ssh/chowmes_ed25519 chowmesadmin@72.61.72.147 \
  'K=$(sudo -n docker exec acs-lab-backend printenv LAB_API_KEY); \
   curl -s -X POST http://127.0.0.1:8788/api/judge -H "Content-Type: application/json" \
     -H "x-lab-key: $K" -d @/tmp/jr.json' | python3 -m json.tool | head -40
```

Expect `grounded`, `unsupportedTerms`, `termsChecked`, `groundingMode` on each panel. The public endpoint requires the `x-lab-key` header; without it you get `{"error":"unauthorized"}`.

Rollback:

```bash
ssh -i ~/.ssh/chowmes_ed25519 chowmesadmin@72.61.72.147 \
  "sudo -n docker tag acs-lab-backend:rollback-YYYYMMDD acs-lab-backend:latest && \
   cd /home/chowmesadmin/acs-judge && sudo -n docker compose -f deploy/vps-judge/docker-compose.yml up -d"
```

---

## 3. Merged widget demo site (`dist-widget/`)

The vendored Algolia widget assembled with our enhancement layer. Built, never committed — `web-widget/dist/` and `dist-widget*/` are gitignored precisely because the bundle **bakes in `VITE_JUDGE_URL` and `VITE_LAB_API_KEY` at build time**.

```bash
# 1. vendored bundles (their build; run after any re-vendor)
cd vendor/algolia-central-chat-widget/chat-central && npm run build
cd ../algolia-chat && npm run build

# 2. our enhancement layer — the judge config is baked in HERE
cd ../../../web-widget
VITE_JUDGE_URL=https://judge.contentengagement.info/acs VITE_LAB_API_KEY=<key> npm run build

# 3. assemble (copies their site, adds the bundles their build forgets, injects our script)
cd .. && node scripts/widget/build_demo_site.mjs --out dist-widget
```

**Verify before shipping** — the failure mode here is silent, and it has already happened once:

```bash
grep -c "judge.contentengagement" dist-widget/acs-enhance.js   # must be >= 1, not localhost
```

Then load the site and check in the browser console that the confidence panel actually took our config:

```js
const p = document.querySelector('algolia-chat-confidence');
({ mode: p.getAttribute('mode'), url: p.getAttribute('url') })   // expect hosted + our judge URL
```

That check is not paranoia. `<algolia-chat-confidence>` captures mode/url/api-key in `connectedCallback` and implements **no `attributeChangedCallback`**, so anything written after the element upgrades is silently ignored — the attribute reads correctly in DevTools while the widget runs its own in-browser judge. Confirm with the network tab: our judge means one call to `judge.contentengagement.info`, theirs means three calls to `algolia.net/agent-studio`.

---

## 4. Corpus / index — not a deploy

`ACS_SPECTRUM_MULTI` is shared live data. Changing it takes effect immediately for every client, prod included, with no deploy. Snapshot before mutating (`scripts/crawler/repair_citation_urls.mjs` writes a baseline snapshot before it touches any record, for exactly this reason).

**Client-side caveat:** `react-instantsearch`'s `useChat` persists whole answers — including their captured search results — in `sessionStorage`. A corpus change is therefore invisible in any already-rendered turn. Bump `CHAT_CACHE_EPOCH` in `web/src/lib/chatCache.ts` whenever a corpus change makes old turns misleading, or users will keep seeing the pre-fix data and report the fix as broken.

---

## Order of operations

When a change spans layers, deploy **backend before client**. The 2026-07-28 incident was exactly this inverted: the client shipped first and spent two hours asking a judge for a field it couldn't produce.

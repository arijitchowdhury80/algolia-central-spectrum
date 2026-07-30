#!/usr/bin/env bash
# vps-deploy-judge.sh — VPS-side poller that keeps acs-lab-backend in sync
# with `main`. Run on a timer (see deploy/systemd/) rather than a GitHub
# Actions + SSH push, because:
#   - algolia-central-spectrum is a PUBLIC repo (confirmed: unauthenticated
#     `curl https://api.github.com/repos/arijitchowdhury80/algolia-central-spectrum`
#     -> 200), so a plain `git fetch` needs zero credentials, zero GitHub
#     secrets, zero deploy keys — nothing to provision or leak.
#   - this build environment cannot add GitHub Actions secrets or push this
#     run anyway, so a push-triggered workflow can't be end-to-end verified
#     today regardless; the poller can be dry-run tested right now.
#   - failure is visible for free via `systemctl status`/`journalctl`,
#     without standing up a separate CI runner or webhook receiver.
#
# Deliberately does NOT touch AC2's ac2-lab-backend container, its
# Dockerfile, or its checkout at /home/deployuser/lab-judge. This script
# only ever operates on a NEW, separate clone (ACS_JUDGE_REPO_DIR below) and
# the NEW acs-lab-backend container defined in deploy/vps-judge/.
#
# Idempotent + safe to run every N minutes: no-ops when origin/main hasn't
# moved past HEAD, and when it has but the move doesn't touch judge-relevant
# paths (path filter below) it fast-forwards the checkout without rebuilding.
set -euo pipefail

# --- config (override via env for local dry-run / testing) -----------------
REPO_DIR="${ACS_JUDGE_REPO_DIR:-/home/deployuser/acs-judge}"
COMPOSE_FILE="deploy/vps-judge/docker-compose.yml"
HEALTH_URL="${ACS_JUDGE_HEALTH_URL:-http://127.0.0.1:8788/health}"
BRANCH="main"
LOG_TAG="[acs-judge-deploy]"

log() { printf '%s %s\n' "$LOG_TAG" "$*"; }
fail() { log "FAIL: $*"; exit 1; }

cd "$REPO_DIR" || fail "repo dir not found: $REPO_DIR (one-time clone required — see deploy-design.md 'activation steps')"

# Refuse to run against a hand-edited checkout. This is the exact failure
# mode that caused the original version-skew confusion (a container running
# code that diverged from any git history) — never repeat it here.
if [[ -n "$(git status --porcelain)" ]]; then
  fail "working tree is dirty — someone hand-edited the deployed checkout. Refusing to auto-deploy over untracked changes. Investigate manually: git -C '$REPO_DIR' status"
fi

OLD_SHA="$(git rev-parse HEAD)"

git fetch origin "$BRANCH" --quiet
NEW_SHA="$(git rev-parse "origin/$BRANCH")"

if [[ "$OLD_SHA" == "$NEW_SHA" ]]; then
  log "up to date at $OLD_SHA — nothing to do"
  exit 0
fi

# Path filter: only rebuild the container when something judge-relevant
# actually changed. (Still fast-forwards the checkout either way, so it
# never drifts more than one poll interval behind main.)
CHANGED_PATHS="$(git diff --name-only "$OLD_SHA" "$NEW_SHA")"
RELEVANT=false
if grep -qE '^(lab/judge/|lab/server/|deploy/vps-judge/)' <<<"$CHANGED_PATHS"; then
  RELEVANT=true
fi

git merge --ff-only "origin/$BRANCH" --quiet \
  || fail "fast-forward from $OLD_SHA to $NEW_SHA failed — local branch has diverged from origin/$BRANCH. Investigate manually, do not force."

log "fast-forwarded $OLD_SHA -> $NEW_SHA"

if [[ "$RELEVANT" == false ]]; then
  log "no changes under lab/judge/, lab/server/, or deploy/vps-judge/ — checkout updated, container left running"
  exit 0
fi

log "judge-relevant changes detected, rebuilding acs-lab-backend"
BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# NOTE: deployuser runs docker via passwordless `sudo` on this VPS (not in
# the docker group), so the poller uses `sudo docker`. The SHA/timestamp are
# passed explicitly as --build-arg (no reliance on sudo env-passthrough); `up`
# reuses the freshly built image. (Verified 2026-07-27.)
sudo -n docker compose -f "$COMPOSE_FILE" build \
  --build-arg GIT_SHA="$NEW_SHA" \
  --build-arg BUILT_AT="$BUILT_AT"

sudo -n docker compose -f "$COMPOSE_FILE" up -d

# Post-deploy health check: confirm the running container reports the SHA
# we just built, not a stale image that failed to swap. Retries because the
# container needs a moment to bind its port after `up -d` returns.
ATTEMPTS=10
for i in $(seq 1 "$ATTEMPTS"); do
  RESPONSE="$(curl -fsS "$HEALTH_URL" 2>/dev/null || true)"
  if [[ -n "$RESPONSE" ]]; then
    REPORTED_SHA="$(printf '%s' "$RESPONSE" | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{try{console.log(JSON.parse(d).sha||"")}catch{console.log("")}})' 2>/dev/null || true)"
    if [[ "$REPORTED_SHA" == "$NEW_SHA" ]]; then
      log "deployed OK — $HEALTH_URL reports sha=$NEW_SHA"
      exit 0
    fi
  fi
  sleep 2
done

fail "post-deploy health check never reported sha=$NEW_SHA at $HEALTH_URL (last response: ${RESPONSE:-<none>}) — deploy may have failed. Container was NOT rolled back automatically; see deploy-design.md 'rollback'."

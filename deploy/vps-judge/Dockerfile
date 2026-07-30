# Backend container for ACS's own judge (@lab/server-acs, ported from AC2's
# lab/server judge slice). Serves ONLY:
#   POST /api/judge  (3-judge panel, corroboration-gated grounding)
#   GET  /health     (returns {ok, sha, builtAt} — see lab/server/src/buildInfo.ts)
#
# Deliberately separate from AC2's Dockerfile/ac2-lab-backend container: this
# builds a DIFFERENT repo (algolia-central-spectrum, not algolia-contentsearch)
# and must never collide with or replace AC2's live service.
FROM node:22-slim
WORKDIR /app

# file: workspace dep — @lab/server-acs depends on @lab/judge via
# "file:../judge" (see lab/server/package.json). Must exist before npm install.
COPY lab/judge ./lab/judge

COPY lab/server/package*.json ./lab/server/
WORKDIR /app/lab/server
RUN npm install --no-audit --no-fund

COPY lab/server/ ./

# Baked in at build time so a running container can always report exactly
# what commit it was built from (buildInfo.ts / GET /health) — this is the
# mechanism that makes deployment skew a one-curl check instead of a
# docker-exec archaeology session.
ARG GIT_SHA=unknown
ARG BUILT_AT=unknown
ENV GIT_SHA=${GIT_SHA}
ENV BUILT_AT=${BUILT_AT}

ENV NODE_ENV=production
ENV PORT=8788
EXPOSE 8788

# Secrets (LAB_API_KEY, GOOGLE_API_KEY/OPENAI_API_KEY) are injected at
# runtime via env_file — never built into the image.

# Drop root: run as the non-root `node` user baked into node:22-slim (uid 1000).
# `tsx` is a local dep in node_modules/.bin, so `npx tsx` needs no network/cache
# write at runtime. chown /app so any runtime writes (if the service ever adds
# them) succeed as `node`. This is the real isolation lever for a containerized
# app — a compromised judge process is unprivileged inside the container.
RUN chown -R node:node /app
USER node

CMD ["npx", "tsx", "src/judge/judgeService.ts"]

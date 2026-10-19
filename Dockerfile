# syntax=docker/dockerfile:1
# Official Node 22 Debian image, pinned to its observed multi-platform digest.
FROM node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN mkdir -p public && npm run build && npm prune --omit=dev --no-audit --no-fund && rm -rf .next/cache

FROM node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS runtime
WORKDIR /app
ARG BOARDROOM_BUILD_REVISION
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=10000 BOARDROOM_BUILD_REVISION=$BOARDROOM_BUILD_REVISION
RUN node -e 'if(!/^[a-f0-9]{40}$/.test(process.env.BOARDROOM_BUILD_REVISION||""))process.exit(1)'
LABEL org.opencontainers.image.source="https://github.com/neophilism/Boardroom" \
      org.opencontainers.image.revision=$BOARDROOM_BUILD_REVISION
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json /app/next.config.mjs ./
COPY --from=build --chown=node:node /app/db ./db
COPY --from=build --chown=node:node /app/registry ./registry
COPY --from=build --chown=node:node /app/src ./src
COPY --from=build --chown=node:node /app/docs ./docs
COPY --from=build --chown=node:node /app/scripts/start-server.mjs ./scripts/start-server.mjs
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 10000
# Startup migrations use existing runtime secrets, not Render pre-deploy minutes.
CMD ["sh","-c","exec node scripts/start-server.mjs -H 0.0.0.0 -p \"${PORT:-10000}\""]

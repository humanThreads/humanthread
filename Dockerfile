ARG NODE_BASE_IMAGE=node:24-bookworm-slim

FROM ${NODE_BASE_IMAGE} AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV NEXT_TELEMETRY_DISABLED="1"

ARG NPM_REGISTRY=https://registry.npmjs.org/
ARG APT_MIRROR=http://deb.debian.org/debian
ARG APT_SECURITY_MIRROR=http://deb.debian.org/debian-security
ENV NPM_CONFIG_REGISTRY=$NPM_REGISTRY
ENV COREPACK_NPM_REGISTRY=$NPM_REGISTRY

WORKDIR /app

RUN sed -i \
    -e "s|https\?://deb.debian.org/debian-security|${APT_SECURITY_MIRROR}|g" \
    -e "s|https\?://security.debian.org/debian-security|${APT_SECURITY_MIRROR}|g" \
    -e "s|https\?://deb.debian.org/debian|${APT_MIRROR}|g" \
    /etc/apt/sources.list /etc/apt/sources.list.d/*.sources 2>/dev/null || true \
  && apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git openssl \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable \
  && for attempt in 1 2 3; do \
       corepack prepare pnpm@10.33.2 --activate && break; \
       if [ "$attempt" -eq 3 ]; then exit 1; fi; \
       sleep "$((attempt * 2))"; \
     done

FROM base AS deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml prisma.config.ts tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/local-agent/package.json apps/local-agent/package.json
COPY apps/orchestration-worker/package.json apps/orchestration-worker/package.json
COPY apps/live-relay/package.json apps/live-relay/package.json
COPY packages/cli-wrapper/package.json packages/cli-wrapper/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/workbench-client/package.json packages/workbench-client/package.json
COPY packages/workflow-core/package.json packages/workflow-core/package.json
COPY packages/orchestration-core/package.json packages/orchestration-core/package.json
COPY prisma/schema.prisma prisma/schema.prisma

RUN pnpm install --frozen-lockfile --registry="$NPM_REGISTRY"

FROM deps AS builder

COPY . .

ARG DATABASE_URL="mysql://placeholder:placeholder@localhost:3306/humanthread"
ENV DATABASE_URL="$DATABASE_URL"
ARG NEXT_PUBLIC_HUMANTHREAD_DEVELOPMENT_MODES="true"
ENV NEXT_PUBLIC_HUMANTHREAD_DEVELOPMENT_MODES="$NEXT_PUBLIC_HUMANTHREAD_DEVELOPMENT_MODES"
ARG NEXT_PUBLIC_HUMANTHREAD_BUILD_REVISION=""
ENV NEXT_PUBLIC_HUMANTHREAD_BUILD_REVISION="$NEXT_PUBLIC_HUMANTHREAD_BUILD_REVISION"

RUN pnpm db:generate
RUN pnpm --filter @humanthread/shared build
RUN pnpm --filter @humanthread/workflow-core build
RUN pnpm --filter @humanthread/orchestration-core build
RUN pnpm --filter @humanthread/db build
RUN pnpm --filter @humanthread/orchestration-worker build
RUN pnpm --filter @humanthread/live-relay build
RUN pnpm --filter @humanthread/web build

FROM base AS runner

ENV NODE_ENV="production"
ENV HOSTNAME="0.0.0.0"
ENV PORT="3000"

WORKDIR /app

RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=builder --chown=nextjs:nodejs /app/apps/orchestration-worker/node_modules ./apps/orchestration-worker/node_modules
COPY --from=builder --chown=nextjs:nodejs /app/apps/orchestration-worker/package.json ./apps/orchestration-worker/package.json
COPY --from=builder --chown=nextjs:nodejs /app/apps/live-relay/node_modules ./apps/live-relay/node_modules
COPY --from=builder --chown=nextjs:nodejs /app/apps/live-relay/package.json ./apps/live-relay/package.json
COPY --from=builder --chown=nextjs:nodejs /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=builder --chown=nextjs:nodejs /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=builder --chown=nextjs:nodejs /app/packages/workflow-core/node_modules ./packages/workflow-core/node_modules
COPY --from=builder --chown=nextjs:nodejs /app/apps/orchestration-worker/dist ./apps/orchestration-worker/dist
COPY --from=builder --chown=nextjs:nodejs /app/apps/live-relay/dist ./apps/live-relay/dist
COPY --from=builder --chown=nextjs:nodejs /app/packages ./packages
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public
COPY --from=builder --chown=nextjs:nodejs /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml /app/prisma.config.ts ./
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/deploy ./deploy
# AGPL-3.0 section 13: ship the license and copyright notice with the served
# application so users interacting over the network can obtain them.
COPY --from=builder --chown=nextjs:nodejs /app/LICENSE ./LICENSE

USER nextjs

EXPOSE 3000

CMD ["node", "apps/web/server.js"]

FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY scripts ./scripts
COPY packages ./packages
COPY apps/knowledge-indexer ./apps/knowledge-indexer
COPY apps/orchestration-worker/package.json ./apps/orchestration-worker/package.json
COPY prisma ./prisma
RUN corepack pnpm install --frozen-lockfile --filter @humanthread/knowledge-indexer-service...
RUN corepack pnpm db:generate \
  && corepack pnpm --filter @humanthread/shared build \
  && corepack pnpm --filter @humanthread/orchestration-core build \
  && corepack pnpm --filter @humanthread/workflow-core build \
  && corepack pnpm --filter @humanthread/db build \
  && corepack pnpm --filter @humanthread/knowledge-indexer build \
  && corepack pnpm --filter @humanthread/knowledge-indexer-service build

# Keep the runtime image CPU-only. The default onnxruntime-node package may
# install CUDA/TensorRT provider libraries; they are unusable on the current
# no-GPU production host and must not be shipped in the image.
RUN find node_modules/.pnpm/onnxruntime-node@1.30.0 -type f \
  \( -name 'libonnxruntime_providers_cuda.so' -o -name 'libonnxruntime_providers_tensorrt.so' \) -delete || true

ENV NODE_ENV=production
EXPOSE 3100
CMD ["node", "apps/knowledge-indexer/dist/main.js"]

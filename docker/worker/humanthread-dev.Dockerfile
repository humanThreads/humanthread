# HumanThread project development Worker image.
# The repository is fetched into an isolated task worktree at runtime.
ARG STANDARD_IMAGE=ghcr.io/humanthreads/humanthread-linux-worker:20260825104157-fcb632d1
ARG NPM_REGISTRY=https://registry.npmjs.org/

FROM ${STANDARD_IMAGE}

USER root

ARG NPM_REGISTRY=https://registry.npmjs.org/
ARG APT_MIRROR=http://deb.debian.org/debian
ARG APT_SECURITY_MIRROR=http://deb.debian.org/debian-security
ENV NPM_CONFIG_REGISTRY=${NPM_REGISTRY} \
    COREPACK_NPM_REGISTRY=${NPM_REGISTRY}

# pnpm is needed by the HumanThread monorepo; native build tools are required
# by Prisma, sharp, and other packages when dependencies are installed in a
# runtime worktree.
RUN sed -i \
    -e "s|https\?://deb.debian.org/debian-security|${APT_SECURITY_MIRROR}|g" \
    -e "s|https\?://security.debian.org/debian-security|${APT_SECURITY_MIRROR}|g" \
    -e "s|https\?://deb.debian.org/debian|${APT_MIRROR}|g" \
    /etc/apt/sources.list /etc/apt/sources.list.d/*.sources 2>/dev/null || true \
  && apt-get update \
  && apt-get install -y --no-install-recommends \
    build-essential \
    libssl-dev \
    openssl \
    pkg-config \
    python3 \
  && rm -rf /var/lib/apt/lists/* \
  && npm install --global pnpm@10.33.2 --registry="${NPM_REGISTRY}" \
  && pnpm --version

ENV HT_WORKER_IMAGE_KIND=humanthread-dev

LABEL org.humanthread.worker.kind="project-derived" \
      org.humanthread.worker.project="humanThread" \
      org.humanthread.worker.base="humanthread-linux-worker"

USER humanthread

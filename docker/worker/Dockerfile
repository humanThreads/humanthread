ARG NODE_BASE_IMAGE=node:24-bookworm-slim

FROM ${NODE_BASE_IMAGE} AS build

ARG NPM_REGISTRY=https://registry.npmjs.org/
ARG APT_MIRROR=http://deb.debian.org/debian
ARG APT_SECURITY_MIRROR=http://deb.debian.org/debian-security
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NPM_CONFIG_REGISTRY=$NPM_REGISTRY COREPACK_NPM_REGISTRY=$NPM_REGISTRY
WORKDIR /workspace

RUN sed -i \
    -e "s|https\?://deb.debian.org/debian-security|${APT_SECURITY_MIRROR}|g" \
    -e "s|https\?://security.debian.org/debian-security|${APT_SECURITY_MIRROR}|g" \
    -e "s|https\?://deb.debian.org/debian|${APT_MIRROR}|g" \
    /etc/apt/sources.list /etc/apt/sources.list.d/*.sources 2>/dev/null || true \
  && apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git git-lfs openssh-client \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable

COPY . .
RUN pnpm install --frozen-lockfile --registry="$NPM_REGISTRY" \
  && pnpm --filter @humanthread/cli-wrapper build

FROM ${NODE_BASE_IMAGE} AS runtime

ARG CODEX_VERSION=0.160.0
ARG NPM_REGISTRY=https://registry.npmjs.org/
ARG APT_MIRROR=http://deb.debian.org/debian
ARG APT_SECURITY_MIRROR=http://deb.debian.org/debian-security
RUN sed -i \
    -e "s|https\?://deb.debian.org/debian-security|${APT_SECURITY_MIRROR}|g" \
    -e "s|https\?://security.debian.org/debian-security|${APT_SECURITY_MIRROR}|g" \
    -e "s|https\?://deb.debian.org/debian|${APT_MIRROR}|g" \
    /etc/apt/sources.list /etc/apt/sources.list.d/*.sources 2>/dev/null || true \
  && apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates dumb-init git git-lfs openssh-client \
  && rm -rf /var/lib/apt/lists/* \
  # npm treats optional-dependency install failures as non-fatal. Codex resolves
  # its native executable from @openai/codex-linux-x64, so a partially resolved
  # install would ship a CLI that always throws "Missing optional dependency".
  # The registry must be pinned here: the runtime stage has no npm registry
  # configuration, and falling back to the public registry both hangs the build
  # and silently drops the optional native binary.
  # Install it explicitly and fail the build if the platform binary is absent.
  && npm install --global --registry="${NPM_REGISTRY}" @openai/codex@${CODEX_VERSION} \
    "@openai/codex-linux-x64@npm:@openai/codex@${CODEX_VERSION}-linux-x64" \
  # A cached layer or a drifting tag can leave a different executable behind,
  # so compare the reported version exactly instead of only checking that the
  # CLI runs. Mismatch must fail the image build.
  && codex --version | grep -Fx "codex-cli ${CODEX_VERSION}"

RUN groupadd --system --gid 10001 humanthread \
  && useradd --system --uid 10001 --gid humanthread --create-home humanthread \
  && install -d -o humanthread -g humanthread -m 0700 /var/lib/humanthread

WORKDIR /opt/humanthread
COPY --from=build --chown=humanthread:humanthread /workspace/node_modules ./node_modules
COPY --from=build --chown=humanthread:humanthread /workspace/packages ./packages
COPY --chown=humanthread:humanthread docker/worker/entrypoint.mjs ./worker-entrypoint.mjs
COPY --chown=humanthread:humanthread docker/worker/entrypoint.sh ./entrypoint.sh
RUN chmod 0755 /opt/humanthread/entrypoint.sh /opt/humanthread/packages/cli-wrapper/dist/ht-cli.js \
  && ln -s /opt/humanthread/packages/cli-wrapper/dist/ht-cli.js /usr/local/bin/ht

ENV HT_WORKER_STATE_DIR=/var/lib/humanthread HOME=/home/humanthread
USER humanthread
ENTRYPOINT ["/usr/bin/dumb-init", "--", "/opt/humanthread/entrypoint.sh"]

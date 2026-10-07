import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { renderWorkerName, runtimeWorkerEnvironment, validateRuntimeEnvironment } from "./entrypoint.mjs";

test("validates the bootstrap token without inspecting model credentials", () => {
  assert.deepEqual(validateRuntimeEnvironment({ HT_WORKER_POOL_TOKEN: "token", HT_PLATFORM_URL: "http://localhost:3000", HT_WORKER_POOL_NAME: "disaster-gpu" }), []);
  assert.deepEqual(validateRuntimeEnvironment({}), ["HT_WORKER_POOL_TOKEN is required", "HT_WORKER_POOL_NAME is required"]);
});

test("requires the pool display name so the token and deployment label cannot drift", () => {
  assert.deepEqual(validateRuntimeEnvironment({ HT_WORKER_POOL_TOKEN: "token", HT_PLATFORM_URL: "http://localhost:3000" }), ["HT_WORKER_POOL_NAME is required"]);
});

test("uses the optional pool name as the visible Worker identity", () => {
  assert.equal(renderWorkerName({ HT_WORKER_POOL_NAME: "disaster-gpu" }), "disaster-gpu");
  assert.equal(renderWorkerName({}), "linux-worker");
});

test("does not reuse the Pool display name as a shared Worker session identity", () => {
  assert.equal(runtimeWorkerEnvironment({ HT_WORKER_POOL_NAME: "disaster-gpu" }).HT_WORKER_INSTANCE_ID, undefined);
  assert.equal(runtimeWorkerEnvironment({ HT_WORKER_INSTANCE_ID: "worker-replica-1" }).HT_WORKER_INSTANCE_ID, "worker-replica-1");
});

test("marks runtime entrypoints executable in the Docker image", () => {
  const dockerfile = readFileSync(new URL("./Dockerfile", import.meta.url), "utf8");
  assert.match(dockerfile, /chmod 0755 [^\n]*entrypoint\.sh [^\n]*ht-cli\.js/u);
});

test("pins the Codex app-server version validated by the Worker protocol contract", () => {
  const dockerfile = readFileSync(new URL("./Dockerfile", import.meta.url), "utf8");
  assert.match(dockerfile, /ARG CODEX_VERSION=0\.160\.0/u);
  assert.match(dockerfile, /npm install --global --registry="\$\{NPM_REGISTRY\}" @openai\/codex@\$\{CODEX_VERSION\}/u);
  assert.match(dockerfile, /"@openai\/codex-linux-x64@npm:@openai\/codex@\$\{CODEX_VERSION\}-linux-x64"/u);
  // Installing the package is not enough: a cached or partially resolved layer
  // must fail the build when the executable does not report the pinned version.
  assert.match(
    dockerfile,
    /codex --version\s*\|\s*grep\s+-Fx\s+"codex-cli \$\{CODEX_VERSION\}"/u,
    "the Worker image must compare the installed Codex version exactly",
  );
});

test("uses the default Node base image", () => {
  const dockerfile = readFileSync(new URL("./Dockerfile", import.meta.url), "utf8");
  assert.match(dockerfile, /ARG NODE_BASE_IMAGE=node:24-bookworm-slim/u);
  assert.match(dockerfile, /FROM \$\{NODE_BASE_IMAGE\} AS build/u);
  assert.match(dockerfile, /FROM \$\{NODE_BASE_IMAGE\} AS runtime/u);
});

test("normalizes the verified UnityCI editor path and fails an empty disaster runtime", () => {
  const dockerfile = readFileSync(new URL("./disaster.Dockerfile", import.meta.url), "utf8");
  assert.match(dockerfile, /libgdk-pixbuf-2\.0-0 libglib2\.0-0 [^\n]*libgtk-3-0 [^\n]*libxcursor1/u);
  assert.match(dockerfile, /COPY --from=unity \/opt\/unity \/opt\/Unity/u);
  assert.match(dockerfile, /RUN test -x \/opt\/Unity\/Editor\/Unity/u);
  assert.match(dockerfile, /ENV UNITY_HOME=\/opt\/Unity PATH=\/opt\/Unity\/Editor:\$PATH/u);
});

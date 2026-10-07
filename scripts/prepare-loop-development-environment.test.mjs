import assert from "node:assert/strict";
import test from "node:test";

import {
  prepareLoopDevelopmentEnvironment,
  resolveCorepackCommand,
} from "./prepare-loop-development-environment.mjs";

test("resolves the Corepack launcher for POSIX and Windows", () => {
  assert.deepEqual(resolveCorepackCommand(["pnpm", "--version"], "darwin"), {
    executable: "corepack",
    args: ["pnpm", "--version"],
  });
  assert.deepEqual(resolveCorepackCommand(["pnpm", "--version"], "linux"), {
    executable: "corepack",
    args: ["pnpm", "--version"],
  });
  assert.deepEqual(resolveCorepackCommand(["pnpm", "--version"], "win32"), {
    executable: "cmd.exe",
    args: ["/d", "/s", "/c", "corepack", "pnpm", "--version"],
  });
});

test("prepares generated types and workspace packages in dependency order", () => {
  const calls = [];

  prepareLoopDevelopmentEnvironment({
    run(executable, args, options) {
      calls.push({ executable, args, databaseUrl: options.env.DATABASE_URL });
      return { status: 0 };
    },
  });

  assert.deepEqual(calls.map(({ args }) => args), [
    ["pnpm", "db:generate"],
    [
      "pnpm",
      "--filter", "@humanthread/shared",
      "--filter", "@humanthread/workflow-core",
      "--filter", "@humanthread/orchestration-core",
      "--filter", "@humanthread/db",
      "--workspace-concurrency=1",
      "--sort",
      "build",
    ],
  ]);
  assert.deepEqual(calls.map(({ executable }) => executable), ["corepack", "corepack"]);
  assert.match(calls[0].databaseUrl, /^mysql:\/\//u);
});

test("stops when an environment preparation command fails", () => {
  let calls = 0;

  assert.throws(() => prepareLoopDevelopmentEnvironment({
    run() {
      calls += 1;
      return { status: 2 };
    },
  }), /environment preparation failed/iu);
  assert.equal(calls, 1);
});

#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { once } from "node:events";

import { runHtDoctor } from "./commands/doctor";
import { runHtInit } from "./commands/init";
import { runHtMigrate } from "./commands/migrate";
import { runHtRepair } from "./commands/repair";
import { parseHtArgs } from "./ht-args";
import { createNodeProjectFilesystem, resolveGitRoot } from "./node-project-filesystem";
import { createProjectLoopApi } from "./project-loop-api";
import { createWorkerService } from "./worker/worker-service";
import { createCliInstallation, loadCliSession, saveCliSession } from "./cli-session";
import { loginCliSession, refreshCliSession } from "./cli-session-api";

const usage = [
  "Usage:",
  "  ht login --email <email> [--password-stdin] [--json]",
  "  ht init [--project <projectId>] [--json]",
  "  ht doctor [--json]",
  "  ht repair --stage <loop-id>/<subloop-id> [--json]",
  "  ht migrate --stage <loop-id>/<subloop-id> [--json]",
  "  ht worker run --platform-url <url> --pool-token-env <ENV_NAME> --state-dir <absolute-path> [--json]",
].join("\n");

async function readPasswordFromStdin(): Promise<string> {
  let value = "";
  process.stdin.setEncoding("utf8");
  process.stdin.resume();
  process.stdin.on("data", (chunk: string) => { value += chunk; });
  await once(process.stdin, "end");
  const password = value.replace(/[\r\n]+$/u, "");
  if (!password) throw Object.assign(new Error("ht login received an empty password"), { code: "invalid_arguments" });
  return password;
}

async function readPasswordInteractively(): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw Object.assign(new Error("ht login requires --password-stdin when stdin is not a terminal"), { code: "invalid_arguments" });
  }
  let password = "";
  const stdin = process.stdin;
  stdin.setRawMode(true);
  stdin.resume();
  process.stdout.write("Password: ");
  await new Promise<void>((resolve, reject) => {
    const onData = (buffer: Buffer) => {
      const character = buffer.toString("utf8");
      if (character === "\r" || character === "\n") { stdin.off("data", onData); resolve(); return; }
      if (character === "\u0003") { stdin.off("data", onData); reject(Object.assign(new Error("Login cancelled"), { code: "cancelled" })); return; }
      if (character === "\u007f" || character === "\b") { password = password.slice(0, -1); return; }
      password += character;
    };
    stdin.on("data", onData);
  }).finally(() => {
    stdin.setRawMode(false);
    stdin.pause();
    process.stdout.write("\n");
  });
  if (!password) throw Object.assign(new Error("ht login received an empty password"), { code: "invalid_arguments" });
  return password;
}

async function runWorkerCommand(args: Extract<ReturnType<typeof parseHtArgs>, { command: "worker_run" }>): Promise<void> {
  const poolToken = process.env[args.poolTokenEnv]?.trim() ?? "";
  if (!poolToken) throw Object.assign(new Error(`${args.poolTokenEnv} is required for ht worker run`), { code: "authentication_required" });
  const service = createWorkerService({
    platformUrl: args.platformUrl,
    poolToken,
    stateDirectory: args.stateDir,
  });
  await new Promise<void>((resolve, reject) => {
    let stopping = false;
    const shutdown = () => {
      if (stopping) return;
      stopping = true;
      void service.stop().then(resolve, reject);
    };
    process.once("SIGTERM", shutdown);
    process.once("SIGINT", shutdown);
    void service.start().catch(reject);
  });
}

async function main() {
  const args = parseHtArgs(process.argv.slice(2));
  if (args.command === "help") { console.log(usage); return 0; }
  if (args.command === "version") {
    const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    console.log(manifest.version);
    return 0;
  }
  if (args.command === "worker_run") {
    await runWorkerCommand(args);
    return 0;
  }
  if (args.command === "login") {
    const existing = await loadCliSession().catch(() => null);
    const installation = existing ?? { baseUrl: process.env.HT_API_BASE_URL?.trim() || "http://localhost:3000", ...createCliInstallation() };
    const session = await loginCliSession({
      baseUrl: process.env.HT_API_BASE_URL?.trim() || installation.baseUrl,
      email: args.email,
      password: args.passwordStdin ? await readPasswordFromStdin() : await readPasswordInteractively(),
      installationId: installation.installationId,
      deviceId: installation.deviceId,
    });
    await saveCliSession(session);
    if (args.json) console.log(JSON.stringify({ ok: true, baseUrl: session.baseUrl }));
    else console.log("HumanThread CLI login completed");
    return 0;
  }
  const root = await resolveGitRoot(process.cwd());
  const fs = createNodeProjectFilesystem(root);
  let result: unknown;
  if (args.command === "init") {
    const session = await refreshCliSession(await loadCliSession());
    await saveCliSession(session);
    const api = createProjectLoopApi({
      baseUrl: session.baseUrl,
      accessToken: session.accessToken,
    });
    result = await runHtInit({ cwd: root, ...(args.projectId ? { projectId: args.projectId } : {}) }, { fs, readCatalog: api.readCatalog });
  } else if (args.command === "doctor") result = await runHtDoctor({ cwd: root }, { fs });
  else if (args.command === "repair") result = await runHtRepair({ cwd: root, stageId: args.stageId }, { fs });
  else if (args.command === "migrate") result = await runHtMigrate({ cwd: root, stageId: args.stageId }, { fs });
  else throw Object.assign(new Error("Unsupported ht command"), { code: "invalid_arguments" });
  if (args.json) console.log(JSON.stringify(result));
  else if (args.command === "doctor" && typeof result === "object" && result && Reflect.get(result, "ready") === false) {
    console.log("Local Loop configuration is not ready");
  } else {
    console.log("HumanThread local Loop operation completed");
    if (args.command === "init" && typeof result === "object" && result) {
      const guide = Reflect.get(result, "configurationGuide");
      if (typeof guide === "string") console.log(`Configuration guide: ${guide}`);
    }
  }
  return args.command === "doctor" && typeof result === "object" && result && Reflect.get(result, "ready") === false ? 2 : 0;
}

main().then((code) => { process.exitCode = code; }).catch((error) => {
  const code = error && typeof error === "object" ? String(Reflect.get(error, "code") ?? "ht_failed") : "ht_failed";
  const message = error instanceof Error ? error.message : "HumanThread local Loop operation failed";
  console.error(`${code}: ${message}`);
  process.exitCode = 1;
});

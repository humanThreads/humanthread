import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { assertReleaseSource } from "../../../scripts/releases/release-source.mjs";

export interface ElectronBuildInvocation {
  command: string;
  args: string[];
}

export function parseElectronBuildArgs(args: string[]): string[] {
  const options = args[0] === "--" ? args.slice(1) : args;
  return options;
}

export function buildElectronBuilderInvocation(args: string[]): ElectronBuildInvocation {
  return {
    command: "pnpm",
    args: ["exec", "electron-builder", ...parseElectronBuildArgs(args)],
  };
}

export function runElectronBuild(argv: string[] = process.argv.slice(2)): void {
  assertReleaseSource();
  const invocation = buildElectronBuilderInvocation(argv);
  const result = spawnSync(invocation.command, invocation.args, {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    throw result.error ?? new Error("electron-builder failed");
  }
}

const currentScriptPath = process.argv[1];

if (
  currentScriptPath &&
  fileURLToPath(import.meta.url) === resolve(currentScriptPath)
) {
  try {
    runElectronBuild();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

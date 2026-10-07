import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { assertDesktopReleaseSource } from "../../../scripts/releases/release-source.mjs";
import type { PackageSpawnResult } from "./package-macos-download";

export interface PackageMacosDmgInput {
  cwd?: string;
}

export interface PackageMacosDmgDependencies {
  existsSync: typeof existsSync;
  spawnSync: (
    command: string,
    args: string[],
    options: {
      cwd: string;
      stdio: "inherit";
    },
  ) => PackageSpawnResult;
}

function assertSpawnSuccess(result: PackageSpawnResult, message: string): void {
  if (result.status !== 0) {
    throw result.error ?? new Error(message);
  }
}

export function buildElectronBuilderDmgArtifactName(version: string): string {
  return `HumanThread-Desktop-${version}-mac-arm64.dmg`;
}

export function packageMacosDmg(
  input: PackageMacosDmgInput = {},
  dependencies: PackageMacosDmgDependencies = { existsSync, spawnSync },
): string {
  const cwd = input.cwd ?? process.cwd();
  const manifest = JSON.parse(readFileSync(resolve(cwd, "package.json"), "utf8")) as {
    version?: unknown;
  };
  if (typeof manifest.version !== "string" || manifest.version.length === 0) {
    throw new Error("Local Agent package version is unavailable");
  }
  if (process.platform !== "darwin") {
    throw new Error("macOS dmg packaging is only available on macOS");
  }
  assertSpawnSuccess(
    dependencies.spawnSync("pnpm", ["build"], {
      cwd,
      stdio: "inherit",
    }),
    "Failed to build the Desktop renderer and Electron entry points.",
  );
  assertSpawnSuccess(
    dependencies.spawnSync(
      "pnpm",
      ["exec", "electron-builder", "--mac", "dmg", "--arm64"],
      { cwd, stdio: "inherit" },
    ),
    "Failed to build the macOS dmg with electron-builder.",
  );
  const dmgPath = resolve(cwd, "dist-installers", buildElectronBuilderDmgArtifactName(manifest.version));
  if (!dependencies.existsSync(dmgPath)) {
    throw new Error(`macOS dmg was not produced: ${dmgPath}`);
  }
  return dmgPath;
}

const currentScriptPath = process.argv[1];

if (
  currentScriptPath &&
  import.meta.url === new URL(currentScriptPath, "file://").href
) {
  assertDesktopReleaseSource();
  const dmgPath = packageMacosDmg();
  console.log(`Packaged ${dmgPath}`);
}

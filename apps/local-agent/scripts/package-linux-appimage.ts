import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { assertDesktopReleaseSource } from "../../../scripts/releases/release-source.mjs";
import type { PackageSpawnResult } from "./package-macos-download.ts";

export interface PackageLinuxAppImageInput {
  cwd?: string;
}

export interface PackageLinuxAppImageDependencies {
  existsSync: typeof existsSync;
  readFileSync: typeof readFileSync;
  spawnSync: (
    command: string,
    args: string[],
    options: { cwd: string; stdio: "inherit" },
  ) => PackageSpawnResult;
  platform: string;
}

function assertSpawnSuccess(result: PackageSpawnResult, message: string): void {
  if (result.status !== 0) {
    throw result.error ?? new Error(message);
  }
}

export function buildLinuxAppImageArtifactName(version: string): string {
  return `HumanThread-Desktop-${version}-linux-x86_64.AppImage`;
}

export function packageLinuxAppImage(
  input: PackageLinuxAppImageInput = {},
  dependencies: PackageLinuxAppImageDependencies = {
    existsSync,
    readFileSync,
    spawnSync,
    platform: process.platform,
  },
): string {
  const cwd = input.cwd ?? process.cwd();
  const manifest = JSON.parse(dependencies.readFileSync(resolve(cwd, "package.json"), "utf8")) as {
    version?: unknown;
  };
  if (typeof manifest.version !== "string" || manifest.version.length === 0) {
    throw new Error("Local Agent package version is unavailable");
  }
  if (dependencies.platform !== "linux") {
    throw new Error("Linux AppImage packaging is only available on Linux (use a Linux builder or container)");
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
      ["exec", "electron-builder", "--linux", "AppImage", "--x64"],
      { cwd, stdio: "inherit" },
    ),
    "Failed to build the Linux AppImage with electron-builder.",
  );
  const appImagePath = resolve(cwd, "dist-installers", buildLinuxAppImageArtifactName(manifest.version));
  if (!dependencies.existsSync(appImagePath)) {
    throw new Error(`Linux AppImage was not produced: ${appImagePath}`);
  }
  return appImagePath;
}

const currentScriptPath = process.argv[1];

if (
  currentScriptPath &&
  fileURLToPath(import.meta.url) === resolve(currentScriptPath)
) {
  assertDesktopReleaseSource();
  const appImagePath = packageLinuxAppImage();
  console.log(`Packaged ${appImagePath}`);
}

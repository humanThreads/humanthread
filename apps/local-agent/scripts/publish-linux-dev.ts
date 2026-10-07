import OSS from "ali-oss";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { assertDesktopReleaseSource } from "../../../scripts/releases/release-source.mjs";
import { packageLinuxAppImage } from "./package-linux-appimage.ts";
import { readOssPublishConfig, type OssPublishConfig } from "./publish-macos-download.ts";

interface UploadClient {
  put(
    objectKey: string,
    filePath: string,
    options: { headers: Record<string, string> },
  ): Promise<unknown>;
}

export interface PublishLinuxDevInput {
  version: string;
  commit: string;
  filePath?: string;
}

export interface PublishLinuxDevDependencies {
  packageLinuxAppImage: (input?: { cwd?: string; file?: string }) => string;
  createClient: (config: OssPublishConfig) => UploadClient;
  statSync: (path: string) => { size: number };
  readFileSync: (path: string) => Buffer;
  existsSync: typeof existsSync;
}

export function buildLinuxDevObjectKey(input: {
  version: string;
  commit: string;
}): string {
  const version = input.version.trim().replace(/[^A-Za-z0-9._-]/gu, "-");
  const commit = input.commit.trim().toLowerCase().slice(0, 12);
  if (!version || !/^[a-f0-9]{12}$/u.test(commit)) {
    throw new Error("Invalid Linux dev release identity");
  }
  return `downloads/desktop/dev/humanthread-desktop-linux-x64-${version}-dev-${commit}.AppImage`;
}

function currentCommit(): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
}

function packageVersion(): string {
  const manifest = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as {
    version?: unknown;
  };
  if (typeof manifest.version !== "string" || !manifest.version.trim()) {
    throw new Error("Desktop package version is unavailable");
  }
  return manifest.version;
}

export async function publishLinuxDev(
  input: PublishLinuxDevInput,
  dependencies: PublishLinuxDevDependencies = {
    packageLinuxAppImage: (options) => packageLinuxAppImage(options ?? {}),
    createClient: (config) => new OSS({ ...config, secure: true }),
    statSync,
    readFileSync,
    existsSync,
  },
): Promise<{ objectKey: string; size: number; sha256: string; version: string; commit: string }> {
  const objectKey = buildLinuxDevObjectKey(input);
  const config = readOssPublishConfig();
  process.env.HUMANTHREAD_BUILD_REVISION = `dev-${input.commit.slice(0, 12)}`;
  const appImagePath = input.filePath
    ? resolve(input.filePath)
    : dependencies.packageLinuxAppImage();
  if (!dependencies.existsSync(appImagePath)) {
    throw new Error(`Linux AppImage was not found: ${appImagePath}`);
  }
  const bytes = dependencies.readFileSync(appImagePath);
  const size = dependencies.statSync(appImagePath).size;
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  await dependencies.createClient(config).put(objectKey, appImagePath, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="humanthread-desktop-linux-x64-${input.version}-dev.AppImage"`,
      "Cache-Control": "no-store",
      "x-oss-meta-channel": "dev",
      "x-oss-meta-app-version": input.version,
      "x-oss-meta-commit": input.commit,
      "x-oss-meta-sha256": sha256,
    },
  });
  return {
    objectKey,
    size,
    sha256,
    version: input.version,
    commit: input.commit,
  };
}

const currentScriptPath = process.argv[1];
if (currentScriptPath && import.meta.url === new URL(currentScriptPath, "file://").href) {
  assertDesktopReleaseSource();
  publishLinuxDev({
    version: packageVersion(),
    commit: currentCommit(),
    ...(process.env.HUMANTHREAD_LINUX_APPIMAGE_PATH?.trim()
      ? { filePath: process.env.HUMANTHREAD_LINUX_APPIMAGE_PATH.trim() }
      : {}),
  })
    .then((result) => {
      console.log(JSON.stringify({
        objectKey: result.objectKey,
        size: result.size,
        sha256: result.sha256,
        version: result.version,
        commit: result.commit,
        channel: "dev",
        officialDownloadReplaced: false,
      }, null, 2));
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : "Failed to publish Linux dev package");
      process.exitCode = 1;
    });
}

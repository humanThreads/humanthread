import OSS from "ali-oss";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { assertDesktopReleaseSource } from "../../../scripts/releases/release-source.mjs";
import {
  MACOS_AGENT_OSS_OBJECT_KEY,
  readOssPublishConfig,
  type OssPublishConfig,
} from "./publish-macos-download.ts";
import { packageMacosDmg } from "./package-macos-dmg.ts";

export const MACOS_AGENT_OFFICIAL_OSS_OBJECT_KEY = MACOS_AGENT_OSS_OBJECT_KEY;

interface UploadClient {
  put(
    objectKey: string,
    filePath: string,
    options: { headers: Record<string, string> },
  ): Promise<unknown>;
}

export interface PublishMacosDevInput {
  version: string;
  commit: string;
}

export interface PublishMacosDevDependencies {
  packageMacosDmg: () => string;
  createClient: (config: OssPublishConfig) => UploadClient;
  statSync: (path: string) => { size: number };
  readFileSync: (path: string) => Buffer;
}

export function buildMacosDevObjectKey(input: {
  version: string;
  commit: string;
}): string {
  const version = input.version.trim().replace(/[^A-Za-z0-9._-]/gu, "-");
  const commit = input.commit.trim().toLowerCase().slice(0, 12);
  if (!version || !/^[a-f0-9]{12}$/u.test(commit)) {
    throw new Error("Invalid macOS dev release identity");
  }
  return `downloads/desktop/dev/humanthread-desktop-macos-arm64-${version}-dev-${commit}.dmg`;
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

export async function publishMacosDev(
  input: PublishMacosDevInput,
  dependencies: PublishMacosDevDependencies = {
    packageMacosDmg: () => packageMacosDmg(),
    createClient: (config) => new OSS({ ...config, secure: true }),
    statSync,
    readFileSync,
  },
): Promise<{ objectKey: string; size: number; sha256: string; version: string; commit: string }> {
  const objectKey = buildMacosDevObjectKey(input);
  if (objectKey === MACOS_AGENT_OFFICIAL_OSS_OBJECT_KEY) {
    throw new Error("Dev publication must not replace the official download object");
  }
  const config = readOssPublishConfig();
  process.env.HUMANTHREAD_BUILD_REVISION = `dev-${input.commit.slice(0, 12)}`;
  const dmgPath = dependencies.packageMacosDmg();
  const bytes = dependencies.readFileSync(dmgPath);
  const size = dependencies.statSync(dmgPath).size;
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  await dependencies.createClient(config).put(objectKey, dmgPath, {
    headers: {
      "Content-Type": "application/x-apple-diskimage",
      "Content-Disposition": `attachment; filename="humanthread-desktop-macos-arm64-${input.version}-dev.dmg"`,
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
  publishMacosDev({
    version: packageVersion(),
    commit: currentCommit(),
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
      console.error(error instanceof Error ? error.message : "Failed to publish macOS dev package");
      process.exitCode = 1;
    });
}

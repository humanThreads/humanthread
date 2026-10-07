import OSS from "ali-oss";
import { createHash } from "node:crypto";
import { readFileSync, statSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { assertDesktopReleaseSource } from "../../../scripts/releases/release-source.mjs";
import {
  packageMacosDownload,
  type PackageMacosDownloadInput,
} from "./package-macos-download.ts";

export const MACOS_AGENT_OSS_OBJECT_KEY =
  "downloads/local-agent/humanthread-local-agent-macos-arm64.zip";

export interface PublishMacosDownloadInput {
  outputDirectory?: string;
}

export interface OssPublishConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  accessKeySecret: string;
}

interface PackageResult {
  zipPath: string;
}

interface UploadClient {
  put(
    objectKey: string,
    filePath: string,
    options: {
      headers: Record<string, string>;
    },
  ): Promise<unknown>;
}

export interface PublishMacosDownloadDependencies {
  packageMacosDownload: (input: PackageMacosDownloadInput) => PackageResult;
  createClient: (config: OssPublishConfig) => UploadClient;
  statSync: (path: string) => { size: number };
  readFileSync: (path: string) => Buffer;
  mkdtempSync: typeof mkdtempSync;
  rmSync: typeof rmSync;
}

function requiredValue(
  env: Record<string, string | undefined>,
  name: string,
): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function normalizeEndpoint(endpoint: string, bucket: string): string {
  const parsed = new URL(endpoint);
  if (parsed.protocol !== "https:") {
    throw new Error("HUMANTHREAD_OSS_ENDPOINT must use HTTPS");
  }
  const prefix = `${bucket.toLowerCase()}.`;
  const hostname = parsed.hostname.toLowerCase().startsWith(prefix)
    ? parsed.hostname.slice(prefix.length)
    : parsed.hostname;
  return `https://${hostname}${parsed.port ? `:${parsed.port}` : ""}`;
}

export function parsePublishMacosDownloadArgs(
  args: string[],
): PublishMacosDownloadInput {
  const options = args[0] === "--" ? args.slice(1) : args;
  if (options.length === 0) return {};
  if (options[0] !== "--output-directory") {
    throw new Error(`Unknown publish option: ${options[0]}`);
  }
  const outputDirectory = options[1]?.trim();
  if (!outputDirectory) throw new Error("--output-directory requires a value");
  if (options.length > 2) throw new Error(`Unknown publish option: ${options[2]}`);
  return { outputDirectory };
}

export function readOssPublishConfig(
  env: Record<string, string | undefined> = process.env,
): OssPublishConfig {
  const bucket = requiredValue(env, "HUMANTHREAD_OSS_BUCKET");
  return {
    endpoint: normalizeEndpoint(
      requiredValue(env, "HUMANTHREAD_OSS_ENDPOINT"),
      bucket,
    ),
    region: requiredValue(env, "HUMANTHREAD_OSS_REGION"),
    bucket,
    accessKeyId: requiredValue(env, "HUMANTHREAD_OSS_ACCESS_KEY_ID"),
    accessKeySecret: requiredValue(env, "HUMANTHREAD_OSS_ACCESS_KEY_SECRET"),
  };
}

export async function publishMacosDownload(
  input: PublishMacosDownloadInput = {},
  dependencies: PublishMacosDownloadDependencies = {
    packageMacosDownload,
    createClient: (config) => new OSS({ ...config, secure: true }),
    statSync,
    readFileSync,
    mkdtempSync,
    rmSync,
  },
): Promise<{ objectKey: string; size: number; sha256: string }> {
  const config = readOssPublishConfig();
  const temporaryOutputDirectory = input.outputDirectory
    ? undefined
    : dependencies.mkdtempSync(join(tmpdir(), "humanthread-macos-oss-"));
  const outputDirectory = input.outputDirectory ?? temporaryOutputDirectory;
  if (!outputDirectory) throw new Error("Unable to allocate package output directory");

  try {
    const packageResult = dependencies.packageMacosDownload({ outputDirectory });
    const file = dependencies.readFileSync(packageResult.zipPath);
    const size = dependencies.statSync(packageResult.zipPath).size;
    const sha256 = createHash("sha256").update(file).digest("hex");
    await dependencies.createClient(config).put(
      MACOS_AGENT_OSS_OBJECT_KEY,
      packageResult.zipPath,
      {
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": 'attachment; filename="humanthread-local-agent-macos-arm64.zip"',
          "Cache-Control": "no-store",
          "x-oss-meta-sha256": sha256,
        },
      },
    );
    return { objectKey: MACOS_AGENT_OSS_OBJECT_KEY, size, sha256 };
  } finally {
    if (temporaryOutputDirectory) dependencies.rmSync(temporaryOutputDirectory, { recursive: true, force: true });
  }
}

const currentScriptPath = process.argv[1];
if (currentScriptPath && import.meta.url === new URL(currentScriptPath, "file://").href) {
  assertDesktopReleaseSource();
  publishMacosDownload(parsePublishMacosDownloadArgs(process.argv.slice(2)))
    .then((result) => console.log(`Uploaded ${result.objectKey} (${result.size} bytes, sha256 ${result.sha256})`))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : "Failed to publish macOS package");
      process.exitCode = 1;
    });
}

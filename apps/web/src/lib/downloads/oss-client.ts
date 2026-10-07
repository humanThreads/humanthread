import OSS from "ali-oss";

export const MACOS_AGENT_OSS_OBJECT_KEY =
  "downloads/local-agent/humanthread-local-agent-macos-arm64.zip";
export const DEFAULT_OSS_DOWNLOAD_TTL_SECONDS = 60;

export interface OssDownloadConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  accessKeySecret: string;
  downloadTtlSeconds: number;
}

export class OssDownloadConfigurationError extends Error {
  readonly code = "oss_download_configuration_invalid" as const;
}

function requiredValue(
  env: Record<string, string | undefined>,
  name: string,
): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new OssDownloadConfigurationError(`${name} is required`);
  }
  return value;
}

function positiveInteger(
  env: Record<string, string | undefined>,
  name: string,
  fallback: number,
): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0 || value > 3600) {
    throw new OssDownloadConfigurationError(`${name} must be a positive integer <= 3600`);
  }
  return value;
}

function normalizeEndpoint(endpoint: string, bucket: string): string {
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new OssDownloadConfigurationError("HUMANTHREAD_OSS_ENDPOINT is invalid");
  }
  if (parsed.protocol !== "https:") {
    throw new OssDownloadConfigurationError("HUMANTHREAD_OSS_ENDPOINT must use HTTPS");
  }
  const bucketPrefix = `${bucket.toLowerCase()}.`;
  const hostname = parsed.hostname.toLowerCase().startsWith(bucketPrefix)
    ? parsed.hostname.slice(bucketPrefix.length)
    : parsed.hostname;
  return `https://${hostname}${parsed.port ? `:${parsed.port}` : ""}`;
}

export function readOssDownloadConfig(
  env: Record<string, string | undefined> = process.env,
): OssDownloadConfig {
  const bucket = requiredValue(env, "HUMANTHREAD_OSS_BUCKET");
  const endpoint = normalizeEndpoint(
    requiredValue(env, "HUMANTHREAD_OSS_ENDPOINT"),
    bucket,
  );
  return {
    endpoint,
    region: requiredValue(env, "HUMANTHREAD_OSS_REGION"),
    bucket,
    accessKeyId: requiredValue(env, "HUMANTHREAD_OSS_ACCESS_KEY_ID"),
    accessKeySecret: requiredValue(env, "HUMANTHREAD_OSS_ACCESS_KEY_SECRET"),
    downloadTtlSeconds: positiveInteger(
      env,
      "HUMANTHREAD_OSS_DOWNLOAD_TTL_SECONDS",
      DEFAULT_OSS_DOWNLOAD_TTL_SECONDS,
    ),
  };
}

export function createOssClient(config: OssDownloadConfig = readOssDownloadConfig()) {
  return new OSS({
    region: config.region,
    bucket: config.bucket,
    endpoint: config.endpoint,
    accessKeyId: config.accessKeyId,
    accessKeySecret: config.accessKeySecret,
    secure: true,
  });
}

export function signMacosAgentDownloadUrl(
  client: Pick<OSS, "signatureUrl">,
  config: Pick<OssDownloadConfig, "downloadTtlSeconds">,
): string {
  return client.signatureUrl(MACOS_AGENT_OSS_OBJECT_KEY, {
    expires: config.downloadTtlSeconds,
    method: "GET",
    response: {
      "content-disposition": 'attachment; filename="humanthread-local-agent-macos-arm64.zip"',
      "cache-control": "no-store",
    },
  });
}

export function signReleaseArtifactDownloadUrl(
  client: Pick<OSS, "signatureUrl">,
  config: Pick<OssDownloadConfig, "downloadTtlSeconds">,
  artifact: { objectKey: string; fileName: string },
): string {
  return client.signatureUrl(artifact.objectKey, {
    expires: config.downloadTtlSeconds,
    method: "GET",
    response: {
      "content-disposition": `attachment; filename="${artifact.fileName}"`,
      "cache-control": "no-store",
    },
  });
}

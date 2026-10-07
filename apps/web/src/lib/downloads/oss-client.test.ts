import { describe, expect, it } from "vitest";

import {
  DEFAULT_OSS_DOWNLOAD_TTL_SECONDS,
  MACOS_AGENT_OSS_OBJECT_KEY,
  OssDownloadConfigurationError,
  readOssDownloadConfig,
  signMacosAgentDownloadUrl,
} from "./oss-client";

const env = {
  HUMANTHREAD_OSS_ENDPOINT: "https://s3.example.com",
  HUMANTHREAD_OSS_REGION: "us-east-1",
  HUMANTHREAD_OSS_BUCKET: "humanthread",
  HUMANTHREAD_OSS_ACCESS_KEY_ID: "key",
  HUMANTHREAD_OSS_ACCESS_KEY_SECRET: "secret",
};

describe("OSS client configuration", () => {
  it("normalizes the bucket endpoint for the SDK and defaults the TTL", () => {
    expect(readOssDownloadConfig(env)).toEqual({
      endpoint: "https://s3.example.com",
      region: "us-east-1",
      bucket: "humanthread",
      accessKeyId: "key",
      accessKeySecret: "secret",
      downloadTtlSeconds: DEFAULT_OSS_DOWNLOAD_TTL_SECONDS,
    });
  });

  it("rejects missing credentials", () => {
    expect(() => readOssDownloadConfig({ ...env, HUMANTHREAD_OSS_ACCESS_KEY_ID: "" }))
      .toThrow(OssDownloadConfigurationError);
  });

  it("signs the fixed object with attachment response headers", () => {
    const calls: unknown[] = [];
    const client = {
      signatureUrl(name: string, options: unknown) {
        calls.push(name, options);
        return "https://signed.example/package.zip";
      },
    };

    expect(signMacosAgentDownloadUrl(client, { downloadTtlSeconds: 60 }))
      .toBe("https://signed.example/package.zip");
    expect(calls[0]).toBe(MACOS_AGENT_OSS_OBJECT_KEY);
    expect(calls[1]).toEqual(expect.objectContaining({
      expires: 60,
      method: "GET",
      response: expect.objectContaining({
        "content-disposition": 'attachment; filename="humanthread-local-agent-macos-arm64.zip"',
        "cache-control": "no-store",
      }),
    }));
  });
});

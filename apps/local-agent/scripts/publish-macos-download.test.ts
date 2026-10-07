import { describe, expect, it, vi } from "vitest";

import {
  MACOS_AGENT_OSS_OBJECT_KEY,
  parsePublishMacosDownloadArgs,
  publishMacosDownload,
  readOssPublishConfig,
} from "./publish-macos-download";

describe("publish macOS download", () => {
  it("parses the explicit output directory", () => {
    expect(parsePublishMacosDownloadArgs(["--", "--output-directory", "/tmp/package"]))
      .toEqual({ outputDirectory: "/tmp/package" });
    expect(() => parsePublishMacosDownloadArgs(["--unknown"])).toThrow();
  });

  it("normalizes the bucket endpoint and rejects missing credentials", () => {
    expect(readOssPublishConfig({
      HUMANTHREAD_OSS_ENDPOINT: "https://s3.example.com",
      HUMANTHREAD_OSS_REGION: "us-east-1",
      HUMANTHREAD_OSS_BUCKET: "humanthread",
      HUMANTHREAD_OSS_ACCESS_KEY_ID: "key",
      HUMANTHREAD_OSS_ACCESS_KEY_SECRET: "secret",
    }).endpoint).toBe("https://s3.example.com");
    expect(() => readOssPublishConfig({})).toThrow(/HUMANTHREAD_OSS_BUCKET/);
  });

  it("uploads the fixed key with size and SHA256 metadata", async () => {
    vi.stubEnv("HUMANTHREAD_OSS_ENDPOINT", "https://downloads.example.com");
    vi.stubEnv("HUMANTHREAD_OSS_REGION", "us-east-1");
    vi.stubEnv("HUMANTHREAD_OSS_BUCKET", "humanthread");
    vi.stubEnv("HUMANTHREAD_OSS_ACCESS_KEY_ID", "key");
    vi.stubEnv("HUMANTHREAD_OSS_ACCESS_KEY_SECRET", "secret");
    const put = vi.fn(async () => ({}));
    const createClient = vi.fn(() => ({ put }));
    const file = Buffer.from("package-content");
    const result = await publishMacosDownload(
      { outputDirectory: "/tmp/package" },
      {
        packageMacosDownload: () => ({ zipPath: "/tmp/package/client.zip" }),
        createClient,
        statSync: () => ({ size: file.length }),
        readFileSync: () => file,
        mkdtempSync: vi.fn(),
        rmSync: vi.fn(),
      },
    );

    expect(result.objectKey).toBe(MACOS_AGENT_OSS_OBJECT_KEY);
    expect(result.size).toBe(file.length);
    expect(put).toHaveBeenCalledWith(
      MACOS_AGENT_OSS_OBJECT_KEY,
      "/tmp/package/client.zip",
      expect.objectContaining({ headers: expect.objectContaining({ "x-oss-meta-sha256": expect.any(String) }) }),
    );
    expect(createClient).toHaveBeenCalledWith(expect.objectContaining({ bucket: "humanthread" }));
  });
});

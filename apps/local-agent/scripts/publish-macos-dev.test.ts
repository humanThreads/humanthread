import { describe, expect, it, vi } from "vitest";

import {
  MACOS_AGENT_OFFICIAL_OSS_OBJECT_KEY,
  buildMacosDevObjectKey,
  publishMacosDev,
} from "./publish-macos-dev";

const file = Buffer.from("dev-package-content");

describe("publish macOS dev package", () => {
  it("builds an immutable dev object key without touching the official download key", () => {
    const objectKey = buildMacosDevObjectKey({
      version: "0.1.4",
      commit: "22facd71f6ec66ff3d36dc6c4b1f54b66b29cccc",
    });
    expect(objectKey).toBe(
      "downloads/desktop/dev/humanthread-desktop-macos-arm64-0.1.4-dev-22facd71f6ec.dmg",
    );
    expect(objectKey).not.toBe(MACOS_AGENT_OFFICIAL_OSS_OBJECT_KEY);
  });

  it("uploads only the dev key with dev channel and commit metadata", async () => {
    vi.stubEnv("HUMANTHREAD_OSS_ENDPOINT", "https://downloads.example.com");
    vi.stubEnv("HUMANTHREAD_OSS_REGION", "us-east-1");
    vi.stubEnv("HUMANTHREAD_OSS_BUCKET", "humanthread");
    vi.stubEnv("HUMANTHREAD_OSS_ACCESS_KEY_ID", "key");
    vi.stubEnv("HUMANTHREAD_OSS_ACCESS_KEY_SECRET", "secret");
    const put = vi.fn(async () => ({}));
    const result = await publishMacosDev({
      version: "0.1.4",
      commit: "22facd71f6ec66ff3d36dc6c4b1f54b66b29cccc",
    }, {
      packageMacosDmg: () => "/tmp/dev-package/HumanThread-Desktop-0.1.4-mac-arm64.dmg",
      createClient: () => ({ put }),
      statSync: () => ({ size: file.length }),
      readFileSync: () => file,
    });

    expect(result.objectKey).toContain("/dev/");
    expect(result.objectKey).not.toBe(MACOS_AGENT_OFFICIAL_OSS_OBJECT_KEY);
    expect(put).toHaveBeenCalledWith(
      result.objectKey,
      "/tmp/dev-package/HumanThread-Desktop-0.1.4-mac-arm64.dmg",
      expect.objectContaining({
        headers: expect.objectContaining({
          "Content-Disposition": expect.stringMatching(/dev.*\.dmg/u),
          "Content-Type": "application/x-apple-diskimage",
          "x-oss-meta-channel": "dev",
          "x-oss-meta-app-version": "0.1.4",
          "x-oss-meta-commit": "22facd71f6ec66ff3d36dc6c4b1f54b66b29cccc",
          "x-oss-meta-sha256": expect.any(String),
        }),
      }),
    );
  });
});

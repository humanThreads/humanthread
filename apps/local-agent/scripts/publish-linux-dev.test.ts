import { describe, expect, it, vi } from "vitest";

import { buildLinuxDevObjectKey, publishLinuxDev } from "./publish-linux-dev";

const file = Buffer.from("linux-dev-package");

describe("publish Linux dev package", () => {
  it("builds an immutable dev object key under the dev prefix", () => {
    const objectKey = buildLinuxDevObjectKey({
      version: "0.1.4",
      commit: "8b99b68e947d8de11f3c44d6ba6c316093d0316f",
    });

    expect(objectKey).toBe(
      "downloads/desktop/dev/humanthread-desktop-linux-x64-0.1.4-dev-8b99b68e947d.AppImage",
    );
  });

  it("uploads a prebuilt AppImage with dev metadata", async () => {
    vi.stubEnv("HUMANTHREAD_OSS_ENDPOINT", "https://downloads.example.com");
    vi.stubEnv("HUMANTHREAD_OSS_REGION", "us-east-1");
    vi.stubEnv("HUMANTHREAD_OSS_BUCKET", "humanthread");
    vi.stubEnv("HUMANTHREAD_OSS_ACCESS_KEY_ID", "key");
    vi.stubEnv("HUMANTHREAD_OSS_ACCESS_KEY_SECRET", "secret");
    const put = vi.fn(async () => ({}));

    const result = await publishLinuxDev({
      version: "0.1.4",
      commit: "8b99b68e947d8de11f3c44d6ba6c316093d0316f",
      filePath: "/tmp/linux/HumanThread-Desktop-0.1.4-linux-x64.AppImage",
    }, {
      packageLinuxAppImage: () => {
        throw new Error("should not package when a prebuilt file is provided");
      },
      createClient: () => ({ put }),
      statSync: () => ({ size: file.length }),
      readFileSync: () => file,
      existsSync: () => true,
    });

    expect(result.objectKey).toContain("/dev/");
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(put).toHaveBeenCalledWith(
      result.objectKey,
      "/tmp/linux/HumanThread-Desktop-0.1.4-linux-x64.AppImage",
      expect.objectContaining({
        headers: expect.objectContaining({
          "Content-Type": "application/octet-stream",
          "x-oss-meta-channel": "dev",
          "x-oss-meta-app-version": "0.1.4",
          "x-oss-meta-commit": "8b99b68e947d8de11f3c44d6ba6c316093d0316f",
        }),
      }),
    );
  });

  it("fails when the prebuilt AppImage is missing", async () => {
    await expect(publishLinuxDev({
      version: "0.1.4",
      commit: "8b99b68e947d8de11f3c44d6ba6c316093d0316f",
      filePath: "/tmp/linux/missing.AppImage",
    }, {
      packageLinuxAppImage: () => "/tmp/linux/missing.AppImage",
      createClient: () => ({ put: vi.fn() }),
      statSync: () => ({ size: 0 }),
      readFileSync: () => file,
      existsSync: () => false,
    })).rejects.toThrow("Linux AppImage was not found");
  });
});

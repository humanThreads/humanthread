import { describe, expect, it } from "vitest";

import {
  RELEASE_ARTIFACTS,
  buildReleaseFileName,
  buildReleaseObjectKey,
  parseReleaseManifest,
  resolveReleaseArtifact,
} from "./release-artifacts";

describe("release artifact contract", () => {
  it("defines every supported download slot including Android", () => {
    expect(Object.keys(RELEASE_ARTIFACTS)).toEqual([
      "desktop.macos.arm64",
      "desktop.macos.x64",
      "desktop.windows.x64",
      "desktop.linux.x64",
      "mobile.android.universal",
      "cli.node",
    ]);
    expect(RELEASE_ARTIFACTS["mobile.android.universal"]).toMatchObject({
      product: "mobile",
      platform: "android",
      arch: "universal",
      extension: ".apk",
      downloadPath: "mobile/android",
    });
    expect(RELEASE_ARTIFACTS["cli.node"].downloadPath).toBe("cli");
  });

  it("builds canonical immutable object keys from an allowlisted slot", () => {
    expect(buildReleaseObjectKey("desktop.macos.arm64", "1.4.0")).toBe(
      "downloads/desktop/macos/arm64/1.4.0/HumanThread.dmg",
    );
    expect(buildReleaseObjectKey("mobile.android.universal", "1.4.0-rc.1")).toBe(
      "downloads/mobile/android/universal/1.4.0-rc.1/HumanThread.apk",
    );
    expect(buildReleaseObjectKey("cli.node", "1.4.0")).toBe(
      "downloads/cli/1.4.0/humanthread-cli.tgz",
    );
    expect(() => buildReleaseObjectKey("desktop.macos.arm64", "../latest")).toThrow(
      /version/i,
    );
  });

  it("builds safe public file names from the artifact slot and version", () => {
    expect(buildReleaseFileName("desktop.macos.arm64", "1.4.0")).toBe(
      "HumanThread-1.4.0-macos-arm64.dmg",
    );
    expect(buildReleaseFileName("mobile.android.universal", "1.4.0")).toBe(
      "HumanThread-1.4.0-android.apk",
    );
    expect(buildReleaseFileName("cli.node", "1.4.0")).toBe(
      "humanthread-cli-1.4.0.tgz",
    );
  });

  it("resolves only valid product, platform and architecture combinations", () => {
    expect(resolveReleaseArtifact({
      product: "desktop",
      platform: "windows",
      arch: "x64",
    })?.id).toBe("desktop.windows.x64");
    expect(resolveReleaseArtifact({
      product: "mobile",
      platform: "android",
      arch: "x64",
    })).toBeNull();
  });

  it("accepts a strict manifest and rejects mismatched object keys", () => {
    const manifest = {
      schemaVersion: 1,
      publishedAt: "2026-08-09T12:00:00.000Z",
      artifacts: {
        "mobile.android.universal": {
          version: "1.4.0",
          objectKey: "downloads/mobile/android/universal/1.4.0/HumanThread.apk",
          fileName: "HumanThread-1.4.0-android.apk",
          size: 123456,
          sha256: "a".repeat(64),
          publishedAt: "2026-08-09T12:00:00.000Z",
        },
      },
    };

    expect(parseReleaseManifest(manifest)).toEqual(manifest);
    expect(() => parseReleaseManifest({
      ...manifest,
      artifacts: {
        ...manifest.artifacts,
        "mobile.android.universal": {
          ...manifest.artifacts["mobile.android.universal"],
          objectKey: "downloads/mobile/android/universal/1.4.0/other.apk",
        },
      },
    })).toThrow(/object key/i);
    expect(() => parseReleaseManifest({
      ...manifest,
      artifacts: {
        "mobile.android.universal": {
          ...manifest.artifacts["mobile.android.universal"],
          fileName: 'HumanThread-1.4.0-android.apk"\r\nx-injected: true.apk',
        },
      },
    })).toThrow(/file name/i);
    expect(() => parseReleaseManifest({
      ...manifest,
      artifacts: { "desktop.android.x64": manifest.artifacts["mobile.android.universal"] },
    })).toThrow();
  });

  it("still accepts previously published macOS ZIP entries", () => {
    const legacy = {
      schemaVersion: 1,
      publishedAt: "2026-09-12T05:33:36.351Z",
      artifacts: {
        "desktop.macos.arm64": {
          version: "0.1.4",
          objectKey: "downloads/desktop/macos/arm64/0.1.4/HumanThread.zip",
          fileName: "HumanThread-0.1.4-macos-arm64.zip",
          size: 128058834,
          sha256: "a".repeat(64),
          publishedAt: "2026-09-12T05:33:36.351Z",
        },
      },
    };

    expect(parseReleaseManifest(legacy)).toEqual(legacy);
    expect(() => parseReleaseManifest({
      ...legacy,
      artifacts: {
        "desktop.macos.arm64": {
          ...legacy.artifacts["desktop.macos.arm64"],
          objectKey: "downloads/desktop/macos/arm64/0.1.4/HumanThread.exe",
        },
      },
    })).toThrow(/object key/i);
  });
});

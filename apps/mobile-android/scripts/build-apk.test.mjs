import { describe, expect, it } from "vitest";

import {
  parseBuildApkArgs,
  resolveApkOutputName,
  resolveSigningConfig,
} from "./build-apk.mjs";

describe("android apk build arguments", () => {
  it("defaults to a release build and accepts explicit variants", () => {
    expect(parseBuildApkArgs([])).toEqual({
      variant: "release",
      requireSignature: false,
      outputDirectory: null,
      skipSync: false,
    });
    expect(parseBuildApkArgs(["--variant", "debug"])).toMatchObject({ variant: "debug" });
    expect(() => parseBuildApkArgs(["--variant", "beta"])).toThrow(
      "--variant must be debug or release",
    );
    expect(() => parseBuildApkArgs(["--unknown"])).toThrow("Unknown build:apk option");
  });

  it("parses publication requirements", () => {
    expect(
      parseBuildApkArgs([
        "--require-signature",
        "--output-directory",
        "dist",
        "--skip-sync",
      ]),
    ).toEqual({
      variant: "release",
      requireSignature: true,
      outputDirectory: "dist",
      skipSync: true,
    });
  });
});

describe("android apk signing", () => {
  it("treats a fully absent signing configuration as an unsigned build", () => {
    expect(resolveSigningConfig({})).toBeNull();
  });

  it("fails closed when signing material is partial", () => {
    expect(() =>
      resolveSigningConfig({ HUMANTHREAD_ANDROID_KEYSTORE_PATH: "/tmp/keystore.jks" }),
    ).toThrow("android_signing_unconfigured");
  });

  it("returns secrets only from the environment", () => {
    expect(
      resolveSigningConfig({
        HUMANTHREAD_ANDROID_KEYSTORE_PATH: "/tmp/keystore.jks",
        HUMANTHREAD_ANDROID_KEYSTORE_PASSWORD: "store-secret",
        HUMANTHREAD_ANDROID_KEY_ALIAS: "humanthread",
        HUMANTHREAD_ANDROID_KEY_PASSWORD: "key-secret",
      }),
    ).toEqual({
      path: "/tmp/keystore.jks",
      storePassword: "store-secret",
      keyAlias: "humanthread",
      keyPassword: "key-secret",
    });
  });
});

describe("android apk output naming", () => {
  it("matches the release distribution contract", () => {
    expect(resolveApkOutputName("0.1.3", "release")).toBe(
      "HumanThread-0.1.3-android.apk",
    );
    expect(resolveApkOutputName("0.1.3", "debug")).toBe(
      "HumanThread-0.1.3-android-debug.apk",
    );
  });
});

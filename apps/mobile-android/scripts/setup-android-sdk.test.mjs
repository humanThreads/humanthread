import { describe, expect, it } from "vitest";

import {
  buildAndroidEnvironment,
  planAndroidSdkSetup,
  resolveExistingAndroidSdk,
} from "./setup-android-sdk.mjs";

describe("android sdk setup planning", () => {
  it("uses an existing ANDROID_HOME when the directory exists", () => {
    const existing = resolveExistingAndroidSdk({ ANDROID_HOME: process.cwd() });
    expect(existing).toBe(process.cwd());
    expect(
      planAndroidSdkSetup({ environment: { ANDROID_HOME: process.cwd() }, sdkRoot: "/tmp/sdk" }),
    ).toEqual({ mode: "existing", androidHome: process.cwd() });
  });

  it("plans a bootstrap when no usable SDK is configured", () => {
    const plan = planAndroidSdkSetup({ environment: {}, sdkRoot: "/tmp/bootstrap-sdk" });
    expect(plan.mode).toBe("bootstrap");
    expect(plan.androidHome).toBe("/tmp/bootstrap-sdk");
    expect(plan.packages).toEqual([
      "platform-tools",
      "platforms;android-36",
      "build-tools;36.0.0",
    ]);
    expect(plan.cmdlineToolsUrl).toMatch(/^https:\/\/dl\.google\.com\//u);
  });

  it("exports both ANDROID_HOME and ANDROID_SDK_ROOT for Gradle", () => {
    const environment = buildAndroidEnvironment("/tmp/android-sdk", { PATH: "/usr/bin" });
    expect(environment.ANDROID_HOME).toBe("/tmp/android-sdk");
    expect(environment.ANDROID_SDK_ROOT).toBe("/tmp/android-sdk");
    expect(environment.PATH).toBe("/usr/bin");
  });
});

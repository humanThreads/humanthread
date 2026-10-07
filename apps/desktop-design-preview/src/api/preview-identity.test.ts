import { describe, expect, it } from "vitest";

import { resolvePreviewIdentity } from "./preview-identity";

describe("resolvePreviewIdentity", () => {
  it("persists only stable non-sensitive preview identity fields", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };

    const first = resolvePreviewIdentity(storage, "macOS");
    const second = resolvePreviewIdentity(storage, "macOS");

    expect(first.installationId).toMatch(/^desktop-design-preview-/u);
    expect(first.deviceId).toBe(second.deviceId);
    expect(first.deviceId.length).toBeLessThanOrEqual(64);
    expect([...values.values()].join("")).not.toMatch(
      /accessToken|refreshToken|password|deviceToken/iu,
    );
  });
});

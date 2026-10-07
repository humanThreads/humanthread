import { describe, expect, it, vi } from "vitest";

import {
  buildLinuxAppImageArtifactName,
  packageLinuxAppImage,
} from "./package-linux-appimage";

const readFileSync = (() => JSON.stringify({ version: "0.1.4" })) as unknown as typeof import("node:fs").readFileSync;

describe("package Linux AppImage", () => {
  it("names the artifact deterministically", () => {
    expect(buildLinuxAppImageArtifactName("0.1.4")).toBe(
      "HumanThread-Desktop-0.1.4-linux-x86_64.AppImage",
    );
  });

  it("rejects packaging outside Linux with a clear message", () => {
    expect(() => packageLinuxAppImage({ cwd: "/tmp/app" }, {
      existsSync: () => true,
      readFileSync,
      spawnSync: vi.fn(),
      platform: "darwin",
    })).toThrow("Linux AppImage packaging is only available on Linux");
  });

  it("builds and packages the AppImage on Linux", () => {
    const spawnSync = vi.fn(() => ({ status: 0, error: undefined }));
    const path = packageLinuxAppImage({ cwd: "/tmp/app" }, {
      existsSync: () => true,
      readFileSync,
      spawnSync,
      platform: "linux",
    });

    expect(spawnSync).toHaveBeenNthCalledWith(1, "pnpm", ["build"], {
      cwd: "/tmp/app",
      stdio: "inherit",
    });
    expect(spawnSync).toHaveBeenNthCalledWith(
      2,
      "pnpm",
      ["exec", "electron-builder", "--linux", "AppImage", "--x64"],
      { cwd: "/tmp/app", stdio: "inherit" },
    );
    expect(path).toBe("/tmp/app/dist-installers/HumanThread-Desktop-0.1.4-linux-x86_64.AppImage");
  });
});

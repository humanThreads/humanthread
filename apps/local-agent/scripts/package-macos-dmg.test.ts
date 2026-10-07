import { describe, expect, it, vi } from "vitest";

import packageManifest from "../package.json" with { type: "json" };

import { buildElectronBuilderDmgArtifactName, packageMacosDmg } from "./package-macos-dmg";

describe("package macOS dmg", () => {
  it("builds the versioned dmg artifact name", () => {
    expect(buildElectronBuilderDmgArtifactName("0.1.3")).toBe(
      "HumanThread-Desktop-0.1.3-mac-arm64.dmg",
    );
  });

  it("runs electron-builder for the dmg target on macOS", () => {
    if (process.platform !== "darwin") return;
    const spawnSync = vi.fn(() => ({ status: 0, error: undefined }));
    const dmgPath = packageMacosDmg(
      { cwd: process.cwd() },
      { spawnSync, existsSync: () => true },
    );

    expect(spawnSync).toHaveBeenNthCalledWith(
      1,
      "pnpm",
      ["build"],
      expect.objectContaining({ cwd: process.cwd() }),
    );
    expect(spawnSync).toHaveBeenNthCalledWith(
      2,
      "pnpm",
      ["exec", "electron-builder", "--mac", "dmg", "--arm64"],
      expect.objectContaining({ cwd: process.cwd() }),
    );
    expect(dmgPath.endsWith(buildElectronBuilderDmgArtifactName(packageManifest.version))).toBe(true);
  });
});

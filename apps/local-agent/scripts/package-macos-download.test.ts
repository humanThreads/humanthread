import { describe, expect, it, vi } from "vitest";

import packageManifest from "../package.json" with { type: "json" };

import {
  MACOS_AGENT_PACKAGE_NAME,
  buildElectronBuilderZipArtifactName,
  buildMacosDownloadReadme,
  packageMacosDownload,
  parsePackageMacosDownloadArgs,
} from "./package-macos-download";

type FakeSpawn = (
  command: string,
  args: string[],
  options: { cwd: string; stdio: "inherit" },
) => { status: number | null; error?: Error | undefined };

function fakeSpawn(): ReturnType<typeof vi.fn<FakeSpawn>> {
  return vi.fn<FakeSpawn>(() => ({ status: 0 }));
}

function fakeDependencies(spawnSync = fakeSpawn()) {
  return {
    spawnSync,
    existsSync: vi.fn(() => true),
    rmSync: vi.fn(),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
  };
}

describe("package macOS download", () => {
  it("parses an explicit output directory", () => {
    expect(parsePackageMacosDownloadArgs([])).toEqual({});
    expect(parsePackageMacosDownloadArgs(["--output-directory", "/tmp/out"])).toEqual({
      outputDirectory: "/tmp/out",
    });
    expect(() => parsePackageMacosDownloadArgs(["--unknown"])).toThrow();
    expect(() => parsePackageMacosDownloadArgs(["--output-directory"])).toThrow();
  });

  it("builds the versioned electron-builder artifact name", () => {
    expect(buildElectronBuilderZipArtifactName(packageManifest.version)).toBe(
      `HumanThread-Desktop-${packageManifest.version}-mac-arm64.zip`,
    );
  });

  it("builds the Electron app and repackages it with the README", () => {
    const spawnSync = fakeSpawn();
    const dependencies = fakeDependencies(spawnSync);
    const result = packageMacosDownload(
      { cwd: process.cwd(), stagingRoot: "/tmp/humanthread-staging" },
      dependencies,
    );

    const commands = spawnSync.mock.calls.map(([command, args]) => [command, args]);
    expect(commands[0]).toEqual([
      "pnpm",
      ["--filter", "@humanthread/workbench-client", "build"],
    ]);
    expect(commands[1]).toEqual([
      "pnpm",
      ["exec", "electron-builder", "--mac", "zip", "--arm64"],
    ]);
    expect(commands[2]?.[0]).toBe("unzip");
    expect(commands[2]?.[1]).toEqual([
      "-q",
      expect.stringContaining(`HumanThread-Desktop-${packageManifest.version}-mac-arm64.zip`),
      "-d",
      "/tmp/humanthread-staging/HumanThread-Desktop",
    ]);
    expect(commands[3]?.[0]).toBe("xattr");
    expect(commands[4]?.[0]).toBe("codesign");
    expect(commands[4]?.[1]).toEqual([
      "--verify",
      "--deep",
      "--strict",
      "/tmp/humanthread-staging/HumanThread-Desktop/HumanThread Desktop.app",
    ]);
    expect(commands[5]?.[0]).toBe("zip");
    expect(commands.some(([, args]) => args?.includes("--sign"))).toBe(false);
    expect(result.signed).toBe(true);
    expect(result.zipPath.endsWith(MACOS_AGENT_PACKAGE_NAME)).toBe(true);
    const readmeWrite = dependencies.writeFileSync.mock.calls.find(([path]) =>
      String(path).endsWith("README.txt"),
    );
    expect(readmeWrite?.[1]).toContain("HumanThread Desktop");
  });

  it("honors an explicit output directory", () => {
    const dependencies = fakeDependencies();
    const result = packageMacosDownload(
      {
        cwd: process.cwd(),
        outputDirectory: "/tmp/custom-out",
        stagingRoot: "/tmp/humanthread-staging-custom",
      },
      dependencies,
    );

    expect(result.zipPath).toBe(`/tmp/custom-out/${MACOS_AGENT_PACKAGE_NAME}`);
  });

  it("fails when electron-builder did not produce a zip", () => {
    const dependencies = fakeDependencies();
    dependencies.existsSync.mockReturnValue(false);
    expect(() =>
      packageMacosDownload({ cwd: process.cwd(), stagingRoot: "/tmp/humanthread-staging-missing" }, dependencies),
    ).toThrow(/Electron macOS zip not found/u);
  });

  it("fails when the builder command fails", () => {
    const dependencies = fakeDependencies(vi.fn(() => ({ status: 1, error: undefined })));
    expect(() =>
      packageMacosDownload({ cwd: process.cwd(), stagingRoot: "/tmp/humanthread-staging-fail" }, dependencies),
    ).toThrow(/Failed/u);
  });

  it("documents the unsigned preview and no longer references the legacy fixed URL", () => {
    const readme = buildMacosDownloadReadme();
    expect(readme).toContain("未签名预览版");
    expect(readme).not.toContain("downloads/local-agent");
  });
});

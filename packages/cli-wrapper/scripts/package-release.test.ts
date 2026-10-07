import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { packageRelease } from "./package-release.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function cleanNpmEnvironment() {
  const env = { ...process.env };
  for (const name of [
    "npm_config__jsr_registry",
    "npm_config_npm_globalconfig",
    "npm_config_verify_deps_before_run",
    "pnpm_config_verify_deps_before_run",
  ]) delete env[name];
  return env;
}

describe("CLI release package", () => {
  it("creates a self-contained package that installs and runs in a clean directory", async () => {
    const outputDirectory = mkdtempSync(join(tmpdir(), "humanthread-cli-release-"));
    const artifactPath = await packageRelease({ packageRoot, outputDirectory });
    const unpackDirectory = mkdtempSync(join(tmpdir(), "humanthread-cli-unpack-"));

    execFileSync("tar", ["-xzf", artifactPath, "-C", unpackDirectory]);

    const releaseManifest = JSON.parse(readFileSync(
      join(unpackDirectory, "package", "package.json"),
      "utf8",
    )) as { dependencies?: Record<string, string>; private?: boolean; version?: string };
    const packageFiles = execFileSync("tar", ["-tzf", artifactPath], { encoding: "utf8" })
      .trim()
      .split("\n")
      .sort();

    expect(releaseManifest.private).toBeUndefined();
    expect(releaseManifest.dependencies).toBeUndefined();
    expect(JSON.stringify(releaseManifest)).not.toContain("workspace:");
    expect(packageFiles).toEqual([
      "package/dist/cli.js",
      "package/dist/ht-cli.js",
      "package/package.json",
    ]);

    const installDirectory = mkdtempSync(join(tmpdir(), "humanthread-cli-install-"));
    execFileSync("npm", ["install", "--ignore-scripts", "--prefix", installDirectory, artifactPath], {
      stdio: "pipe",
      env: cleanNpmEnvironment(),
    });
    const binDirectory = join(installDirectory, "node_modules", ".bin");

    expect(execFileSync(join(binDirectory, "ht"), ["--help"], { encoding: "utf8" }))
      .toContain("Usage:");
    expect(execFileSync(join(binDirectory, "ht"), ["--version"], { encoding: "utf8" }).trim())
      .toBe(releaseManifest.version);
    expect(readdirSync(outputDirectory).filter((name) => name.endsWith(".tgz")))
      .toEqual([artifactPath.split("/").at(-1)]);
  }, 30_000);
});

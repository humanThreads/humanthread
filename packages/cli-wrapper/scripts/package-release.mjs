#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

import { assertReleaseSource } from "../../../scripts/releases/release-source.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const defaultPackageRoot = resolve(scriptDirectory, "..");

function npmEnvironment() {
  const env = { ...process.env };
  for (const name of [
    "npm_config__jsr_registry",
    "npm_config_npm_globalconfig",
    "npm_config_verify_deps_before_run",
    "pnpm_config_verify_deps_before_run",
  ]) {
    delete env[name];
  }
  return env;
}

function releaseManifest(sourceManifest) {
  return {
    name: sourceManifest.name,
    version: sourceManifest.version,
    description: "HumanThread Agent CLI",
    type: "module",
    engines: { node: ">=22" },
    bin: {
      ht: "./dist/ht-cli.js",
      "ht-run": "./dist/cli.js",
    },
    files: ["dist"],
  };
}

export async function packageRelease({
  packageRoot = defaultPackageRoot,
  outputDirectory = join(defaultPackageRoot, "release"),
} = {}) {
  const sourceManifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
  const stagingDirectory = mkdtempSync(join(tmpdir(), "humanthread-cli-package-"));
  const distDirectory = join(stagingDirectory, "dist");
  mkdirSync(outputDirectory, { recursive: true });
  mkdirSync(distDirectory, { recursive: true });

  try {
    for (const [entryPoint, outfile] of [
      [join(packageRoot, "src", "ht-cli.ts"), join(distDirectory, "ht-cli.js")],
      [join(packageRoot, "src", "cli.ts"), join(distDirectory, "cli.js")],
    ]) {
      await build({
        entryPoints: [entryPoint],
        outfile,
        bundle: true,
        platform: "node",
        format: "esm",
        target: "node22",
        banner: {
          js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
        },
        legalComments: "none",
        sourcemap: false,
      });
      chmodSync(outfile, 0o755);
    }

    writeFileSync(
      join(stagingDirectory, "package.json"),
      `${JSON.stringify(releaseManifest(sourceManifest), null, 2)}\n`,
    );
    const packed = JSON.parse(execFileSync(
      "npm",
      ["pack", "--json", "--pack-destination", outputDirectory, stagingDirectory],
      { encoding: "utf8", env: npmEnvironment() },
    ));
    const filename = packed[0]?.filename;
    if (typeof filename !== "string" || !filename.endsWith(".tgz")) {
      throw new Error("npm pack did not produce a release archive");
    }
    return join(outputDirectory, filename);
  } finally {
    rmSync(stagingDirectory, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assertReleaseSource();
  const artifactPath = await packageRelease();
  process.stdout.write(`${artifactPath}\n`);
}

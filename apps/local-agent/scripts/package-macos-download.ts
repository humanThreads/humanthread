import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import { assertDesktopReleaseSource } from "../../../scripts/releases/release-source.mjs";

export const MACOS_AGENT_PACKAGE_NAME =
  "humanthread-local-agent-macos-arm64.zip";

const APP_BUNDLE_NAME = "HumanThread Desktop.app";
const PACKAGE_FOLDER_NAME = "HumanThread-Desktop";
const ARM64_TARGET = "arm64";

export interface PackageMacosDownloadInput {
  cwd?: string;
  outputDirectory?: string;
  stagingRoot?: string;
}

export interface PackageSpawnResult {
  status: number | null;
  error?: Error | undefined;
}

export interface PackageMacosDownloadDependencies {
  existsSync: typeof existsSync;
  rmSync: typeof rmSync;
  mkdirSync: typeof mkdirSync;
  writeFileSync: typeof writeFileSync;
  spawnSync: (
    command: string,
    args: string[],
    options: {
      cwd: string;
      stdio: "inherit";
    },
  ) => PackageSpawnResult;
}

export interface PackageMacosDownloadResult {
  appBundlePath: string;
  zipPath: string;
  signed: boolean;
}

function assertSpawnSuccess(result: PackageSpawnResult, message: string): void {
  if (result.status !== 0) {
    throw result.error ?? new Error(message);
  }
}

function resolveRepoRoot(cwd: string): string {
  return resolve(cwd, "../..");
}

function readPackageVersion(cwd: string): string {
  const manifest = JSON.parse(readFileSync(resolve(cwd, "package.json"), "utf8")) as {
    version?: unknown;
  };
  if (typeof manifest.version !== "string" || manifest.version.length === 0) {
    throw new Error("Local Agent package version is unavailable");
  }
  return manifest.version;
}

export function buildElectronBuilderZipArtifactName(version: string): string {
  return `HumanThread-Desktop-${version}-mac-${ARM64_TARGET}.zip`;
}

export function parsePackageMacosDownloadArgs(
  args: string[],
): PackageMacosDownloadInput {
  const options = args[0] === "--" ? args.slice(1) : args;
  if (options.length === 0) return {};
  if (options[0] !== "--output-directory") {
    throw new Error(`Unknown package option: ${options[0]}`);
  }
  const outputDirectory = options[1]?.trim();
  if (!outputDirectory) {
    throw new Error("--output-directory requires a value");
  }
  if (options.length > 2) {
    throw new Error(`Unknown package option: ${options[2]}`);
  }
  return { outputDirectory };
}

export function buildMacosDownloadReadme(): string {
  return `HumanThread Desktop macOS arm64 预览版

使用方式：
1. 双击解压 humanthread-local-agent-macos-arm64.zip。
2. 打开 HumanThread-Desktop 文件夹。
3. 双击 HumanThread Desktop.app 启动。
4. 默认连接 http://localhost:3000。
5. 在客户端填写 Web 工作台账号邮箱和密码，登录后会自动同步这台设备的身份。
6. 如果使用私有化部署，点击“切换私有化部署”后再填写部署地址。

密码只在提交登录时使用，不会写入本地持久化配置。所有会话凭据只保存在当前进程内存，重启客户端后需要重新登录。

如果 macOS 提示来自未识别开发者：
1. 打开“系统设置 > 隐私与安全性”。
2. 在安全性提示处点击“仍要打开”。
3. 如果仍提示已损坏，右键 HumanThread Desktop.app，选择“打开”。

当前包是未签名预览版，用于内测联调。后续会替换为签名 .dmg 安装包。
`;
}

export function packageMacosDownload(
  input: PackageMacosDownloadInput = {},
  dependencies: PackageMacosDownloadDependencies = {
    existsSync,
    rmSync,
    mkdirSync,
    writeFileSync,
    spawnSync,
  },
): PackageMacosDownloadResult {
  const cwd = input.cwd ?? process.cwd();
  const repoRoot = resolveRepoRoot(cwd);
  const outputDirectory = input.outputDirectory
    ? resolve(cwd, input.outputDirectory)
    : join(repoRoot, "apps/web/public/downloads/local-agent");
  const version = readPackageVersion(cwd);
  const builderZipPath = join(
    cwd,
    "dist-installers",
    buildElectronBuilderZipArtifactName(version),
  );
  const zipPath = join(outputDirectory, MACOS_AGENT_PACKAGE_NAME);

  assertSpawnSuccess(
    dependencies.spawnSync(
      "pnpm",
      ["--filter", "@humanthread/workbench-client", "build"],
      { cwd: repoRoot, stdio: "inherit" },
    ),
    "Failed to rebuild shared desktop contracts.",
  );
  assertSpawnSuccess(
    dependencies.spawnSync(
      "pnpm",
      ["exec", "electron-builder", "--mac", "zip", `--${ARM64_TARGET}`],
      { cwd, stdio: "inherit" },
    ),
    "Failed to build the macOS Electron app bundle.",
  );
  if (!dependencies.existsSync(builderZipPath)) {
    throw new Error(`Electron macOS zip not found: ${builderZipPath}`);
  }

  const stagingRoot =
    input.stagingRoot ?? join(tmpdir(), "humanthread-macos-package");
  const packageRoot = join(stagingRoot, PACKAGE_FOLDER_NAME);
  const stagedAppBundlePath = join(packageRoot, APP_BUNDLE_NAME);

  dependencies.rmSync(stagingRoot, { force: true, recursive: true });
  dependencies.mkdirSync(packageRoot, { recursive: true });
  assertSpawnSuccess(
    dependencies.spawnSync(
      "unzip",
      ["-q", builderZipPath, "-d", packageRoot],
      { cwd, stdio: "inherit" },
    ),
    "Failed to extract the Electron macOS zip.",
  );
  if (!dependencies.existsSync(stagedAppBundlePath)) {
    throw new Error(`Mac app bundle not found after extraction: ${stagedAppBundlePath}`);
  }
  assertSpawnSuccess(
    dependencies.spawnSync("xattr", ["-cr", stagedAppBundlePath], {
      cwd: stagingRoot,
      stdio: "inherit",
    }),
    "Failed to clear macOS quarantine attributes.",
  );
  const verification = dependencies.spawnSync(
    "codesign",
    ["--verify", "--deep", "--strict", stagedAppBundlePath],
    { cwd: stagingRoot, stdio: "inherit" },
  );
  const signed = verification.status === 0;
  if (!signed) {
    console.warn(
      "macOS app bundle is not signed with a Developer ID; shipping the unsigned preview package.",
    );
  }
  dependencies.writeFileSync(
    join(packageRoot, "README.txt"),
    buildMacosDownloadReadme(),
    "utf8",
  );

  dependencies.mkdirSync(dirname(zipPath), { recursive: true });
  dependencies.rmSync(zipPath, { force: true });
  assertSpawnSuccess(
    dependencies.spawnSync("zip", ["-qry", zipPath, basename(packageRoot)], {
      cwd: stagingRoot,
      stdio: "inherit",
    }),
    "Failed to package macOS download zip.",
  );

  return { appBundlePath: stagedAppBundlePath, zipPath, signed };
}

const currentScriptPath = process.argv[1];

if (
  currentScriptPath &&
  import.meta.url === new URL(currentScriptPath, "file://").href
) {
  assertDesktopReleaseSource();
  const result = packageMacosDownload(
    parsePackageMacosDownloadArgs(process.argv.slice(2)),
  );
  console.log(`Packaged ${result.zipPath}`);
}

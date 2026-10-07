import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ANDROID_SDK_PACKAGES = [
  "platform-tools",
  "platforms;android-36",
  "build-tools;36.0.0",
];

export const CMDLINE_TOOLS_URL =
  "https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip";

export function resolveExistingAndroidSdk(environment = process.env) {
  const candidate = environment.ANDROID_HOME?.trim() || environment.ANDROID_SDK_ROOT?.trim();
  if (!candidate) return null;
  return existsSync(candidate) ? candidate : null;
}

export function resolveBootstrapSdkRoot(packageRoot) {
  return join(packageRoot, "..", "..", ".android-sdk");
}

export function planAndroidSdkSetup(input) {
  const existing = resolveExistingAndroidSdk(input.environment ?? process.env);
  if (existing) {
    return { mode: "existing", androidHome: existing };
  }
  return {
    mode: "bootstrap",
    androidHome: input.sdkRoot,
    cmdlineToolsUrl: CMDLINE_TOOLS_URL,
    packages: [...ANDROID_SDK_PACKAGES],
  };
}

function run(spawn, command, args, options = {}) {
  const result = spawn(command, args, { stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status}`);
  }
  return result;
}

export function setupAndroidSdk(input = {}, dependencies = {}) {
  const spawn = dependencies.spawn ?? spawnSync;
  const packageRoot = input.packageRoot ?? resolve(fileURLToPath(import.meta.url), "..", "..");
  const sdkRoot = input.sdkRoot ?? resolveBootstrapSdkRoot(packageRoot);
  const plan = planAndroidSdkSetup({ environment: input.environment ?? process.env, sdkRoot });
  if (plan.mode === "existing") {
    return plan;
  }

  const sdkmanager = join(sdkRoot, "cmdline-tools", "latest", "bin", "sdkmanager");
  if (!existsSync(sdkmanager)) {
    mkdirSync(join(sdkRoot, "cmdline-tools"), { recursive: true });
    const archive = join(sdkRoot, "cmdline-tools.zip");
    run(spawn, "curl", ["-sSL", "-o", archive, plan.cmdlineToolsUrl]);
    run(spawn, "unzip", ["-q", "-o", archive, "-d", join(sdkRoot, "cmdline-tools-extract")]);
    run(spawn, "mv", [
      join(sdkRoot, "cmdline-tools-extract", "cmdline-tools"),
      join(sdkRoot, "cmdline-tools", "latest"),
    ]);
  }
  run(spawn, "sh", ["-c", `yes | "${sdkmanager}" --licenses >/dev/null 2>&1 || true`]);
  run(spawn, sdkmanager, plan.packages, {
    env: { ...(input.environment ?? process.env), ANDROID_HOME: sdkRoot },
  });
  return { mode: "bootstrapped", androidHome: sdkRoot };
}

export function buildAndroidEnvironment(androidHome, environment = process.env) {
  return {
    ...environment,
    ANDROID_HOME: androidHome,
    ANDROID_SDK_ROOT: androidHome,
  };
}

const currentScriptPath = process.argv[1];

if (
  currentScriptPath &&
  fileURLToPath(import.meta.url) === resolve(currentScriptPath)
) {
  try {
    const printEnvironment = process.argv.includes("--print-env");
    const result = setupAndroidSdk();
    if (printEnvironment) {
      console.log(`export ANDROID_HOME='${result.androidHome}'`);
      console.log(`export ANDROID_SDK_ROOT='${result.androidHome}'`);
    } else {
      console.log(`${result.mode === "existing" ? "Using" : "Bootstrapped"} Android SDK: ${result.androidHome}`);
    }
  } catch (error) {
    console.error(
      `android_toolchain_unconfigured: ${error instanceof Error ? error.message : String(error)}`,
    );
    console.error(
      "Provide ANDROID_HOME/ANDROID_SDK_ROOT, or install curl, unzip and a JDK on the build agent for bootstrap.",
    );
    process.exitCode = 1;
  }
}

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ANDROID_SIGNING_ENVIRONMENT = {
  keystorePath: "HUMANTHREAD_ANDROID_KEYSTORE_PATH",
  keystorePassword: "HUMANTHREAD_ANDROID_KEYSTORE_PASSWORD",
  keyAlias: "HUMANTHREAD_ANDROID_KEY_ALIAS",
  keyPassword: "HUMANTHREAD_ANDROID_KEY_PASSWORD",
};

export function parseBuildApkArgs(argv) {
  const options = {
    variant: "release",
    requireSignature: false,
    outputDirectory: null,
    skipSync: false,
  };
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--variant") {
      const value = args[index + 1];
      if (value !== "debug" && value !== "release") {
        throw new Error("--variant must be debug or release");
      }
      options.variant = value;
      index += 1;
    } else if (argument === "--require-signature") {
      options.requireSignature = true;
    } else if (argument === "--skip-sync") {
      options.skipSync = true;
    } else if (argument === "--output-directory") {
      const value = args[index + 1];
      if (!value || value.trim().length === 0) {
        throw new Error("--output-directory requires a value");
      }
      options.outputDirectory = value.trim();
      index += 1;
    } else {
      throw new Error(`Unknown build:apk option: ${argument}`);
    }
  }
  return options;
}

export function resolveSigningConfig(environment) {
  const path = environment[ANDROID_SIGNING_ENVIRONMENT.keystorePath]?.trim();
  const storePassword = environment[ANDROID_SIGNING_ENVIRONMENT.keystorePassword]?.trim();
  const keyAlias = environment[ANDROID_SIGNING_ENVIRONMENT.keyAlias]?.trim();
  const keyPassword = environment[ANDROID_SIGNING_ENVIRONMENT.keyPassword]?.trim();
  if (!path && !storePassword && !keyAlias && !keyPassword) {
    return null;
  }
  const missing = [];
  if (!path) missing.push(ANDROID_SIGNING_ENVIRONMENT.keystorePath);
  if (!storePassword) missing.push(ANDROID_SIGNING_ENVIRONMENT.keystorePassword);
  if (!keyAlias) missing.push(ANDROID_SIGNING_ENVIRONMENT.keyAlias);
  if (!keyPassword) missing.push(ANDROID_SIGNING_ENVIRONMENT.keyPassword);
  if (missing.length > 0) {
    throw new Error(`android_signing_unconfigured: missing ${missing.join(", ")}`);
  }
  return { path, storePassword, keyAlias, keyPassword };
}

export function resolveApkOutputName(version, variant) {
  return variant === "debug"
    ? `HumanThread-${version}-android-debug.apk`
    : `HumanThread-${version}-android.apk`;
}

export function readRepositoryVersion(packageRoot) {
  const manifest = JSON.parse(readFileSync(join(packageRoot, "..", "..", "package.json"), "utf8"));
  if (typeof manifest.version !== "string" || manifest.version.length === 0) {
    throw new Error("Repository version is unavailable");
  }
  return manifest.version;
}

function run(spawn, command, args, options) {
  const result = spawn(command, args, { stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status}`);
  }
}

export function resolveApksignerPath(androidHome) {
  if (!androidHome) return null;
  const buildToolsRoot = join(androidHome, "build-tools");
  if (!existsSync(buildToolsRoot)) return null;
  const candidates = readdirSync(buildToolsRoot).sort();
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = join(buildToolsRoot, candidates[index], "apksigner");
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function buildApk(input, dependencies = {}) {
  const spawn = dependencies.spawn ?? spawnSync;
  const packageRoot = input.packageRoot ?? resolve(fileURLToPath(import.meta.url), "..", "..");
  const version = input.version ?? readRepositoryVersion(packageRoot);
  const options = input.options;
  const signing = resolveSigningConfig(input.environment ?? process.env);
  if (options.variant === "release" && options.requireSignature && signing === null) {
    throw new Error("android_signing_unconfigured: release publication requires signing material");
  }

  if (!options.skipSync) {
    run(spawn, "pnpm", ["exec", "cap", "sync", "android"], { cwd: packageRoot });
  }

  const gradleCommand = process.platform === "win32" ? "gradlew.bat" : "./gradlew";
  const gradleTask = options.variant === "debug" ? "assembleDebug" : "assembleRelease";
  const gradleEnvironment = { ...(input.environment ?? process.env) };
  if (signing) {
    gradleEnvironment[ANDROID_SIGNING_ENVIRONMENT.keystorePath] = signing.path;
    gradleEnvironment[ANDROID_SIGNING_ENVIRONMENT.keystorePassword] = signing.storePassword;
    gradleEnvironment[ANDROID_SIGNING_ENVIRONMENT.keyAlias] = signing.keyAlias;
    gradleEnvironment[ANDROID_SIGNING_ENVIRONMENT.keyPassword] = signing.keyPassword;
  }
  run(spawn, gradleCommand, [gradleTask], {
    cwd: join(packageRoot, "android"),
    env: gradleEnvironment,
    shell: process.platform === "win32",
  });

  const apkDirectory = join(
    packageRoot,
    "android/app/build/outputs/apk",
    options.variant,
  );
  const sourceApkCandidates = options.variant === "release"
    ? [join(apkDirectory, "app-release.apk"), join(apkDirectory, "app-release-unsigned.apk")]
    : [join(apkDirectory, `app-${options.variant}.apk`)];
  const sourceApk = sourceApkCandidates.find((candidate) => existsSync(candidate));
  if (!sourceApk) {
    throw new Error(`APK was not produced: ${sourceApkCandidates.join(", ")}`);
  }
  const outputDirectory = options.outputDirectory
    ? resolve(packageRoot, options.outputDirectory)
    : join(packageRoot, "dist-android");
  const outputApk = join(outputDirectory, resolveApkOutputName(version, options.variant));
  mkdirSync(dirname(outputApk), { recursive: true });
  copyFileSync(sourceApk, outputApk);

  let signatureVerified = false;
  const apksigner = resolveApksignerPath((input.environment ?? process.env).ANDROID_HOME);
  if (apksigner) {
    const verification = spawn(apksigner, ["verify", "--print-certs", outputApk], {
      stdio: "inherit",
    });
    if (verification.error) throw verification.error;
    signatureVerified = verification.status === 0;
    if (!signatureVerified && (options.requireSignature || options.variant === "debug")) {
      throw new Error("android_apk_signature_unverified: APK signature verification failed");
    }
  }
  return { apkPath: outputApk, sourceApk, version, signed: signing !== null, signatureVerified };
}

const currentScriptPath = process.argv[1];

if (
  currentScriptPath &&
  fileURLToPath(import.meta.url) === resolve(currentScriptPath)
) {
  const options = parseBuildApkArgs(process.argv.slice(2));
  const result = buildApk({ options });
  const signature = result.signatureVerified
    ? "signature-verified"
    : result.signed
      ? "release-signed"
      : options.variant === "debug"
        ? "debug-signed"
        : "unsigned";
  console.log(`Built ${signature} APK: ${result.apkPath}`);
}

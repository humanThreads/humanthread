import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  getProjectRepositoryVerificationTarget,
  resolveProjectEnvironmentSecrets,
  saveProjectRepositoryVerification,
} from "@humanthread/db";
import {
  normalizeGitCredentialEnvironment,
  repositoryCredentialSecretNames,
  repositoryHost,
  repositoryVerificationJobSchema,
  type ProjectRepositoryAuthMode,
  type ProjectRepositoryConfiguration,
  type ProjectRepositoryProvider,
  type RepositoryVerificationFailureCode,
  type RepositoryVerificationJob,
  type RepositoryVerificationResult,
} from "@humanthread/orchestration-core";

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 30_000;
const ASKPASS_SCRIPT = `#!/bin/sh
set -eu
case "\${1:-}" in
  *Username*) printf '%s\\n' "$HT_GIT_USERNAME" ;;
  *) printf '%s\\n' "$HT_GIT_SECRET" ;;
esac
`;

export type GitVerificationInput = {
  repositoryUrl: string;
  provider: ProjectRepositoryProvider;
  authMode: ProjectRepositoryAuthMode;
  username: string;
  secret: string;
};

export type GitVerificationResult = {
  defaultBranch: string;
  headSha: string;
};

type RunGitResult = { stdout: string; stderr?: string };
type RunGit = (args: string[], options: { env: NodeJS.ProcessEnv; timeoutMs: number }) => Promise<RunGitResult>;

export type RepositoryVerificationTarget = {
  projectId: string;
  version: number;
  repositoryUrl: string;
  configuration: ProjectRepositoryConfiguration;
};

export type RepositoryVerificationDependencies = {
  loadTarget(input: { projectId: string; expectedVersion: number }): Promise<RepositoryVerificationTarget | null>;
  resolveSecrets(input: { projectId: string; names: string[] }): Promise<Record<string, string>>;
  saveVerification(input: {
    projectId: string;
    expectedVersion: number;
    verification: RepositoryVerificationResult;
  }): Promise<{ projectId: string; version: number }>;
  executor: ((input: GitVerificationInput) => Promise<GitVerificationResult>) | null;
  privateHostAllowlist: string[];
  now(): Date;
};

const defaultDependencies: RepositoryVerificationDependencies = {
  loadTarget: (input) => getProjectRepositoryVerificationTarget(input),
  resolveSecrets: (input) => resolveProjectEnvironmentSecrets(input),
  saveVerification: (input) => saveProjectRepositoryVerification(input),
  executor: createGitRepositoryVerificationExecutor(),
  privateHostAllowlist: parseAllowlist(process.env.HUMANTHREAD_PRIVATE_GIT_HOST_ALLOWLIST),
  now: () => new Date(),
};

function verificationError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function parseAllowlist(value: string | undefined): string[] {
  return [...new Set((value ?? "").split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean))];
}

function failureResult(code: RepositoryVerificationFailureCode, status: RepositoryVerificationResult["status"] = "failed"): RepositoryVerificationResult {
  return { status, verifiedAt: null, defaultBranch: null, headSha: null, failureCode: code, apiChecked: false };
}

function failureCode(error: unknown): RepositoryVerificationFailureCode {
  const code = error && typeof error === "object" && typeof Reflect.get(error, "code") === "string"
    ? String(Reflect.get(error, "code"))
    : "verification_failed";
  const allowed = new Set<RepositoryVerificationFailureCode>([
    "provider_unsupported",
    "private_host_not_allowed",
    "repository_not_found",
    "credential_rejected",
    "permission_denied",
    "default_branch_unavailable",
    "verification_timeout",
    "executor_not_configured",
    "secret_cleanup_failed",
    "verification_failed",
  ]);
  return allowed.has(code as RepositoryVerificationFailureCode) ? code as RepositoryVerificationFailureCode : "verification_failed";
}

function safeVerificationError(code: string): Error & { code: string } {
  const messages: Record<string, string> = {
    provider_unsupported: "Git provider does not support the selected authentication mode",
    private_host_not_allowed: "Private Git host is not allowlisted",
    repository_not_found: "Git repository was not found or is not readable",
    credential_rejected: "Git repository authentication was rejected",
    permission_denied: "Git credential does not have the required repository permission",
    default_branch_unavailable: "Git repository did not return a default branch",
    verification_timeout: "Git repository verification timed out",
    executor_not_configured: "Git verification executor is not configured",
    secret_cleanup_failed: "Temporary Git credential cleanup failed",
    verification_failed: "Git repository verification failed",
  };
  const failure = failureCode({ code });
  return verificationError(failure, messages[failure] ?? messages.verification_failed!);
}

export function parseGitLsRemote(output: string): GitVerificationResult {
  let defaultBranch: string | null = null;
  let headSha: string | null = null;
  for (const line of output.split(/\r?\n/u)) {
    const symref = /^ref:\s+refs\/heads\/([^\s\t]+)\s+HEAD$/u.exec(line.trim());
    if (symref?.[1]) defaultBranch = symref[1];
    const head = /^([a-f0-9]{40,64})\s+HEAD$/u.exec(line.trim());
    if (head?.[1]) headSha = head[1];
  }
  if (!defaultBranch) throw verificationError("default_branch_unavailable", "Git repository did not return a default branch");
  if (!headSha) throw verificationError("repository_not_found", "Git repository did not return a HEAD commit");
  return { defaultBranch, headSha };
}

function classifyGitFailure(error: unknown): Error & { code: string } {
  const candidate = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const message = typeof candidate.message === "string" ? candidate.message : "";
  if (candidate.code === "ENOENT") return verificationError("executor_not_configured", "Git executable is unavailable");
  if (candidate.killed === true || candidate.name === "AbortError" || /timed?\s*out|timeout/iu.test(message)) {
    return verificationError("verification_timeout", "Git repository verification timed out");
  }
  if (/authentication|credential|401|403|invalid username or password/iu.test(message)) {
    return verificationError("credential_rejected", "Git repository authentication was rejected");
  }
  if (/repository.*not found|could not read from remote repository|does not appear to be a git repository/iu.test(message)) {
    return verificationError("repository_not_found", "Git repository was not found or is not readable");
  }
  if (/permission denied|access denied/iu.test(message)) {
    return verificationError("permission_denied", "Git credential does not have the required repository permission");
  }
  return verificationError("verification_failed", "Git repository verification failed");
}

export function createGitRepositoryVerificationExecutor(dependencies: {
  runGit?: RunGit;
  createTempDirectory?: () => Promise<string>;
  writePrivateFile?: (path: string, content: string) => Promise<void>;
  removePath?: (path: string) => Promise<void>;
  timeoutMs?: number;
  processEnvironment?: NodeJS.ProcessEnv;
} = {}) {
  const runGit = dependencies.runGit ?? (async (args, options) => {
    const result = await execFileAsync("git", args, {
      timeout: options.timeoutMs,
      maxBuffer: 1024 * 1024,
      env: options.env,
      windowsHide: true,
    });
    return { stdout: String(result.stdout), stderr: String(result.stderr) };
  });
  const createTempDirectory = dependencies.createTempDirectory ?? (() => mkdtemp(join(tmpdir(), "ht-repository-verify-")));
  const writePrivateFile = dependencies.writePrivateFile ?? (async (path, content) => {
    await writeFile(path, content, { encoding: "utf8", mode: 0o700 });
  });
  const removePath = dependencies.removePath ?? ((path) => rm(path, { recursive: true, force: true }));
  const timeoutMs = dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const processEnvironment = dependencies.processEnvironment ?? process.env;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) throw verificationError("invalid_arguments", "Git verification timeout is invalid");

  return async (input: GitVerificationInput): Promise<GitVerificationResult> => {
    const credentials = normalizeGitCredentialEnvironment({
      provider: input.provider,
      authMode: input.authMode,
      username: input.username,
      secret: input.secret,
    });
    const root = await createTempDirectory();
    const askpassPath = join(root, "askpass.sh");
    const checkoutPath = join(root, "repository");
    const environment: NodeJS.ProcessEnv = {
      NODE_ENV: processEnvironment.NODE_ENV ?? "production",
      ...(processEnvironment.PATH ? { PATH: processEnvironment.PATH } : {}),
      ...(processEnvironment.LANG ? { LANG: processEnvironment.LANG } : {}),
      ...(processEnvironment.TZ ? { TZ: processEnvironment.TZ } : {}),
      GIT_ASKPASS: askpassPath,
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      ...credentials,
    };
    let primaryError: unknown = null;
    let result: GitVerificationResult | null = null;
    try {
      await writePrivateFile(askpassPath, ASKPASS_SCRIPT);
      const remote = await runGit(["ls-remote", "--symref", input.repositoryUrl, "HEAD"], { env: environment, timeoutMs });
      result = parseGitLsRemote(remote.stdout);
      await runGit(["init", "--quiet", checkoutPath], { env: environment, timeoutMs });
      await runGit(["-C", checkoutPath, "remote", "add", "origin", input.repositoryUrl], { env: environment, timeoutMs });
      await runGit(["-C", checkoutPath, "fetch", "--depth=1", "origin", result.defaultBranch], { env: environment, timeoutMs });
      const fetched = await runGit(["-C", checkoutPath, "rev-parse", "FETCH_HEAD"], { env: environment, timeoutMs });
      const headSha = fetched.stdout.trim();
      if (!/^[a-f0-9]{40,64}$/u.test(headSha)) throw verificationError("verification_failed", "Git repository did not return a valid HEAD commit");
      result = { ...result, headSha };
    } catch (error) {
      const code = error && typeof error === "object" && typeof Reflect.get(error, "code") === "string"
        ? String(Reflect.get(error, "code"))
        : "";
      primaryError = code ? safeVerificationError(code) : classifyGitFailure(error);
    } finally {
      try {
        await removePath(root);
      } catch {
        throw verificationError("secret_cleanup_failed", "Temporary Git credential cleanup failed");
      }
    }
    if (primaryError) throw primaryError;
    if (!result) throw verificationError("verification_failed", "Git repository verification failed");
    return result;
  };
}

export function createRepositoryVerificationHandler(
  dependencies: RepositoryVerificationDependencies = defaultDependencies,
) {
  return async (payload: unknown): Promise<void> => {
    const job: RepositoryVerificationJob = repositoryVerificationJobSchema.parse(payload);
    const target = await dependencies.loadTarget({ projectId: job.projectId, expectedVersion: job.expectedVersion });
    if (!target) return;
    const saveVerification = async (verification: RepositoryVerificationResult) => {
      try {
        await dependencies.saveVerification({
          projectId: target.projectId,
          expectedVersion: target.version,
          verification,
        });
      } catch (error) {
        if (error && typeof error === "object" && Reflect.get(error, "code") === "version_conflict") return;
        throw error;
      }
    };
    const configuration = target.configuration;
    if (configuration.provider === "private") {
      let host = "";
      try {
        host = repositoryHost(target.repositoryUrl);
      } catch {
        await saveVerification(failureResult("private_host_not_allowed"));
        return;
      }
      if (!configuration.privateBaseUrl || repositoryHost(`${configuration.privateBaseUrl}/placeholder`) !== host || !dependencies.privateHostAllowlist.includes(host)) {
        await saveVerification(failureResult("private_host_not_allowed"));
        return;
      }
    }
    if (!dependencies.executor) {
      await saveVerification(failureResult("executor_not_configured", "executor_not_configured"));
      return;
    }
    const secretNames = repositoryCredentialSecretNames(configuration.authMode);
    const secrets = await dependencies.resolveSecrets({ projectId: target.projectId, names: secretNames });
    const username = secrets.HT_GIT_USERNAME?.trim() ?? "";
    const secret = (configuration.authMode === "project_token" ? secrets.HT_GIT_TOKEN : secrets.HT_GIT_PASSWORD)?.trim() ?? "";
    if (!username || !secret) {
      await saveVerification(failureResult("credential_rejected"));
      return;
    }
    let result: RepositoryVerificationResult;
    try {
      const verified = await dependencies.executor({
        repositoryUrl: target.repositoryUrl,
        provider: configuration.provider,
        authMode: configuration.authMode,
        username,
        secret,
      });
      result = job.expectedDefaultBranch && verified.defaultBranch !== job.expectedDefaultBranch
        ? failureResult("default_branch_unavailable")
        : {
            status: "passed",
            verifiedAt: dependencies.now().toISOString(),
            defaultBranch: verified.defaultBranch,
            headSha: verified.headSha,
            failureCode: null,
            apiChecked: false,
          };
    } catch (error) {
      result = failureResult(failureCode(error));
    }
    await saveVerification(result);
  };
}

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { access, chmod, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import type { WorkerExecutionSnapshot } from "./worker-runtime";
import { isValidWorkerBranchName, matchesWorkerBranchPattern } from "@humanthread/shared";

const execFileAsync = promisify(execFile);

function worktreeError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function validateRepositoryUrl(value: string): void {
  if (!value.trim() || value.length > 1_024 || /[\u0000-\u001f\u007f\s]/u.test(value)) {
    throw worktreeError("configuration_required", "Worker repository URL is invalid");
  }
  if (/^https?:\/\//u.test(value)) {
    let parsed: URL;
    try { parsed = new URL(value); } catch { throw worktreeError("configuration_required", "Worker repository URL is invalid"); }
    if (parsed.username || parsed.password) throw worktreeError("configuration_required", "Worker repository URL must not embed credentials");
    return;
  }
  if (/^ssh:\/\//u.test(value)) {
    let parsed: URL;
    try { parsed = new URL(value); } catch { throw worktreeError("configuration_required", "Worker repository URL is invalid"); }
    if (!parsed.hostname || parsed.username || parsed.password) {
      throw worktreeError("configuration_required", "Worker repository URL must not embed credentials");
    }
    return;
  }
  if (!/^(?:ssh:\/\/|git@[A-Za-z0-9.-]+:)[^\s]+$/u.test(value)) {
    throw worktreeError("configuration_required", "Worker repository URL must use HTTPS or SSH");
  }
}

function validateBranch(branch: string, allowedBranches: readonly string[]): void {
  if (!isValidWorkerBranchName(branch) || !allowedBranches.some((pattern) => matchesWorkerBranchPattern(branch, pattern))) {
    throw worktreeError("configuration_required", "Worker branch is outside the frozen branch policy");
  }
}

const GIT_ASKPASS_SCRIPT = `#!/bin/sh
set -eu
case "\${1:-}" in
  *Username*) printf '%s\\n' "$HT_GIT_USERNAME" ;;
  *) printf '%s\\n' "$HT_GIT_SECRET" ;;
esac
`;

export type WorkerWorktreePreparation = {
  cwd: string;
  gitEnvironment?: Record<string, string>;
  inspectDelivery?: () => Promise<WorkerDeliveryEvidence>;
  cleanup?: () => Promise<void>;
};

/**
 * Real worktree boundaries reported while preparing a task workspace. The
 * Worker runtime turns each one into a display-only phase frame; no repository
 * URL, credential or command line may be included.
 */
export type WorkerWorktreePhaseEvent = {
  phase: "git.fetch" | "worktree.prepare" | "checkout.verify";
  status: "running" | "succeeded" | "failed";
  action?: "create" | "reuse" | "reset";
  code?: string | null;
};

export type WorkerDeliveryEvidence = {
  branch: string;
  baseCommit: string | null;
  headCommit: string | null;
  remoteHeadCommit: string | null;
  commits: Array<{ sha: string; subject: string }>;
  changedFiles: string[];
  clean: boolean;
};

type WorktreeMetadata = {
  version: 1;
  cache: string;
  repositoryUrl: string;
  branch: string;
  identity: string;
  baseCommit: string | null;
  /**
   * Stable identity of the Loop run that owns this checkout. A task branch can
   * be shared (for example the `main` fallback when a task declares no branch),
   * so the repository URL and branch alone cannot prove that two assignments
   * belong to the same run. Without this guard a later run could reuse another
   * run's uncommitted output.
   */
  workspaceKey?: string;
};

/**
 * Status of the agent-visible workspace. The Worker keeps its own exclusive
 * lock inside the checkout, so that path must never count as uncommitted agent
 * output or as a delivery failure.
 */
const WORKTREE_STATUS_ARGUMENTS = (worktree: string): string[] => [
  "-C",
  worktree,
  "status",
  "--porcelain",
  "--",
  ".",
  ":(exclude).humanthread.lock",
];

function taskWorktreeKey(repositoryUrl: string, branch: string): string {
  return createHash("sha256").update(repositoryUrl).update("\u0000").update(branch).digest("hex");
}

function baseGitEnvironment(environment: NodeJS.ProcessEnv): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of ["PATH", "LANG", "TZ"] as const) {
    const value = environment[key];
    if (value) result[key] = value;
  }
  return result;
}

function gitConfigEnvironment(stateDirectory: string): Record<string, string> {
  // Worker images mount the home directory read-only; keep repository trust
  // configuration on the writable worker state volume instead.
  return { GIT_CONFIG_GLOBAL: join(stateDirectory, "gitconfig") };
}

/**
 * Transient transport faults a retry can recover from. GitHub intermittently
 * resets TLS mid-fetch (`GnuTLS recv error (-110)`, empty reply, connection
 * reset) and DNS/connect timeouts also clear on their own. Permanent failures
 * such as bad credentials or a missing ref are deliberately excluded so we do
 * not retry work that can never succeed.
 */
const TRANSIENT_GIT_TRANSPORT_ERROR =
  /GnuTLS recv error|gnutls_handshake|TLS connection was non-properly terminated|SSL_ERROR_SYSCALL|OpenSSL SSL_read|LibreSSL SSL_read|Recv failure: Connection reset|Connection reset by peer|Empty reply from server|Operation timed out|Failed to connect to [^\s]+ port \d+|Could not resolve host|early EOF|RPC failed|HTTP\/[0-9.]+ [45][0-9]{2}/iu;

function isTransientGitTransportError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return TRANSIENT_GIT_TRANSPORT_ERROR.test(message);
}

function gitCommitIdentityEnvironment(environment: NodeJS.ProcessEnv): Record<string, string> {
  const authorName = environment.GIT_AUTHOR_NAME?.trim() ?? "";
  const authorEmail = environment.GIT_AUTHOR_EMAIL?.trim() ?? "";
  const committerName = environment.GIT_COMMITTER_NAME?.trim() ?? "";
  const committerEmail = environment.GIT_COMMITTER_EMAIL?.trim() ?? "";
  if ((!authorName && authorEmail) || (authorName && !authorEmail)) {
    throw worktreeError("configuration_required", "GIT_AUTHOR_NAME and GIT_AUTHOR_EMAIL must be configured together");
  }
  if ((!committerName && committerEmail) || (committerName && !committerEmail)) {
    throw worktreeError("configuration_required", "GIT_COMMITTER_NAME and GIT_COMMITTER_EMAIL must be configured together");
  }
  if (!authorName && (committerName || committerEmail)) {
    throw worktreeError("configuration_required", "Git committer identity requires a Git author identity");
  }
  if (!authorName) return {};
  return {
    GIT_AUTHOR_NAME: authorName,
    GIT_AUTHOR_EMAIL: authorEmail,
    GIT_COMMITTER_NAME: committerName || authorName,
    GIT_COMMITTER_EMAIL: committerEmail || authorEmail,
  };
}

function gitCredentialEnvironment(environment: NodeJS.ProcessEnv, askpassPath: string): Record<string, string> | null {
  const username = environment.HT_GIT_USERNAME?.trim() ?? "";
  const secret = environment.HT_GIT_SECRET?.trim()
    || environment.HT_GIT_TOKEN?.trim()
    || environment.HT_GIT_PASSWORD?.trim()
    || "";
  if (!username && !secret) return null;
  if (!username || !secret) {
    throw worktreeError("configuration_required", "HT_GIT_USERNAME and HT_GIT_SECRET must be configured together");
  }
  const result: Record<string, string> = {
    ...baseGitEnvironment(environment),
    GIT_ASKPASS: askpassPath,
    GIT_TERMINAL_PROMPT: "0",
    HT_GIT_USERNAME: username,
    HT_GIT_SECRET: secret,
  };
  return result;
}

export function createWorkerWorktreeManager(dependencies: {
  stateDirectory: string;
  runtime?: "docker" | "kubernetes";
  taskRoot?: string;
  acquireTaskLock?: (lockPath: string, owner: string) => Promise<() => Promise<void>>;
  exists?: (path: string) => Promise<boolean>;
  mkdir?: (path: string) => Promise<void>;
  runGit?: (arguments_: string[], options?: { env: NodeJS.ProcessEnv }) => Promise<void>;
  writePrivateFile?: (path: string, content: string) => Promise<void>;
  readPrivateFile?: (path: string) => Promise<string>;
  removePath?: (path: string) => Promise<void>;
    captureGit?: (arguments_: string[], env: NodeJS.ProcessEnv) => Promise<string>;
    environment?: NodeJS.ProcessEnv;
    /** Injectable delay so retry tests do not wait on the real backoff. */
    sleep?: (milliseconds: number) => Promise<void>;
  }) {
  if (!dependencies.stateDirectory.startsWith("/")) {
    throw worktreeError("invalid_arguments", "Worker state directory must be absolute");
  }
  const exists = dependencies.exists ?? (async (path: string) => {
    try { await access(path); return true; } catch { return false; }
  });
  const makeDirectory = dependencies.mkdir ?? (async (path: string) => { await mkdir(path, { recursive: true, mode: 0o700 }); });
  const runGit = dependencies.runGit ?? (async (arguments_: string[], options?: { env: NodeJS.ProcessEnv }) => {
    await execFileAsync("git", arguments_, { maxBuffer: 4 * 1024 * 1024, ...(options ? { env: options.env } : {}) });
  });
  const writePrivateFile = dependencies.writePrivateFile ?? (async (path: string, content: string) => {
    await makeDirectory(dirname(path));
    await writeFile(path, content, { encoding: "utf8", mode: 0o700 });
    await chmod(path, 0o700);
  });
  const readPrivateFile = dependencies.readPrivateFile ?? ((path: string) => readFile(path, "utf8"));
  const removePath = dependencies.removePath ?? ((path: string) => rm(path, { recursive: true, force: true }));
  const environment = dependencies.environment ?? process.env;
  const runtime = dependencies.runtime ?? "docker";
  const acquireTaskLock = dependencies.acquireTaskLock ?? (async (lockPath: string, owner: string) => {
    const lockLeaseMs = 2 * 60 * 1_000;
    try {
      await mkdir(lockPath, { recursive: false, mode: 0o700 });
      await writePrivateFile(join(lockPath, "owner.json"), JSON.stringify({ owner, expiresAt: Date.now() + lockLeaseMs }));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        try {
          const persisted = JSON.parse(await readFile(join(lockPath, "owner.json"), "utf8")) as { expiresAt?: unknown };
          if (typeof persisted.expiresAt === "number" && persisted.expiresAt <= Date.now()) {
            await removePath(lockPath);
            await mkdir(lockPath, { recursive: false, mode: 0o700 });
            await writePrivateFile(join(lockPath, "owner.json"), JSON.stringify({ owner, expiresAt: Date.now() + lockLeaseMs }));
          } else {
            throw worktreeError("task_workspace_locked", "Kubernetes task workspace is held by another active Worker");
          }
        } catch (recoveryError) {
          if (recoveryError && typeof recoveryError === "object" && Reflect.get(recoveryError, "code") === "task_workspace_locked") throw recoveryError;
          throw worktreeError("task_workspace_locked", "Kubernetes task workspace is held by another active Worker");
        }
      } else {
        throw error;
      }
    }
    return async () => { await removePath(lockPath).catch(() => undefined); };
  });

  const captureGitDefault = async (arguments_: string[], env: NodeJS.ProcessEnv): Promise<string> => {
    const result = await execFileAsync("git", arguments_, {
      env,
      maxBuffer: 4 * 1024 * 1024,
    });
    return result.stdout.trim();
  };
  const captureGit = dependencies.captureGit ?? captureGitDefault;
  const sleep = dependencies.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    timer.unref?.();
  }));

  return {
    async prepare(input: {
      agentRunId: string;
      repository: WorkerExecutionSnapshot["repository"];
      workspaceKey?: string;
      environment?: NodeJS.ProcessEnv;
      reportPhase?: (event: WorkerWorktreePhaseEvent) => void | Promise<void>;
    }): Promise<WorkerWorktreePreparation> {
      if (!/^[A-Za-z0-9:_-]{1,128}$/u.test(input.agentRunId)) {
        throw worktreeError("configuration_required", "Worker assignment ID is invalid");
      }
      validateRepositoryUrl(input.repository.url);
      validateBranch(input.repository.branch, input.repository.branchPolicy.allowedBranches);
      const cacheId = createHash("sha256").update(input.repository.url).digest("hex");
      const repositoriesDirectory = join(dependencies.stateDirectory, "repositories");
      const worktreesDirectory = runtime === "kubernetes"
        ? (dependencies.taskRoot ?? join(dependencies.stateDirectory, "tasks"))
        : join(dependencies.stateDirectory, "worktrees");
      // A task's task branch is stable across attempts. Binding this directory
      // to a transient AgentRun made a cancelled attempt block the retry with a
      // second checkout of the same branch.
      const taskKey = taskWorktreeKey(input.repository.url, input.repository.branch);
      const worktreeName = `task-${taskKey}`;
      const metadataPath = join(worktreesDirectory, `${worktreeName}.metadata.json`);
      const askpassPath = join(dependencies.stateDirectory, "git-askpass.sh");
      const cache = join(repositoriesDirectory, `${cacheId}.git`);
      const worktree = join(worktreesDirectory, worktreeName);
      const lockPath = join(worktree, ".humanthread.lock");
      const legacyWorktree = join(worktreesDirectory, input.agentRunId);
      const legacyMetadataPath = join(worktreesDirectory, `${input.agentRunId}.metadata.json`);
      await Promise.all([makeDirectory(repositoriesDirectory), makeDirectory(worktreesDirectory)]);
      const executionEnvironment = { ...environment, ...(input.environment ?? {}) };
      const gitIdentity = gitCommitIdentityEnvironment(executionEnvironment);
      const gitCredentials = gitCredentialEnvironment(executionEnvironment, askpassPath);
      const gitTransport = gitCredentials ?? (/^https?:\/\//u.test(input.repository.url)
        ? { GIT_TERMINAL_PROMPT: "0" }
        : {});
      const gitEnvironment = {
        ...gitConfigEnvironment(dependencies.stateDirectory),
        ...gitIdentity,
        ...gitTransport,
      };
      if (gitCredentials) await writePrivateFile(askpassPath, GIT_ASKPASS_SCRIPT);
      const executeGit = (arguments_: string[]) => gitEnvironment
        ? runGit(arguments_, { env: gitEnvironment })
        : runGit(arguments_);
      const reportPhase = async (event: WorkerWorktreePhaseEvent): Promise<void> => {
        try {
          await input.reportPhase?.(event);
        } catch {
          // Phase reporting is observability only and must never fail a
          // worktree preparation that is otherwise healthy.
        }
      };
      const identity = createHash("sha256").update(JSON.stringify({
        authorName: gitIdentity.GIT_AUTHOR_NAME ?? "",
        authorEmail: gitIdentity.GIT_AUTHOR_EMAIL ?? "",
        committerName: gitIdentity.GIT_COMMITTER_NAME ?? "",
        committerEmail: gitIdentity.GIT_COMMITTER_EMAIL ?? "",
      })).digest("hex");
      const cleanupExisting = async () => {
        // A task branch is shared by every stage of the same Loop run. Earlier
        // stages legitimately finish with uncommitted output (planning files,
        // drafts, reports) before a later stage commits. Removing the worktree
        // here deleted that output and made the next stage observe an empty
        // workspace, so preserve anything that still holds local work.
        const localWork = await captureGit(
          WORKTREE_STATUS_ARGUMENTS(worktree),
          { ...environment, ...gitEnvironment },
        ).catch(() => "");
        if (localWork !== "") {
          const preserved = `${worktree}-preserved-${Date.now()}`;
          await executeGit(["--git-dir", cache, "worktree", "move", worktree, preserved]).catch(() => undefined);
          await removePath(metadataPath).catch(() => undefined);
          return;
        }
        await executeGit(["--git-dir", cache, "worktree", "remove", "--force", worktree]).catch(() => undefined);
        await removePath(worktree).catch(() => undefined);
        await removePath(metadataPath).catch(() => undefined);
      };
      const cleanupLegacy = async () => {
        await executeGit(["--git-dir", cache, "worktree", "remove", "--force", legacyWorktree]).catch(() => undefined);
        await removePath(legacyWorktree).catch(() => undefined);
        await removePath(legacyMetadataPath).catch(() => undefined);
      };
      const fetchTaskBranch = async (): Promise<string> => {
        let fetchedRef = `origin/${input.repository.branch}`;
        // GitHub intermittently resets TLS mid-fetch. Without a retry a single
        // transient reset fails the whole assignment, which is exactly the
        // `GnuTLS recv error (-110)` failure operators saw. Retry only
        // transport faults, with bounded exponential backoff, so credentials
        // and missing-ref errors still fail fast.
        const maxFetchAttempts = 3;
        try {
          await reportPhase({ phase: "git.fetch", status: "running" });
          for (let attempt = 1; ; attempt += 1) {
            try {
              await executeGit([
                "-C", cache,
                "fetch", "--prune", "--no-tags", "--refmap=", "origin",
                `+refs/heads/${input.repository.branch}:refs/remotes/origin/${input.repository.branch}`,
              ]);
              break;
            } catch (error) {
              if (attempt >= maxFetchAttempts || !isTransientGitTransportError(error)) throw error;
              await sleep(500 * 2 ** (attempt - 1));
            }
          }
        } catch (error) {
          await reportPhase({
            phase: "git.fetch",
            status: "failed",
            code: error && typeof error === "object" && typeof Reflect.get(error, "code") === "string"
              ? String(Reflect.get(error, "code"))
              : "git_fetch_failed",
          });
          const errorText = error instanceof Error ? error.message : String(error);
          if (/couldn't find remote ref|remote ref does not exist|no such remote ref/u.test(errorText)) {
            await executeGit(["-C", cache, "fetch", "--prune", "--no-tags", "--refmap=", "origin", "+refs/heads/*:refs/remotes/origin/*"]);
            for (const candidate of ["main", "master"]) {
              const ref = `refs/remotes/origin/${candidate}`;
              const commit = await captureGit(["--git-dir", cache, "rev-parse", ref], { ...environment, ...gitEnvironment }).catch(() => "");
              if (commit) {
                fetchedRef = `origin/${candidate}`;
                await reportPhase({ phase: "git.fetch", status: "succeeded" });
                return fetchedRef;
              }
            }
            throw worktreeError("configuration_required", "Worker repository has no usable default base branch");
          }
          if (!/refusing to fetch into branch|checked out at/u.test(errorText)) throw error;
          // A checked-out branch is not a cross-run lock. The platform claim
          // serializes one task, while this stable task path is the shared
          // retry boundary. Never remove it from a fetch error: doing so can
          // discard committed progress and race an active assignment. Cache
          // migration and legacy-path cleanup happen in the explicit
          // registration reconciliation below.
          throw error;
        }
        await reportPhase({ phase: "git.fetch", status: "succeeded" });
        return fetchedRef;
      };
      if (await exists(cache)) {
        await executeGit(["--git-dir", cache, "config", "remote.origin.mirror", "false"]);
        await executeGit(["--git-dir", cache, "config", "--replace-all", "remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*"]);
        await executeGit(["--git-dir", cache, "worktree", "prune", "--expire=now"]);
      }
      if (!await exists(worktree) && await exists(legacyWorktree) && await exists(cache)) {
        const registered = await captureGit(["--git-dir", cache, "worktree", "list", "--porcelain"], { ...environment, ...gitEnvironment }).catch(() => "");
        const legacyEntry = registered.split("\n\n").find((entry) =>
          entry.includes(`worktree ${legacyWorktree}`) && entry.includes(`branch refs/heads/${input.repository.branch}`));
        if (legacyEntry) {
          await executeGit(["--git-dir", cache, "worktree", "move", legacyWorktree, worktree]);
          const legacyMetadata = await readPrivateFile(legacyMetadataPath).catch(() => null);
          if (legacyMetadata !== null) {
            await writePrivateFile(metadataPath, legacyMetadata);
            await removePath(legacyMetadataPath).catch(() => undefined);
          }
        } else {
          // A missing Git registration cannot represent a live attached
          // worktree. Remove only that legacy orphan before creating the
          // stable task directory below.
          await cleanupLegacy();
        }
      }
      if (await exists(worktree)) {
        // Refresh the exact tracking ref before inspecting reuse metadata. A
        // fetch failure is an infrastructure error, not evidence that this
        // task worktree is disposable; let it propagate without cleanup.
        await fetchTaskBranch();
        let reusable = false;
        let reusableMetadata: Partial<WorktreeMetadata> | null = null;
        let workspaceStatus = "";
        try {
          const parsed = JSON.parse(await readPrivateFile(metadataPath)) as Partial<WorktreeMetadata>;
          const registered = await captureGit(["--git-dir", cache, "worktree", "list", "--porcelain"], { ...environment, ...gitEnvironment });
          workspaceStatus = await captureGit(WORKTREE_STATUS_ARGUMENTS(worktree), { ...environment, ...gitEnvironment });
          const remoteHead = await captureGit([
            "--git-dir", cache,
            "rev-parse", `refs/remotes/origin/${input.repository.branch}`,
          ], { ...environment, ...gitEnvironment }).catch(() => "");
          const head = await captureGit(["-C", worktree, "rev-parse", "HEAD"], { ...environment, ...gitEnvironment }).catch(() => "");
          const baseIsAncestor = !parsed.baseCommit || !head
            ? false
            : await captureGit(["-C", worktree, "merge-base", "--is-ancestor", parsed.baseCommit, "HEAD"], { ...environment, ...gitEnvironment })
              .then(() => true)
              .catch(() => false);
          reusable = parsed.version === 1
            && parsed.cache === cache
            && parsed.repositoryUrl === input.repository.url
            && parsed.branch === input.repository.branch
            && parsed.identity === identity
            // Metadata written before workspace identity existed cannot prove
            // ownership. Adopt it once and persist the key below, so an
            // already-running task keeps its checkout while every later task
            // is still required to match exactly.
            && (parsed.workspaceKey === input.workspaceKey || parsed.workspaceKey === undefined)
            && (typeof parsed.baseCommit === "string" || parsed.baseCommit === null)
            && Boolean(remoteHead)
            && parsed.baseCommit === remoteHead
            && baseIsAncestor
            && registered.includes(`worktree ${worktree}`);
          // Uncommitted files are expected here: a stage may legitimately
          // leave drafts, reports or planning files for the next stage while
          // Git delivery is not required. Reusing the directory is what keeps
          // that work visible; dirtiness is reported later as delivery
          // evidence rather than treated as a reason to discard the workspace.
        if (reusable) reusableMetadata = parsed;
        } catch {
          reusable = false;
        }
        if (reusable) {
          if (reusableMetadata?.workspaceKey === undefined && input.workspaceKey !== undefined) {
            await writePrivateFile(metadataPath, JSON.stringify({
              ...reusableMetadata,
              workspaceKey: input.workspaceKey,
            })).catch(() => undefined);
          }
          await reportPhase({
            phase: "worktree.prepare",
            status: "succeeded",
            action: "reuse",
            code: workspaceStatus === "" ? null : "workspace_dirty",
          });
          const releaseTaskLock = runtime === "kubernetes" ? await acquireTaskLock(lockPath, input.agentRunId) : null;
          await executeGit(["config", "--global", "--add", "safe.directory", worktree]);
          await reportPhase({ phase: "checkout.verify", status: "succeeded" });
          return {
            cwd: worktree,
            ...(releaseTaskLock ? { cleanup: releaseTaskLock } : {}),
            ...(gitEnvironment ? { gitEnvironment } : {}),
            inspectDelivery: async () => {
              const runtimeEnvironment = { ...environment, ...gitEnvironment };
              await executeGit([
                "-C", worktree,
                "push", "origin", `HEAD:refs/heads/${input.repository.branch}`,
              ]);
              await captureGit(["-C", cache, "fetch", "--prune", "origin", `+refs/heads/${input.repository.branch}:refs/remotes/origin/${input.repository.branch}`], runtimeEnvironment);
              const baseCommit = reusableMetadata?.baseCommit ?? null;
              const [headCommit, remoteHeadCommit, commitLines, changedFiles, porcelain] = await Promise.all([
                captureGit(["-C", worktree, "rev-parse", "HEAD"], runtimeEnvironment).catch(() => ""),
                captureGit(["-C", worktree, "rev-parse", `refs/remotes/origin/${input.repository.branch}`], runtimeEnvironment).catch(() => ""),
                baseCommit ? captureGit(["-C", worktree, "log", "--format=%H%x09%s", `${baseCommit}..HEAD`], runtimeEnvironment).catch(() => "") : Promise.resolve(""),
                baseCommit ? captureGit(["-C", worktree, "diff", "--name-only", `${baseCommit}..HEAD`], runtimeEnvironment).catch(() => "") : Promise.resolve(""),
                captureGit(WORKTREE_STATUS_ARGUMENTS(worktree), runtimeEnvironment).catch(() => ""),
              ]);
              return { branch: input.repository.branch, baseCommit, headCommit: headCommit || null, remoteHeadCommit: remoteHeadCommit || null, commits: commitLines.split("\n").flatMap((line) => { const [sha, subject = ""] = line.split("\t", 2); return sha ? [{ sha, subject }] : []; }).slice(0, 100), changedFiles: changedFiles.split("\n").filter(Boolean).slice(0, 500), clean: porcelain === "" };
            },
          };
        }
        await cleanupExisting();
        await reportPhase({ phase: "worktree.prepare", status: "succeeded", action: "reset" });
      }
      if (!await exists(cache)) await executeGit(["clone", "--bare", "--", input.repository.url, cache]);
      await executeGit(["config", "--global", "--add", "safe.directory", cache]);
      // Early Worker images used `clone --mirror`, whose persisted refspec
      // maps remote heads directly onto refs/heads/*. Migrate that cache on
      // every use before fetch so an old worktree cannot block a new run.
      await executeGit(["--git-dir", cache, "config", "remote.origin.mirror", "false"]);
      await executeGit([
        "--git-dir", cache,
        "config", "--replace-all", "remote.origin.fetch",
        "+refs/heads/*:refs/remotes/origin/*",
      ]);
      // Remove registrations for worktrees whose directories disappeared
      // while the persistent cache volume survived an older assignment.
      // This keeps stale administrative metadata from blocking later fetches.
      await executeGit(["--git-dir", cache, "worktree", "prune", "--expire=now"]);
      // A bare cache can have several worktrees on the same task branch. Fetching
      // into refs/heads/<branch> is rejected while any of those worktrees is
      // checked out, so update only the remote-tracking ref and create each
      // assignment worktree from that immutable fetch result.
      const fetchedRef = await fetchTaskBranch();
      await reportPhase({ phase: "worktree.prepare", status: "running", action: "create" });
      const baseCommit = await Promise.resolve(captureGit([
        "--git-dir", cache,
        "rev-parse", fetchedRef.replace(/^origin\//u, "refs/remotes/origin/"),
      ], { ...environment, ...gitEnvironment })).then((value) => value ?? "").catch(() => "");
      // Do not attach a local branch here. A persistent cache can still have
      // the task branch attached in an older worktree; Git then creates an
      // unrelated local branch and may inherit origin/main as its upstream.
      // The assignment is pinned to the remote task-branch commit and delivery
      // always pushes the resulting detached HEAD back to that branch.
      await executeGit(["--git-dir", cache, "worktree", "add", "--force", "--detach", worktree, fetchedRef]);
      const checkedOutCommit = await captureGit(["-C", worktree, "rev-parse", "HEAD"], { ...environment, ...gitEnvironment }).catch(() => "");
      if (baseCommit && checkedOutCommit && checkedOutCommit !== baseCommit) {
        await reportPhase({
          phase: "checkout.verify",
          status: "failed",
          code: "worktree_checkout_mismatch",
        });
        await cleanupExisting();
        throw worktreeError("worktree_checkout_mismatch", "Worker worktree checkout does not match the fetched task branch");
      }
      await reportPhase({ phase: "checkout.verify", status: "succeeded" });
      await reportPhase({ phase: "worktree.prepare", status: "succeeded", action: "create" });
      const metadata: WorktreeMetadata = {
        version: 1,
        cache,
        repositoryUrl: input.repository.url,
        branch: input.repository.branch,
        identity,
        baseCommit: baseCommit || null,
        ...(input.workspaceKey === undefined ? {} : { workspaceKey: input.workspaceKey }),
      };
      // A successful real `git worktree add` creates this directory. Keep the
      // metadata sidecar coupled to that fact so an interrupted add is never
      // later treated as a reusable assignment.
      if (await exists(worktree)) {
        await writePrivateFile(metadataPath, JSON.stringify(metadata)).catch((error: unknown) => {
          // Metadata is an optimization for safe reuse. A virtualized or
          // read-only state volume must fall back to fresh cleanup next time,
          // but it must not discard a successfully-created worktree now.
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        });
      }
      // The NFS volume can retain a numeric owner that differs from the
      // container UID. Codex invokes Git from the attached worktree, so trust
      // the exact validated path as well as the bare cache.
      await executeGit(["config", "--global", "--add", "safe.directory", worktree]);
      const releaseTaskLock = runtime === "kubernetes" ? await acquireTaskLock(lockPath, input.agentRunId) : null;
      return {
        cwd: worktree,
        ...(releaseTaskLock ? { cleanup: releaseTaskLock } : {}),
        ...(gitEnvironment ? { gitEnvironment } : {}),
        inspectDelivery: async () => {
          // Fetch again after Codex exits. A local commit is not a deliverable
          // until the task branch's remote-tracking ref contains it.
          const runtimeEnvironment = { ...environment, ...gitEnvironment };
          await executeGit([
            "-C", worktree,
            "push", "origin", `HEAD:refs/heads/${input.repository.branch}`,
          ]);
          await captureGit([
            "-C", cache,
            "fetch", "--prune", "origin",
            `+refs/heads/${input.repository.branch}:refs/remotes/origin/${input.repository.branch}`,
          ], runtimeEnvironment);
          const [headCommit, remoteHeadCommit, commitLines, changedFiles, porcelain] = await Promise.all([
            captureGit(["-C", worktree, "rev-parse", "HEAD"], runtimeEnvironment).catch(() => ""),
            captureGit(["-C", worktree, "rev-parse", `refs/remotes/origin/${input.repository.branch}`], runtimeEnvironment).catch(() => ""),
            baseCommit ? captureGit(["-C", worktree, "log", "--format=%H%x09%s", `${baseCommit}..HEAD`], runtimeEnvironment).catch(() => "") : Promise.resolve(""),
            baseCommit ? captureGit(["-C", worktree, "diff", "--name-only", `${baseCommit}..HEAD`], runtimeEnvironment).catch(() => "") : Promise.resolve(""),
            captureGit(WORKTREE_STATUS_ARGUMENTS(worktree), runtimeEnvironment).catch(() => ""),
          ]);
          return {
            branch: input.repository.branch,
            baseCommit: baseCommit || null,
            headCommit: headCommit || null,
            remoteHeadCommit: remoteHeadCommit || null,
            commits: commitLines.split("\n").flatMap((line) => {
              const [sha, subject = ""] = line.split("\t", 2);
              return sha ? [{ sha, subject }] : [];
            }).slice(0, 100),
            changedFiles: changedFiles.split("\n").filter(Boolean).slice(0, 500),
            clean: porcelain === "",
          };
        },
        // The stable task path is retained after every attempt. Reuse or
        // rebuild is decided at the next prepare call from Git state, never
        // from a transient AgentRun-specific cleanup lock.
      };
    },
  };
}

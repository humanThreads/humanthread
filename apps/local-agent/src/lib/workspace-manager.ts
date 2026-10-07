import {
  assertPathInsideWorkspace,
  type NativeWorkspacePathResolver,
} from "./workspace-policy";

export interface WorkspaceCommandRunner {
  (command: string, args: string[], options: { cwd: string }): Promise<{ stdout: string; stderr: string }>;
}

export interface PrepareWorkspaceInput {
  projectPath: string;
  runId: string;
  branchName: string;
  baseRef: string;
  mode: "task";
  allowedPaths: string[];
  resourceKeys: string[];
  resolveNativePath: NativeWorkspacePathResolver;
  run: WorkspaceCommandRunner;
}

type WorktreeEntry = { path: string; branch: string | null };

function validGitBranch(value: string): boolean {
  return value.length > 0
    && value.length <= 191
    && !value.startsWith("-")
    && !value.startsWith("/")
    && !value.endsWith("/")
    && !value.endsWith(".")
    && !value.includes("..")
    && !value.includes("//")
    && !/[~^:?*\[\\\s\x00-\x1f\x7f]/u.test(value)
    && value.split("/").every((segment) => segment !== "" && !segment.endsWith(".lock"));
}

function parseWorktrees(output: string): WorktreeEntry[] {
  return output.trim().split(/\n\s*\n/u).filter(Boolean).flatMap((block) => {
    const fields = new Map(block.split("\n").map((line) => {
      const separator = line.indexOf(" ");
      return separator < 0 ? [line, ""] : [line.slice(0, separator), line.slice(separator + 1)];
    }));
    const path = fields.get("worktree");
    if (!path) return [];
    const branchRef = fields.get("branch");
    return [{ path, branch: branchRef?.startsWith("refs/heads/") ? branchRef.slice("refs/heads/".length) : null }];
  });
}

function workspaceCheckoutMismatch(message: string): Error {
  return Object.assign(new Error(message), { code: "workspace_checkout_mismatch" });
}

export async function prepareWorkspace(input: PrepareWorkspaceInput) {
  if (
    (!input.projectPath.startsWith("/") && !/^[a-z]:[\\/]/iu.test(input.projectPath))
    || !/^[A-Za-z0-9._-]{1,96}$/u.test(input.runId)
    || !validGitBranch(input.branchName)
    || !validGitBranch(input.baseRef)
    || input.allowedPaths.length === 0
  ) throw new Error("Invalid workspace input");
  const projectRealpath = await assertPathInsideWorkspace({
    workspaceRoot: input.projectPath,
    requestedPath: input.projectPath,
    resolveNativePath: input.resolveNativePath,
  });
  const path = await assertPathInsideWorkspace({
    workspaceRoot: projectRealpath,
    requestedPath: `${projectRealpath}/.worktrees/${input.branchName}`,
    resolveNativePath: input.resolveNativePath,
  });
  const options = { cwd: projectRealpath };
  await input.run("git", ["fetch", "--prune", "origin"], options);
  const remoteBase = `origin/${input.baseRef}`;
  const baseCommit = (await input.run(
    "git",
    ["rev-parse", "--verify", "--end-of-options", remoteBase],
    options,
  )).stdout.trim();
  if (!/^[a-f0-9]{7,64}$/iu.test(baseCommit)) throw new Error("Remote base ref did not resolve to a commit");

  const worktrees = parseWorktrees((await input.run("git", ["worktree", "list", "--porcelain"], options)).stdout);
  const target = worktrees.find((entry) => entry.path === path);
  if (target) {
    if (target.branch !== input.branchName) {
      throw workspaceCheckoutMismatch("Task worktree path is checked out on another branch");
    }
    return {
      id: `workspace:${input.runId}`,
      path,
      branchName: input.branchName,
      baseCommit,
      allowedPaths: input.allowedPaths,
      resourceKeys: input.resourceKeys,
      status: "ready" as const,
      reused: true,
    };
  }
  const branchWorktree = worktrees.find((entry) => entry.branch === input.branchName);
  if (branchWorktree) {
    // Task branches have one canonical worktree path. Move a legacy path left
    // by a failed run before reusing the branch instead of treating it as a
    // cross-run lock.
    await input.run("git", ["worktree", "move", branchWorktree.path, path], options);
    return {
      id: `workspace:${input.runId}`,
      path,
      branchName: input.branchName,
      baseCommit,
      allowedPaths: input.allowedPaths,
      resourceKeys: input.resourceKeys,
      status: "ready" as const,
      reused: true,
    };
  }

  const localBranchRef = `refs/heads/${input.branchName}`;
  const remoteBranchRef = `refs/remotes/origin/${input.branchName}`;
  const refs = new Set((await input.run(
    "git",
    ["for-each-ref", "--format=%(refname)", localBranchRef, remoteBranchRef],
    options,
  )).stdout.split("\n").filter(Boolean));
  if (refs.has(localBranchRef)) {
    await input.run("git", ["worktree", "add", path, input.branchName], options);
  } else {
    const startPoint = refs.has(remoteBranchRef) ? `origin/${input.branchName}` : remoteBase;
    await input.run("git", ["worktree", "add", "-b", input.branchName, path, startPoint], options);
  }
  return {
    id: `workspace:${input.runId}`,
    path,
    branchName: input.branchName,
    baseCommit,
    allowedPaths: input.allowedPaths,
    resourceKeys: input.resourceKeys,
    status: "ready" as const,
    reused: refs.has(localBranchRef) || refs.has(remoteBranchRef),
  };
}

export async function cleanupWorkspace(input: { projectPath: string; path: string; preserveOnFailure: boolean; failed: boolean; resolveNativePath: NativeWorkspacePathResolver; run: WorkspaceCommandRunner }) {
  if (input.failed && input.preserveOnFailure) return { status: "quarantined" as const };
  const projectRealpath = await assertPathInsideWorkspace({
    workspaceRoot: input.projectPath,
    requestedPath: input.projectPath,
    resolveNativePath: input.resolveNativePath,
  });
  const path = await assertPathInsideWorkspace({
    workspaceRoot: projectRealpath,
    requestedPath: input.path,
    resolveNativePath: input.resolveNativePath,
  });
  await input.run("git", ["worktree", "remove", path], { cwd: projectRealpath });
  return { status: "discarded" as const };
}

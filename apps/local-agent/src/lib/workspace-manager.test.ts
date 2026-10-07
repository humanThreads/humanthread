import { describe, expect, it, vi } from "vitest";
import { cleanupWorkspace, prepareWorkspace } from "./workspace-manager";

describe("prepareWorkspace", () => {
  it("fetches staging and creates the declared Task branch in an isolated worktree", async () => {
    const run = vi.fn(async (_command: string, args: string[]) => ({
      stdout: args[0] === "rev-parse" ? `${"a".repeat(40)}\n` : "",
      stderr: "",
    }));
    const resolveNativePath = vi.fn()
      .mockResolvedValueOnce({ workspaceRealpath: "/Volumes/code/repo", targetRealpath: "/Volumes/code/repo", contained: true })
      .mockResolvedValueOnce({ workspaceRealpath: "/Volumes/code/repo", targetRealpath: "/Volumes/code/repo/.worktrees/2026-HT100023", contained: true });
    await expect(prepareWorkspace({
      projectPath: "/repo-link",
      runId: "run_1",
      branchName: "2026-HT100023",
      baseRef: "staging",
      mode: "task",
      allowedPaths: ["apps/web/**"],
      resourceKeys: ["web"],
      resolveNativePath,
      run,
    })).resolves.toMatchObject({
      branchName: "2026-HT100023",
      baseCommit: "a".repeat(40),
      path: "/Volumes/code/repo/.worktrees/2026-HT100023",
    });
    expect(run.mock.calls).toEqual([
      ["git", ["fetch", "--prune", "origin"], { cwd: "/Volumes/code/repo" }],
      ["git", ["rev-parse", "--verify", "--end-of-options", "origin/staging"], { cwd: "/Volumes/code/repo" }],
      ["git", ["worktree", "list", "--porcelain"], { cwd: "/Volumes/code/repo" }],
      ["git", ["for-each-ref", "--format=%(refname)", "refs/heads/2026-HT100023", "refs/remotes/origin/2026-HT100023"], { cwd: "/Volumes/code/repo" }],
      ["git", ["worktree", "add", "-b", "2026-HT100023", "/Volumes/code/repo/.worktrees/2026-HT100023", "origin/staging"], { cwd: "/Volumes/code/repo" }],
    ]);
  });

  it("reuses only the same Task worktree and branch identity", async () => {
    const worktreePath = "/Volumes/code/repo/.worktrees/2026-HT100023";
    const run = vi.fn(async (_command: string, args: string[]) => ({
      stdout: args[0] === "rev-parse"
        ? `${"a".repeat(40)}\n`
        : args[0] === "worktree"
          ? `worktree /Volumes/code/repo\nHEAD 1111111\nbranch refs/heads/staging\n\nworktree ${worktreePath}\nHEAD 2222222\nbranch refs/heads/2026-HT100023\n`
          : "",
      stderr: "",
    }));
    const resolveNativePath = vi.fn()
      .mockResolvedValueOnce({ workspaceRealpath: "/Volumes/code/repo", targetRealpath: "/Volumes/code/repo", contained: true })
      .mockResolvedValueOnce({ workspaceRealpath: "/Volumes/code/repo", targetRealpath: worktreePath, contained: true });

    await expect(prepareWorkspace({
      projectPath: "/repo-link", runId: "run_1", branchName: "2026-HT100023", baseRef: "staging", mode: "task",
      allowedPaths: ["apps/web/**"], resourceKeys: ["web"], resolveNativePath, run,
    })).resolves.toMatchObject({ path: worktreePath, branchName: "2026-HT100023", reused: true });
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("resumes an existing remote Task branch instead of recreating it from staging", async () => {
    const worktreePath = "/Volumes/code/repo/.worktrees/2026-HT100023";
    const run = vi.fn(async (_command: string, args: string[]) => ({
      stdout: args[0] === "rev-parse"
        ? `${"a".repeat(40)}\n`
        : args[0] === "for-each-ref"
          ? "refs/remotes/origin/2026-HT100023\n"
          : "",
      stderr: "",
    }));
    const resolveNativePath = vi.fn()
      .mockResolvedValueOnce({ workspaceRealpath: "/Volumes/code/repo", targetRealpath: "/Volumes/code/repo", contained: true })
      .mockResolvedValueOnce({ workspaceRealpath: "/Volumes/code/repo", targetRealpath: worktreePath, contained: true });

    await prepareWorkspace({
      projectPath: "/repo-link", runId: "run_2", branchName: "2026-HT100023", baseRef: "staging", mode: "task",
      allowedPaths: ["apps/web/**"], resourceKeys: ["web"], resolveNativePath, run,
    });

    expect(run).toHaveBeenLastCalledWith(
      "git",
      ["worktree", "add", "-b", "2026-HT100023", worktreePath, "origin/2026-HT100023"],
      { cwd: "/Volumes/code/repo" },
    );
  });

  it("moves a registered legacy task branch to its stable worktree path", async () => {
    const worktreePath = "/Volumes/code/repo/.worktrees/2026-HT100023";
    const legacyPath = "/Volumes/code/repo/.worktrees/agent_run_failed";
    const run = vi.fn(async (_command: string, args: string[]) => ({
      stdout: args[0] === "rev-parse"
        ? `${"a".repeat(40)}\n`
        : args[0] === "worktree"
          ? `worktree /Volumes/code/repo\nHEAD 1111111\nbranch refs/heads/staging\n\nworktree ${legacyPath}\nHEAD 2222222\nbranch refs/heads/2026-HT100023\n`
          : "",
      stderr: "",
    }));
    const resolveNativePath = vi.fn()
      .mockResolvedValueOnce({ workspaceRealpath: "/Volumes/code/repo", targetRealpath: "/Volumes/code/repo", contained: true })
      .mockResolvedValueOnce({ workspaceRealpath: "/Volumes/code/repo", targetRealpath: worktreePath, contained: true });

    await expect(prepareWorkspace({
      projectPath: "/repo-link", runId: "run_retry", branchName: "2026-HT100023", baseRef: "staging", mode: "task",
      allowedPaths: ["apps/web/**"], resourceKeys: ["web"], resolveNativePath, run,
    })).resolves.toMatchObject({ path: worktreePath, branchName: "2026-HT100023", reused: true });

    expect(run).toHaveBeenCalledWith(
      "git",
      ["worktree", "move", legacyPath, worktreePath],
      { cwd: "/Volumes/code/repo" },
    );
  });

  it("rejects cleanup when the native target escapes the project Workspace", async () => {
    const run = vi.fn();
    await expect(cleanupWorkspace({
      projectPath: "/repo",
      path: "/repo/.worktrees/2026-HT100023",
      preserveOnFailure: false,
      failed: false,
      resolveNativePath: async () => ({
        workspaceRealpath: "/repo",
        targetRealpath: "/private/outside/run_1",
        contained: false,
      }),
      run,
    })).rejects.toMatchObject({ code: "workspace_scope_denied" });
    expect(run).not.toHaveBeenCalled();
  });
});

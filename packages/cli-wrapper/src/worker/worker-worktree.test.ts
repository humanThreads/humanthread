import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { createWorkerWorktreeManager } from "./worker-worktree";

function stableWorktreePath(url: string, branch: string): string {
  const taskKey = createHash("sha256").update(url).update("\u0000").update(branch).digest("hex");
  return `/state/worktrees/task-${taskKey}`;
}

describe("Linux Worker worktree manager", () => {
  it("reports distinguishable git.fetch and worktree.prepare boundaries", async () => {
    const phases: Array<{ phase: string; status: string; action?: string; code?: string | null }> = [];
    const manager = createWorkerWorktreeManager({
      stateDirectory: "/state",
      exists: vi.fn().mockResolvedValue(false),
      mkdir: vi.fn().mockResolvedValue(undefined),
      runGit: vi.fn().mockResolvedValue(undefined),
    });

    await manager.prepare({
      agentRunId: "agent_run_1",
      repository: {
        url: "https://git.example.com/acme/project.git",
        branch: "2026-HUMANTHR1100008",
        branchPolicy: { allowedBranches: ["*HUMANTHR*"] },
      },
      reportPhase: (event) => { phases.push(event); },
    });

    expect(phases).toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: "git.fetch", status: "running" }),
      expect.objectContaining({ phase: "git.fetch", status: "succeeded" }),
      expect.objectContaining({ phase: "worktree.prepare", status: "running", action: "create" }),
      expect.objectContaining({ phase: "worktree.prepare", status: "succeeded", action: "create" }),
      expect.objectContaining({ phase: "checkout.verify", status: "succeeded" }),
    ]));
  });

  it("reports a failed git.fetch boundary before rethrowing an unrelated fetch failure", async () => {
    const phases: Array<{ phase: string; status: string; code?: string | null }> = [];
    const runGit = vi.fn().mockImplementation(async (arguments_: string[]) => {
      if (arguments_.includes("fetch")) throw Object.assign(new Error("network down"), { code: "git_fetch_failed" });
    });
    const manager = createWorkerWorktreeManager({
      stateDirectory: "/state",
      exists: vi.fn().mockImplementation(async (path: string) => path.includes("repositories")),
      mkdir: vi.fn().mockResolvedValue(undefined),
      runGit,
      captureGit: vi.fn().mockResolvedValue(""),
      readPrivateFile: vi.fn().mockResolvedValue(""),
      removePath: vi.fn().mockResolvedValue(undefined),
    });

    await expect(manager.prepare({
      agentRunId: "agent_run_1",
      repository: {
        url: "https://git.example.com/acme/project.git",
        branch: "2026-HUMANTHR1100008",
        branchPolicy: { allowedBranches: ["*HUMANTHR*"] },
      },
      reportPhase: (event) => { phases.push(event); },
    })).rejects.toMatchObject({ code: "git_fetch_failed" });

    expect(phases).toContainEqual(expect.objectContaining({ phase: "git.fetch", status: "failed" }));
  });

  it("retries a transient TLS reset during git fetch instead of failing the attempt", async () => {
    const phases: Array<{ phase: string; status: string; code?: string | null }> = [];
    let fetchAttempts = 0;
    const runGit = vi.fn().mockImplementation(async (arguments_: string[]) => {
      if (!arguments_.includes("fetch")) return;
      fetchAttempts += 1;
      if (fetchAttempts === 1) {
        // Exactly what the production Worker saw from GitHub: an intermittent
        // TLS reset that succeeds on an immediate retry.
        throw new Error(
          "Command failed: git fetch\n"
          + "fatal: unable to access 'https://github.com/acme/project.git/': "
          + "GnuTLS recv error (-110): The TLS connection was non-properly terminated.",
        );
      }
    });
    const manager = createWorkerWorktreeManager({
      stateDirectory: "/state",
      exists: vi.fn().mockImplementation(async (path: string) => path.includes("repositories")),
      mkdir: vi.fn().mockResolvedValue(undefined),
      runGit,
      captureGit: vi.fn().mockResolvedValue(""),
      readPrivateFile: vi.fn().mockResolvedValue(""),
      removePath: vi.fn().mockResolvedValue(undefined),
      sleep: vi.fn().mockResolvedValue(undefined),
    });

    await manager.prepare({
      agentRunId: "agent_run_tls_retry",
      repository: {
        url: "https://github.com/acme/project.git",
        branch: "2026-HUMANTHR1100008",
        branchPolicy: { allowedBranches: ["*HUMANTHR*"] },
      },
      reportPhase: (event) => { phases.push(event); },
    });

    expect(fetchAttempts).toBe(2);
    expect(phases).toContainEqual(expect.objectContaining({ phase: "git.fetch", status: "succeeded" }));
  });

  it("does not retry a permanent git fetch failure", async () => {
    let fetchAttempts = 0;
    const runGit = vi.fn().mockImplementation(async (arguments_: string[]) => {
      if (!arguments_.includes("fetch")) return;
      fetchAttempts += 1;
      throw new Error("fatal: Authentication failed for 'https://github.com/acme/project.git/'");
    });
    const manager = createWorkerWorktreeManager({
      stateDirectory: "/state",
      exists: vi.fn().mockImplementation(async (path: string) => path.includes("repositories")),
      mkdir: vi.fn().mockResolvedValue(undefined),
      runGit,
      captureGit: vi.fn().mockResolvedValue(""),
      readPrivateFile: vi.fn().mockResolvedValue(""),
      removePath: vi.fn().mockResolvedValue(undefined),
      sleep: vi.fn().mockResolvedValue(undefined),
    });

    await expect(manager.prepare({
      agentRunId: "agent_run_auth_failure",
      repository: {
        url: "https://github.com/acme/project.git",
        branch: "2026-HUMANTHR1100008",
        branchPolicy: { allowedBranches: ["*HUMANTHR*"] },
      },
    })).rejects.toThrow(/Authentication failed/u);

    expect(fetchAttempts).toBe(1);
  });

  it("uses one stable worktree for retries of the same repository task branch", async () => {
    const runGit = vi.fn().mockResolvedValue(undefined);
    const manager = createWorkerWorktreeManager({
      stateDirectory: "/state",
      exists: vi.fn().mockResolvedValue(false),
      mkdir: vi.fn().mockResolvedValue(undefined),
      runGit,
    });
    const repository = {
      url: "https://git.example.com/acme/project.git",
      branch: "2026-HUMANTHR1100008",
      branchPolicy: { allowedBranches: ["*HUMANTHR*"] },
    };

    const first = await manager.prepare({ agentRunId: "agent_run:first", repository });
    const retry = await manager.prepare({ agentRunId: "agent_run:retry", repository });

    expect(first.cwd).toMatch(/^\/state\/worktrees\/task-[a-f0-9]{64}$/u);
    expect(retry.cwd).toBe(first.cwd);
  });

  it("creates one detached worktree per repository task branch from a cached approved branch", async () => {
    const runGit = vi.fn().mockResolvedValue(undefined);
    const manager = createWorkerWorktreeManager({
      stateDirectory: "/state",
      exists: vi.fn().mockResolvedValue(false),
      mkdir: vi.fn().mockResolvedValue(undefined),
      runGit,
    });

    const cwd = await manager.prepare({
      agentRunId: "agent_run_1",
      repository: {
        url: "https://git.example.com/acme/project.git",
        branch: "task/2026-HUMANTHR1",
        branchPolicy: { allowedBranches: ["task/*"] },
      },
    });

    expect(cwd).toMatchObject({ cwd: stableWorktreePath("https://git.example.com/acme/project.git", "task/2026-HUMANTHR1"), gitEnvironment: { GIT_CONFIG_GLOBAL: "/state/gitconfig", GIT_TERMINAL_PROMPT: "0" } });
    expect(cwd.inspectDelivery).toEqual(expect.any(Function));
    const promptEnvironment = { env: { GIT_CONFIG_GLOBAL: "/state/gitconfig", GIT_TERMINAL_PROMPT: "0" } };
    expect(runGit).toHaveBeenNthCalledWith(1, ["clone", "--bare", "--", "https://git.example.com/acme/project.git", expect.stringMatching(/^\/state\/repositories\/[a-f0-9]{64}\.git$/u)], promptEnvironment);
    const cachePath = expect.stringMatching(/^\/state\/repositories\/[a-f0-9]{64}\.git$/u);
    expect(runGit).toHaveBeenNthCalledWith(2, ["config", "--global", "--add", "safe.directory", cachePath], promptEnvironment);
    expect(runGit).toHaveBeenNthCalledWith(3, ["--git-dir", cachePath, "config", "remote.origin.mirror", "false"], promptEnvironment);
    expect(runGit).toHaveBeenNthCalledWith(4, ["--git-dir", cachePath, "config", "--replace-all", "remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*"], promptEnvironment);
    expect(runGit).toHaveBeenNthCalledWith(5, ["--git-dir", cachePath, "worktree", "prune", "--expire=now"], promptEnvironment);
    expect(runGit).toHaveBeenNthCalledWith(6, [
      "-C", cachePath,
      "fetch", "--prune", "--no-tags", "--refmap=", "origin",
      "+refs/heads/task/2026-HUMANTHR1:refs/remotes/origin/task/2026-HUMANTHR1",
    ], promptEnvironment);
    expect(runGit).toHaveBeenNthCalledWith(7, ["--git-dir", cachePath, "worktree", "add", "--force", "--detach", stableWorktreePath("https://git.example.com/acme/project.git", "task/2026-HUMANTHR1"), "origin/task/2026-HUMANTHR1"], promptEnvironment);
    expect(runGit).toHaveBeenNthCalledWith(8, ["config", "--global", "--add", "safe.directory", stableWorktreePath("https://git.example.com/acme/project.git", "task/2026-HUMANTHR1")], promptEnvironment);
  });

  it("pushes the final detached Worker HEAD before inspecting Git delivery", async () => {
    const runGit = vi.fn().mockResolvedValue(undefined);
    const captureGit = vi.fn(async (args: string[]) => {
      if (args.includes("refs/remotes/origin/task/2026-HUMANTHR1")) return "delivered-commit";
      if (args.includes("HEAD")) return "delivered-commit";
      if (args.includes("status")) return "";
      return "";
    });
    const manager = createWorkerWorktreeManager({
      stateDirectory: "/state",
      exists: vi.fn().mockResolvedValue(false),
      mkdir: vi.fn().mockResolvedValue(undefined),
      runGit,
      captureGit,
    });

    const prepared = await manager.prepare({
      agentRunId: "agent_run_delivery",
      repository: {
        url: "https://git.example.com/acme/project.git",
        branch: "task/2026-HUMANTHR1",
        branchPolicy: { allowedBranches: ["task/*"] },
      },
    });

    await prepared.inspectDelivery?.();

    expect(runGit).toHaveBeenCalledWith(
      ["-C", stableWorktreePath("https://git.example.com/acme/project.git", "task/2026-HUMANTHR1"), "push", "origin", "HEAD:refs/heads/task/2026-HUMANTHR1"],
      expect.anything(),
    );
  });

  it("reuses a clean worktree only when its assignment metadata matches", async () => {
    const runGit = vi.fn().mockResolvedValue(undefined);
    const readPrivateFile = vi.fn().mockResolvedValue(JSON.stringify({
      version: 1,
      cache: "/state/repositories/63b7c4000e53ce1bb689a1bc60ca759ddda5ff381ed974b7e73e5d1e6bd64f96.git",
      repositoryUrl: "https://git.example.com/acme/project.git",
      branch: "main",
      identity: "74c234add7078d130221d22dc91a32af56e84b55bcb680a29e2f15c060606d47",
      baseCommit: "remote-task-commit",
    }));
    const captureGit = vi.fn(async (args: string[]) => {
      if (args.includes("list")) return `worktree ${stableWorktreePath("https://git.example.com/acme/project.git", "main")}`;
      if (args.includes("refs/remotes/origin/main")) return "remote-task-commit";
      if (args.includes("merge-base")) return "";
      if (args.includes("HEAD")) return "remote-task-commit";
      return "";
    });
    const manager = createWorkerWorktreeManager({
      stateDirectory: "/state",
      exists: vi.fn().mockResolvedValue(true),
      mkdir: vi.fn().mockResolvedValue(undefined),
      runGit,
      readPrivateFile,
      captureGit,
      environment: { PATH: "/usr/bin" },
    });

    const result = await manager.prepare({
      agentRunId: "agent_run_reuse",
      repository: {
        url: "https://git.example.com/acme/project.git",
        branch: "main",
        branchPolicy: { allowedBranches: ["main"] },
      },
    });

    expect(result.cwd).toBe(stableWorktreePath("https://git.example.com/acme/project.git", "main"));
    expect(runGit).not.toHaveBeenCalledWith(expect.arrayContaining(["worktree", "add"]), expect.anything());
    expect(captureGit).toHaveBeenCalledWith([
      "-C",
      stableWorktreePath("https://git.example.com/acme/project.git", "main"),
      "status",
      "--porcelain",
      "--",
      ".",
      ":(exclude).humanthread.lock",
    ], expect.anything());
  });

  it("reuses a worktree that still holds uncommitted work from an earlier stage", async () => {
    const runGit = vi.fn().mockResolvedValue(undefined);
    const removePath = vi.fn().mockResolvedValue(undefined);
    const readPrivateFile = vi.fn().mockResolvedValue(JSON.stringify({
      version: 1,
      cache: "/state/repositories/63b7c4000e53ce1bb689a1bc60ca759ddda5ff381ed974b7e73e5d1e6bd64f96.git",
      repositoryUrl: "https://git.example.com/acme/project.git",
      branch: "main",
      identity: "74c234add7078d130221d22dc91a32af56e84b55bcb680a29e2f15c060606d47",
      baseCommit: "remote-task-commit",
    }));
    const captureGit = vi.fn(async (args: string[]) => {
      if (args.includes("list")) return `worktree ${stableWorktreePath("https://git.example.com/acme/project.git", "main")}`;
      if (args.includes("refs/remotes/origin/main")) return "remote-task-commit";
      if (args.includes("merge-base")) return "";
      if (args.includes("HEAD")) return "remote-task-commit";
      if (args.includes("status")) return "?? working/current/chapter-019-draft.md";
      return "";
    });
    const manager = createWorkerWorktreeManager({
      stateDirectory: "/state",
      exists: vi.fn().mockResolvedValue(true),
      mkdir: vi.fn().mockResolvedValue(undefined),
      runGit,
      removePath,
      readPrivateFile,
      captureGit,
      environment: { PATH: "/usr/bin" },
    });

    const result = await manager.prepare({
      agentRunId: "agent_run_pending_work",
      repository: {
        url: "https://git.example.com/acme/project.git",
        branch: "main",
        branchPolicy: { allowedBranches: ["main"] },
      },
    });

    // A later stage of the same task must continue in the same checkout.
    // Discarding the directory here is what destroyed the chapter drafts.
    expect(result.cwd).toBe(stableWorktreePath("https://git.example.com/acme/project.git", "main"));
    expect(removePath).not.toHaveBeenCalled();
    expect(runGit).not.toHaveBeenCalledWith(expect.arrayContaining(["worktree", "remove", "--force"]), expect.anything());
    expect(runGit).not.toHaveBeenCalledWith(expect.arrayContaining(["worktree", "add"]), expect.anything());
  });

  it("quarantines a dirty worktree instead of deleting uncommitted work when it cannot be reused", async () => {
    const runGit = vi.fn().mockResolvedValue(undefined);
    const removePath = vi.fn().mockResolvedValue(undefined);
    const worktree = stableWorktreePath("https://git.example.com/acme/project.git", "main");
    const manager = createWorkerWorktreeManager({
      stateDirectory: "/state",
      exists: vi.fn().mockImplementation(async (path: string) => path.includes("repositories") || path === worktree),
      mkdir: vi.fn().mockResolvedValue(undefined),
      runGit,
      removePath,
      readPrivateFile: vi.fn().mockRejectedValue(new Error("metadata missing")),
      captureGit: vi.fn(async (args: string[]) => {
        if (args.includes("status")) return " M working/current/chapter-019-draft.md";
        if (args.includes("list")) return "";
        return "";
      }),
      environment: { PATH: "/usr/bin" },
    });

    await manager.prepare({
      agentRunId: "agent_run_quarantine",
      repository: {
        url: "https://git.example.com/acme/project.git",
        branch: "main",
        branchPolicy: { allowedBranches: ["main"] },
      },
    });

    // Uncommitted agent output must survive a forced rebuild as a recoverable
    // directory rather than being permanently removed.
    const quarantineCall = runGit.mock.calls.find(([args]) => args.includes("move"));
    expect(quarantineCall?.[0]).toEqual(expect.arrayContaining(["worktree", "move"]));
    expect(String(quarantineCall?.[0][5])).toMatch(/-preserved-/u);
    expect(removePath).not.toHaveBeenCalledWith(worktree);
  });

  it("does not reuse a clean worktree when its checkout is stale against the remote branch", async () => {
    const runGit = vi.fn().mockResolvedValue(undefined);
    const removePath = vi.fn().mockResolvedValue(undefined);
    const readPrivateFile = vi.fn().mockResolvedValue(JSON.stringify({
      version: 1,
      cache: "/state/repositories/63b7c4000e53ce1bb689a1bc60ca759ddda5ff381ed974b7e73e5d1e6bd64f96.git",
      repositoryUrl: "https://git.example.com/acme/project.git",
      branch: "2026-HUMANTHR1100008",
      identity: "74c234add7078d130221d22dc91a32af56e84b55bcb680a29e2f15c060606d47",
      baseCommit: "remote-task-commit",
    }));
    let headReads = 0;
    const captureGit = vi.fn(async (args: string[]) => {
      if (args.includes("list")) return "worktree /state/worktrees/agent_run_stale_checkout";
      if (args.includes("status")) return "";
      if (args.includes("refs/remotes/origin/2026-HUMANTHR1100008")) return "remote-task-commit";
      if (args.includes("merge-base")) throw new Error("not an ancestor");
      if (args.includes("HEAD")) return headReads++ === 0 ? "main-commit" : "remote-task-commit";
      return "";
    });
    const manager = createWorkerWorktreeManager({
      stateDirectory: "/state",
      exists: vi.fn().mockResolvedValue(true),
      mkdir: vi.fn().mockResolvedValue(undefined),
      runGit,
      removePath,
      readPrivateFile,
      captureGit,
      environment: { PATH: "/usr/bin" },
    });

    await manager.prepare({
      agentRunId: "agent_run_stale_checkout",
      repository: {
        url: "https://git.example.com/acme/project.git",
        branch: "2026-HUMANTHR1100008",
        branchPolicy: { allowedBranches: ["*HUMANTHR*"] },
      },
    });

    expect(removePath).toHaveBeenCalledWith(stableWorktreePath("https://git.example.com/acme/project.git", "2026-HUMANTHR1100008"));
    expect(runGit).toHaveBeenCalledWith(expect.arrayContaining(["worktree", "add"]), expect.anything());
  });

  it("cleans an unverified stale worktree before creating a fresh one", async () => {
    const runGit = vi.fn().mockResolvedValue(undefined);
    const removePath = vi.fn().mockResolvedValue(undefined);
    const manager = createWorkerWorktreeManager({
      stateDirectory: "/state",
      exists: vi.fn().mockResolvedValue(true),
      mkdir: vi.fn().mockResolvedValue(undefined),
      runGit,
      removePath,
      readPrivateFile: vi.fn().mockRejectedValue(new Error("metadata missing")),
      writePrivateFile: vi.fn().mockResolvedValue(undefined),
    });

    await manager.prepare({
      agentRunId: "agent_run_stale",
      repository: {
        url: "https://git.example.com/acme/project.git",
        branch: "main",
        branchPolicy: { allowedBranches: ["main"] },
      },
    });

    expect(runGit).toHaveBeenCalledWith([
      "--git-dir", expect.stringMatching(/^\/state\/repositories\/[a-f0-9]{64}\.git$/u),
      "worktree", "remove", "--force", stableWorktreePath("https://git.example.com/acme/project.git", "main"),
    ], expect.anything());
    expect(removePath).toHaveBeenCalledWith(stableWorktreePath("https://git.example.com/acme/project.git", "main"));
    expect(runGit).toHaveBeenCalledWith(expect.arrayContaining(["worktree", "add"]), expect.anything());
  });

  it("writes reusable metadata only after Git has created the worktree", async () => {
    const exists = vi.fn().mockResolvedValue(false);
    const writePrivateFile = vi.fn().mockResolvedValue(undefined);
    const manager = createWorkerWorktreeManager({
      stateDirectory: "/state",
      exists,
      mkdir: vi.fn().mockResolvedValue(undefined),
      runGit: vi.fn().mockResolvedValue(undefined),
      writePrivateFile,
    });

    await manager.prepare({
      agentRunId: "agent_run_no_sidecar",
      repository: {
        url: "https://git.example.com/acme/project.git",
        branch: "main",
        branchPolicy: { allowedBranches: ["main"] },
      },
    });

    expect(writePrivateFile).not.toHaveBeenCalledWith(
      `${stableWorktreePath("https://git.example.com/acme/project.git", "main")}.metadata.json`,
      expect.any(String),
    );
  });

  it("fetches a shared branch through its remote-tracking ref", async () => {
    const runGit = vi.fn().mockResolvedValue(undefined);
    const manager = createWorkerWorktreeManager({
      stateDirectory: "/state",
      exists: vi.fn().mockResolvedValue(false),
      mkdir: vi.fn().mockResolvedValue(undefined),
      runGit,
    });

    await manager.prepare({
      agentRunId: "agent_run_2",
      repository: {
        url: "https://git.example.com/acme/project.git",
        branch: "2026-HUMANTHR1100008",
        branchPolicy: { allowedBranches: ["*HUMANTHR*"] },
      },
    });

    const cache = expect.stringMatching(/^\/state\/repositories\/[a-f0-9]{64}\.git$/u);
    expect(runGit).toHaveBeenCalledWith([
      "-C", cache,
      "fetch", "--prune", "--no-tags", "--refmap=", "origin",
      "+refs/heads/2026-HUMANTHR1100008:refs/remotes/origin/2026-HUMANTHR1100008",
    ], expect.anything());
    expect(runGit).toHaveBeenCalledWith([
      "--git-dir", cache,
      "worktree", "add", "--force", "--detach", stableWorktreePath("https://git.example.com/acme/project.git", "2026-HUMANTHR1100008"), "origin/2026-HUMANTHR1100008",
    ], expect.anything());
  });

  it("creates a missing task branch from the default remote base", async () => {
    const runGit = vi.fn().mockImplementation(async (args: string[]) => {
      if (args.includes("+refs/heads/2026-HUMANTHR1100008:refs/remotes/origin/2026-HUMANTHR1100008")) {
        throw new Error("fatal: couldn't find remote ref refs/heads/2026-HUMANTHR1100008");
      }
    });
    const captureGit = vi.fn(async (args: string[]) => {
      if (args.includes("refs/remotes/origin/main")) return "base-main-commit";
      if (args.includes("HEAD")) return "base-main-commit";
      return "";
    });
    const manager = createWorkerWorktreeManager({
      stateDirectory: "/state",
      exists: vi.fn().mockResolvedValue(false),
      mkdir: vi.fn().mockResolvedValue(undefined),
      runGit,
      captureGit,
    });

    await manager.prepare({
      agentRunId: "agent_run_missing_task_branch",
      repository: {
        url: "https://git.example.com/acme/project.git",
        branch: "2026-HUMANTHR1100008",
        branchPolicy: { allowedBranches: ["*HUMANTHR*"] },
      },
    });

    expect(runGit).toHaveBeenCalledWith([
      "-C", expect.stringMatching(/^\/state\/repositories\/[a-f0-9]{64}\.git$/u),
      "fetch", "--prune", "--no-tags", "--refmap=", "origin",
      "+refs/heads/*:refs/remotes/origin/*",
    ], expect.anything());
    expect(runGit).toHaveBeenCalledWith([
      "--git-dir", expect.any(String),
      "worktree", "add", "--force", "--detach",
      stableWorktreePath("https://git.example.com/acme/project.git", "2026-HUMANTHR1100008"),
      "origin/main",
    ], expect.anything());
  });

  it("checks out a task branch detached so an existing task branch cannot redirect execution to main", async () => {
    const runGit = vi.fn().mockResolvedValue(undefined);
    const manager = createWorkerWorktreeManager({
      stateDirectory: "/state",
      exists: vi.fn().mockResolvedValue(false),
      mkdir: vi.fn().mockResolvedValue(undefined),
      runGit,
    });

    await manager.prepare({
      agentRunId: "agent_run_detached_task_checkout",
      repository: {
        url: "https://git.example.com/acme/project.git",
        branch: "2026-HUMANTHR1100008",
        branchPolicy: { allowedBranches: ["*HUMANTHR*"] },
      },
    });

    expect(runGit).toHaveBeenCalledWith([
      "--git-dir", expect.stringMatching(/^\/state\/repositories\/[a-f0-9]{64}\.git$/u),
      "worktree", "add", "--force", "--detach",
      stableWorktreePath("https://git.example.com/acme/project.git", "2026-HUMANTHR1100008"),
      "origin/2026-HUMANTHR1100008",
    ], expect.anything());
    expect(runGit).not.toHaveBeenCalledWith(expect.arrayContaining([
      "branch", "2026-HUMANTHR1100008",
    ]), expect.anything());
  });

  it("migrates a registered legacy AgentRun worktree to the stable task path", async () => {
    const repository = {
      url: "https://git.example.com/acme/project.git",
      branch: "2026-HUMANTHR1100008",
      branchPolicy: { allowedBranches: ["*HUMANTHR*"] },
    };
    const legacyWorktree = "/state/worktrees/agent_run_stale";
    const stableWorktree = stableWorktreePath(repository.url, repository.branch);
    const cache = "/state/repositories/63b7c4000e53ce1bb689a1bc60ca759ddda5ff381ed974b7e73e5d1e6bd64f96.git";
    const paths = new Set([cache, legacyWorktree]);
    const runGit = vi.fn(async (args: string[]) => {
      if (args.includes("move")) {
        paths.delete(legacyWorktree);
        paths.add(stableWorktree);
      }
    });
    const captureGit = vi.fn(async (args: string[]) => {
      if (args.includes("list")) {
        const worktree = paths.has(stableWorktree) ? stableWorktree : legacyWorktree;
        return `worktree ${worktree}\nbranch refs/heads/2026-HUMANTHR1100008`;
      }
      if (args.includes("status")) return "";
      if (args.includes("refs/remotes/origin/2026-HUMANTHR1100008")) return "base-task-commit";
      if (args.includes("HEAD")) return "base-task-commit";
      if (args.includes("merge-base")) return "";
      return "";
    });
    const manager = createWorkerWorktreeManager({
      stateDirectory: "/state",
      exists: vi.fn().mockImplementation(async (path: string) => paths.has(path)),
      mkdir: vi.fn().mockResolvedValue(undefined),
      runGit,
      captureGit,
      readPrivateFile: vi.fn().mockResolvedValue(JSON.stringify({
        version: 1,
        cache,
        repositoryUrl: repository.url,
        branch: repository.branch,
        identity: "74c234add7078d130221d22dc91a32af56e84b55bcb680a29e2f15c060606d47",
        baseCommit: "base-task-commit",
      })),
      writePrivateFile: vi.fn().mockResolvedValue(undefined),
      environment: { PATH: "/usr/bin" },
    });

    const prepared = await manager.prepare({ agentRunId: "agent_run_stale", repository });

    expect(prepared.cwd).toBe(stableWorktree);
    expect(runGit).toHaveBeenCalledWith(
      ["--git-dir", cache, "worktree", "move", legacyWorktree, stableWorktree],
      expect.anything(),
    );
    expect(runGit).not.toHaveBeenCalledWith(expect.arrayContaining(["worktree", "add"]), expect.anything());
  });

  it("does not delete a worktree for an unrelated fetch failure", async () => {
    const runGit = vi.fn().mockImplementation(async (args: string[]) => {
      if (args.includes("fetch")) throw new Error("remote: repository unavailable");
    });
    const removePath = vi.fn().mockResolvedValue(undefined);
    const manager = createWorkerWorktreeManager({
      stateDirectory: "/state",
      exists: vi.fn().mockImplementation(async (path: string) => path.includes("repositories/")),
      mkdir: vi.fn().mockResolvedValue(undefined),
      runGit,
      removePath,
      readPrivateFile: vi.fn().mockRejectedValue(new Error("stale metadata")),
      captureGit: vi.fn().mockResolvedValue("worktree /state/worktrees/agent_run_network"),
      environment: { PATH: "/usr/bin" },
    });

    await expect(manager.prepare({
      agentRunId: "agent_run_network",
      repository: {
        url: "https://git.example.com/acme/project.git",
        branch: "2026-HUMANTHR1100008",
        branchPolicy: { allowedBranches: ["*HUMANTHR*"] },
      },
    })).rejects.toThrow("repository unavailable");
    expect(removePath).not.toHaveBeenCalled();
  });

  it("does not remove the stable task worktree when Git reports it is checked out", async () => {
    const repository = {
      url: "https://git.example.com/acme/project.git",
      branch: "2026-HUMANTHR1100008",
      branchPolicy: { allowedBranches: ["*HUMANTHR*"] },
    };
    const stableWorktree = stableWorktreePath(repository.url, repository.branch);
    const cache = "/state/repositories/63b7c4000e53ce1bb689a1bc60ca759ddda5ff381ed974b7e73e5d1e6bd64f96.git";
    const runGit = vi.fn().mockImplementation(async (args: string[]) => {
      if (args.includes("fetch")) throw new Error(`fatal: refusing to fetch into branch 'refs/heads/${repository.branch}' checked out at '${stableWorktree}'`);
    });
    const removePath = vi.fn().mockResolvedValue(undefined);
    const captureGit = vi.fn(async (args: string[]) => {
      if (args.includes("list")) return `worktree ${stableWorktree}\nbranch refs/heads/${repository.branch}`;
      if (args.includes("status")) return "";
      if (args.includes("refs/remotes/origin/2026-HUMANTHR1100008")) return "base-task-commit";
      if (args.includes("HEAD")) return "base-task-commit";
      if (args.includes("merge-base")) return "";
      return "";
    });
    const manager = createWorkerWorktreeManager({
      stateDirectory: "/state",
      exists: vi.fn().mockResolvedValue(true),
      mkdir: vi.fn().mockResolvedValue(undefined),
      runGit,
      removePath,
      captureGit,
      readPrivateFile: vi.fn().mockResolvedValue(JSON.stringify({
        version: 1,
        cache,
        repositoryUrl: repository.url,
        branch: repository.branch,
        identity: "74c234add7078d130221d22dc91a32af56e84b55bcb680a29e2f15c060606d47",
        baseCommit: "base-task-commit",
      })),
      environment: { PATH: "/usr/bin" },
    });

    await expect(manager.prepare({ agentRunId: "agent_run_checked_out", repository }))
      .rejects.toThrow(/refusing to fetch into branch/u);
    expect(removePath.mock.calls.map(([path]) => path)).not.toContain(stableWorktree);
    expect(runGit).not.toHaveBeenCalledWith(
      ["--git-dir", cache, "worktree", "remove", "--force", stableWorktree],
      expect.anything(),
    );
  });

  it("rejects a worktree whose checkout does not match the fetched task branch", async () => {
    const runGit = vi.fn().mockResolvedValue(undefined);
    const captureGit = vi.fn(async (args: string[]) => {
      if (args.includes("rev-parse") && args.includes("refs/remotes/origin/2026-HUMANTHR1100008")) return "base-task-commit";
      if (args.includes("rev-parse") && args.includes("HEAD")) return "main-commit";
      return "";
    });
    const manager = createWorkerWorktreeManager({
      stateDirectory: "/state",
      exists: vi.fn().mockResolvedValue(false),
      mkdir: vi.fn().mockResolvedValue(undefined),
      runGit,
      captureGit,
    });

    await expect(manager.prepare({
      agentRunId: "agent_run_mismatched_checkout",
      repository: {
        url: "https://git.example.com/acme/project.git",
        branch: "2026-HUMANTHR1100008",
        branchPolicy: { allowedBranches: ["*HUMANTHR*"] },
      },
    })).rejects.toMatchObject({ code: "worktree_checkout_mismatch" });
    expect(runGit).toHaveBeenLastCalledWith(
      ["--git-dir", expect.stringMatching(/^\/state\/repositories\/[a-f0-9]{64}\.git$/u), "worktree", "remove", "--force", stableWorktreePath("https://git.example.com/acme/project.git", "2026-HUMANTHR1100008")],
      expect.anything(),
    );
  });

  it("retains the stable task worktree after the assignment finishes", async () => {
    const runGit = vi.fn().mockResolvedValue(undefined);
    const manager = createWorkerWorktreeManager({
      stateDirectory: "/state",
      exists: vi.fn().mockResolvedValue(false),
      mkdir: vi.fn().mockResolvedValue(undefined),
      runGit,
    });

    const prepared = await manager.prepare({
      agentRunId: "agent_run_cleanup",
      repository: { url: "https://git.example.com/acme/project.git", branch: "main", branchPolicy: { allowedBranches: ["main"] } },
    });
    await prepared.cleanup?.();

    expect(prepared.cleanup).toBeUndefined();
    expect(runGit).not.toHaveBeenCalledWith(
      expect.arrayContaining(["worktree", "remove", "--force"]),
      expect.anything(),
    );
  });

  it("在 Kubernetes 共享存储模式下为任务工作树取得排他锁并在清理时释放", async () => {
    const runGit = vi.fn().mockResolvedValue(undefined);
    const release = vi.fn().mockResolvedValue(undefined);
    const acquire = vi.fn().mockResolvedValue(release);
    const manager = createWorkerWorktreeManager({
      stateDirectory: "/state",
      runtime: "kubernetes",
      taskRoot: "/var/lib/humanthread/tasks",
      exists: vi.fn().mockResolvedValue(false),
      mkdir: vi.fn().mockResolvedValue(undefined),
      runGit,
      acquireTaskLock: acquire,
    });

    const prepared = await manager.prepare({
      agentRunId: "agent_run_k8s",
      repository: { url: "https://git.example.com/acme/project.git", branch: "task/2026-HUMANTHR1", branchPolicy: { allowedBranches: ["task/*"] } },
    });

    expect(acquire).toHaveBeenCalledWith(expect.stringMatching(/^\/var\/lib\/humanthread\/tasks\/task-[a-f0-9]{64}\/\.humanthread\.lock$/u), "agent_run_k8s");
    await prepared.cleanup?.();
    expect(release).toHaveBeenCalledOnce();
  });

  it("accepts platform AgentRun identifiers containing a colon", async () => {
    const runGit = vi.fn().mockResolvedValue(undefined);
    const manager = createWorkerWorktreeManager({
      stateDirectory: "/state",
      exists: vi.fn().mockResolvedValue(false),
      mkdir: vi.fn().mockResolvedValue(undefined),
      runGit,
    });

    await expect(manager.prepare({
      agentRunId: "agent_run:4345e642c241908e2bed199f12410f6e01415621527c54fc3bf8f81f2827414e",
      repository: {
        url: "https://git.example.com/acme/project.git",
        branch: "main",
        branchPolicy: { allowedBranches: ["main"] },
      },
    })).resolves.toMatchObject({ cwd: stableWorktreePath("https://git.example.com/acme/project.git", "main") });
  });

  it("rejects a branch outside the frozen policy before invoking Git", async () => {
    const runGit = vi.fn();
    const manager = createWorkerWorktreeManager({ stateDirectory: "/state", exists: vi.fn(), mkdir: vi.fn(), runGit });
    await expect(manager.prepare({
      agentRunId: "agent_run_1",
      repository: { url: "https://git.example.com/acme/project.git", branch: "main", branchPolicy: { allowedBranches: ["task/1"] } },
    })).rejects.toMatchObject({ code: "configuration_required" });
    expect(runGit).not.toHaveBeenCalled();
  });

  it("disables interactive HTTPS credential prompts when no Git secret is injected", async () => {
    const runGit = vi.fn().mockResolvedValue(undefined);
    const manager = createWorkerWorktreeManager({
      stateDirectory: "/state",
      exists: vi.fn().mockResolvedValue(false),
      mkdir: vi.fn().mockResolvedValue(undefined),
      runGit,
      writePrivateFile: vi.fn().mockResolvedValue(undefined),
      environment: { PATH: "/usr/bin" },
    });

    const result = await manager.prepare({
      agentRunId: "agent_run_1",
      repository: {
        url: "https://git.example.com/acme/project.git",
        branch: "main",
        branchPolicy: { allowedBranches: ["main"] },
      },
    });

    expect(result).toMatchObject({
      cwd: stableWorktreePath("https://git.example.com/acme/project.git", "main"),
      gitEnvironment: { GIT_CONFIG_GLOBAL: "/state/gitconfig", GIT_TERMINAL_PROMPT: "0" },
    });
    expect(runGit).toHaveBeenCalledWith(expect.any(Array), {
      env: expect.objectContaining({ GIT_TERMINAL_PROMPT: "0" }),
    });
  });

  it("rejects SSH URLs that embed userinfo", async () => {
    const runGit = vi.fn();
    const manager = createWorkerWorktreeManager({ stateDirectory: "/state", exists: vi.fn(), mkdir: vi.fn(), runGit });
    await expect(manager.prepare({
      agentRunId: "agent_run_1",
      repository: {
        url: "ssh://user:password@git.example.com/acme/project.git",
        branch: "main",
        branchPolicy: { allowedBranches: ["main"] },
      },
    })).rejects.toMatchObject({ code: "configuration_required" });
    expect(runGit).not.toHaveBeenCalled();
  });

  it("uses a private askpass script for injected HTTPS credentials without writing the secret", async () => {
    const runGit = vi.fn().mockResolvedValue(undefined);
    const writePrivateFile = vi.fn().mockResolvedValue(undefined);
    const manager = createWorkerWorktreeManager({
      stateDirectory: "/state",
      exists: vi.fn().mockResolvedValue(false),
      mkdir: vi.fn().mockResolvedValue(undefined),
      runGit,
      writePrivateFile,
      environment: { HT_GIT_USERNAME: "worker-user", HT_GIT_SECRET: "git-secret-value" },
    });

    await manager.prepare({
      agentRunId: "agent_run_1",
      repository: {
        url: "https://git.example.com/acme/project.git",
        branch: "main",
        branchPolicy: { allowedBranches: ["main"] },
      },
    });

    expect(writePrivateFile).toHaveBeenCalledWith("/state/git-askpass.sh", expect.stringContaining("HT_GIT_SECRET"));
    expect(JSON.stringify(writePrivateFile.mock.calls)).not.toContain("git-secret-value");
    expect(runGit).toHaveBeenCalledWith(expect.any(Array), {
      env: expect.objectContaining({
        GIT_ASKPASS: "/state/git-askpass.sh",
        GIT_TERMINAL_PROMPT: "0",
        HT_GIT_USERNAME: "worker-user",
        HT_GIT_SECRET: "git-secret-value",
      }),
    });
  });

  it("prefers HT_GIT_TOKEN over HT_GIT_PASSWORD for legacy password-slot credentials", async () => {
    const runGit = vi.fn().mockResolvedValue(undefined);
    const manager = createWorkerWorktreeManager({
      stateDirectory: "/state",
      exists: vi.fn().mockResolvedValue(false),
      mkdir: vi.fn().mockResolvedValue(undefined),
      runGit,
      writePrivateFile: vi.fn().mockResolvedValue(undefined),
      environment: {
        HT_GIT_USERNAME: "worker-user",
        HT_GIT_TOKEN: "project-token",
        HT_GIT_PASSWORD: "account-password",
      },
    });

    await manager.prepare({
      agentRunId: "agent_run_1",
      repository: {
        url: "https://git.example.com/acme/project.git",
        branch: "main",
        branchPolicy: { allowedBranches: ["main"] },
      },
    });

    expect(runGit).toHaveBeenCalledWith(expect.any(Array), {
      env: expect.objectContaining({ HT_GIT_SECRET: "project-token" }),
    });
    expect(JSON.stringify(runGit.mock.calls)).not.toContain("account-password");
  });

  it("returns the explicit Git environment for app-server tools without ambient model settings", async () => {
    const runGit = vi.fn().mockResolvedValue(undefined);
    const manager = createWorkerWorktreeManager({
      stateDirectory: "/state",
      exists: vi.fn().mockResolvedValue(false),
      mkdir: vi.fn().mockResolvedValue(undefined),
      runGit,
      writePrivateFile: vi.fn().mockResolvedValue(undefined),
      environment: {
        PATH: "/usr/bin",
        OPENAI_API_KEY: "ambient-key",
        HT_GIT_USERNAME: "worker-user",
        HT_GIT_TOKEN: "git-token-value",
      },
    });

    const result = await manager.prepare({
      agentRunId: "agent_run_1",
      repository: {
        url: "https://git.example.com/acme/project.git",
        branch: "main",
        branchPolicy: { allowedBranches: ["main"] },
      },
    });

    expect(result).toMatchObject({
      cwd: stableWorktreePath("https://git.example.com/acme/project.git", "main"),
      gitEnvironment: {
        GIT_CONFIG_GLOBAL: "/state/gitconfig",
        PATH: "/usr/bin",
        GIT_ASKPASS: "/state/git-askpass.sh",
        GIT_TERMINAL_PROMPT: "0",
        HT_GIT_USERNAME: "worker-user",
        HT_GIT_SECRET: "git-token-value",
      },
    });
    expect(JSON.stringify(result)).not.toContain("ambient-key");
  });

  it("forwards an explicit commit identity to the isolated app-server environment", async () => {
    const manager = createWorkerWorktreeManager({
      stateDirectory: "/state",
      exists: vi.fn().mockResolvedValue(false),
      mkdir: vi.fn().mockResolvedValue(undefined),
      runGit: vi.fn().mockResolvedValue(undefined),
      writePrivateFile: vi.fn().mockResolvedValue(undefined),
      environment: {
        GIT_AUTHOR_NAME: "HumanThread Worker",
        GIT_AUTHOR_EMAIL: "worker@example.com",
      },
    });

    const result = await manager.prepare({
      agentRunId: "agent_run_1",
      repository: {
        url: "ssh://git.example.com/acme/project.git",
        branch: "main",
        branchPolicy: { allowedBranches: ["main"] },
      },
    });

    expect(result).toMatchObject({
      cwd: stableWorktreePath("ssh://git.example.com/acme/project.git", "main"),
      gitEnvironment: {
        GIT_CONFIG_GLOBAL: "/state/gitconfig",
        GIT_AUTHOR_NAME: "HumanThread Worker",
        GIT_AUTHOR_EMAIL: "worker@example.com",
        GIT_COMMITTER_NAME: "HumanThread Worker",
        GIT_COMMITTER_EMAIL: "worker@example.com",
      },
    });
  });

  it("rejects a partial Git commit identity before invoking Git", async () => {
    const runGit = vi.fn();
    const manager = createWorkerWorktreeManager({
      stateDirectory: "/state",
      exists: vi.fn(),
      mkdir: vi.fn(),
      runGit,
      environment: { GIT_AUTHOR_NAME: "HumanThread Worker" },
    });

    await expect(manager.prepare({
      agentRunId: "agent_run_1",
      repository: {
        url: "ssh://git.example.com/acme/project.git",
        branch: "main",
        branchPolicy: { allowedBranches: ["main"] },
      },
    })).rejects.toMatchObject({ code: "configuration_required" });
    expect(runGit).not.toHaveBeenCalled();
  });

  it("rejects partial injected Git credentials before invoking Git", async () => {
    const runGit = vi.fn();
    const manager = createWorkerWorktreeManager({
      stateDirectory: "/state",
      exists: vi.fn(),
      mkdir: vi.fn(),
      runGit,
      environment: { HT_GIT_USERNAME: "worker-user" },
    });

    await expect(manager.prepare({
      agentRunId: "agent_run_1",
      repository: {
        url: "https://git.example.com/acme/project.git",
        branch: "main",
        branchPolicy: { allowedBranches: ["main"] },
      },
    })).rejects.toMatchObject({ code: "configuration_required" });
    expect(runGit).not.toHaveBeenCalled();
  });
});

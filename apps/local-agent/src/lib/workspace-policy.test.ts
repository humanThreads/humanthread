import { describe, expect, it, vi } from "vitest";
import {
  assertPathInsideWorkspace,
  buildCodexExecutionPolicy,
  recoverTaskArtifacts,
  resolveAssignmentWorkspace,
  resolveWorkspaceBoundary,
  workspaceRelativePath,
} from "./workspace-policy";

describe("Workspace execution policy", () => {
  it("recovers matching PRD and plan artifacts into the task worktree without touching source code", async () => {
    const files = new Map<string, string>([
      ["/repo/artifacts/write-prd/prd-manifest.json", JSON.stringify({
        taskId: "task:current",
        projectId: "project_1",
        taskBranch: "2026-CURRENT",
        localPath: "docs/requirements/2026-CURRENT/prd.md",
      })],
      ["/repo/artifacts/write-plan/plan-manifest.json", JSON.stringify({
        taskId: "task:current",
        projectId: "project_1",
        taskBranch: "2026-CURRENT",
        localPath: "docs/requirements/2026-CURRENT/plan.md",
      })],
      ["/repo/docs/requirements/2026-CURRENT/prd.md", "current prd"],
      ["/repo/docs/requirements/2026-CURRENT/plan.md", "current plan"],
      ["/repo/.worktrees/2026-CURRENT/artifacts/write-prd/prd-manifest.json", JSON.stringify({
        taskId: "task:old",
        projectId: "project_1",
        taskBranch: "2026-OLD",
      })],
    ]);
    const readFile = vi.fn(async (_root: string, requestedPath: string) => files.get(requestedPath) ?? null);
    const writeFile = vi.fn(async (_root: string, targetPath: string, content: string) => {
      files.set(targetPath, content);
    });

    await recoverTaskArtifacts({
      workspaceRoot: "/repo",
      taskWorkspace: "/repo/.worktrees/2026-CURRENT",
      taskId: "task:current",
      projectId: "project_1",
      taskBranch: "2026-CURRENT",
      readFile,
      writeFile,
    });

    expect(writeFile).toHaveBeenCalledWith(
      "/repo",
      "/repo/.worktrees/2026-CURRENT/artifacts/write-prd/prd-manifest.json",
      expect.stringContaining('"taskId": "task:current"'),
    );
    expect(writeFile).toHaveBeenCalledWith(
      "/repo",
      "/repo/.worktrees/2026-CURRENT/docs/requirements/2026-CURRENT/prd.md",
      "current prd",
    );
    expect(writeFile).toHaveBeenCalledWith(
      "/repo",
      "/repo/.worktrees/2026-CURRENT/artifacts/write-plan/plan-manifest.json",
      expect.stringContaining('"taskId": "task:current"'),
    );
    expect(writeFile).toHaveBeenCalledWith(
      "/repo",
      "/repo/.worktrees/2026-CURRENT/docs/requirements/2026-CURRENT/plan.md",
      "current plan",
    );
    expect(files.get("/repo/.worktrees/2026-CURRENT/artifacts/write-prd/prd-manifest.json")).toContain("task:current");
    expect(files.has("/repo/.worktrees/2026-CURRENT/src/index.ts")).toBe(false);
  });

  it("recovers a plan larger than the marker read limit", async () => {
    const plan = "p".repeat(35_998);
    const files = new Map<string, string>([
      ["/repo/artifacts/write-plan/plan-manifest.json", JSON.stringify({
        taskId: "task:current",
        projectId: "project_1",
        taskBranch: "2026-CURRENT",
        localPath: "docs/requirements/2026-CURRENT/plan.md",
      })],
      ["/repo/docs/requirements/2026-CURRENT/plan.md", plan],
    ]);
    const readFile = vi.fn(async (
      _root: string,
      requestedPath: string,
      maxBytes = 16 * 1024,
    ) => {
      const content = files.get(requestedPath) ?? null;
      if (content !== null && Buffer.byteLength(content, "utf8") > maxBytes) {
        throw new Error("Workspace file exceeds the requested read limit");
      }
      return content;
    });
    const writeFile = vi.fn(async (_root: string, targetPath: string, content: string) => {
      files.set(targetPath, content);
    });

    await recoverTaskArtifacts({
      workspaceRoot: "/repo",
      taskWorkspace: "/repo/.worktrees/2026-CURRENT",
      taskId: "task:current",
      projectId: "project_1",
      taskBranch: "2026-CURRENT",
      readFile,
      writeFile,
    });

    expect(files.get("/repo/.worktrees/2026-CURRENT/docs/requirements/2026-CURRENT/plan.md")).toBe(plan);
  });

  it("does not recover a manifest belonging to another task", async () => {
    const readFile = vi.fn(async (_root: string, requestedPath: string) => requestedPath.endsWith("prd-manifest.json")
      ? JSON.stringify({ taskId: "task:other", projectId: "project_1", taskBranch: "2026-OTHER" })
      : null);
    const writeFile = vi.fn();
    await recoverTaskArtifacts({
      workspaceRoot: "/repo",
      taskWorkspace: "/repo/.worktrees/2026-CURRENT",
      taskId: "task:current",
      projectId: "project_1",
      taskBranch: "2026-CURRENT",
      readFile,
      writeFile,
    });
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("never overwrites an existing task-worktree artifact during retry recovery", async () => {
    const oldPlan = "old root plan";
    const newPlan = "new worktree plan";
    const files = new Map<string, string>([
      ["/repo/artifacts/write-plan/plan-manifest.json", JSON.stringify({
        taskId: "task:current",
        projectId: "project_1",
        taskBranch: "2026-CURRENT",
        localPath: "docs/requirements/2026-CURRENT/plan.md",
        localDigest: "sha256:6b76a6d9226953d2a9e79797f723c2442faabade018c530db14c0937460f9be0",
        remote: { version: 1 },
        syncedAt: "2026-08-11T10:00:00.000Z",
      })],
      ["/repo/docs/requirements/2026-CURRENT/plan.md", oldPlan],
      ["/repo/.worktrees/2026-CURRENT/artifacts/write-plan/plan-manifest.json", JSON.stringify({
        taskId: "task:current",
        projectId: "project_1",
        taskBranch: "2026-CURRENT",
        localPath: "docs/requirements/2026-CURRENT/plan.md",
        localDigest: "sha256:12c1dc524a778d9776f71275265081de1d784b80d647a39a6250f47830fa6770",
        remote: { version: 1 },
        syncedAt: "2026-08-12T10:00:00.000Z",
      })],
      ["/repo/.worktrees/2026-CURRENT/docs/requirements/2026-CURRENT/plan.md", newPlan],
    ]);
    const readFile = vi.fn(async (_root: string, requestedPath: string) => files.get(requestedPath) ?? null);
    const writeFile = vi.fn(async (_root: string, targetPath: string, content: string) => {
      files.set(targetPath, content);
    });

    await recoverTaskArtifacts({
      workspaceRoot: "/repo",
      taskWorkspace: "/repo/.worktrees/2026-CURRENT",
      taskId: "task:current",
      projectId: "project_1",
      taskBranch: "2026-CURRENT",
      readFile,
      writeFile,
    });

    expect(writeFile).not.toHaveBeenCalled();
    expect(files.get("/repo/.worktrees/2026-CURRENT/docs/requirements/2026-CURRENT/plan.md")).toBe(newPlan);
  });

  it("does not partially restore an artifact when either target file already exists", async () => {
    const files = new Map<string, string>([
      ["/repo/artifacts/write-plan/plan-manifest.json", JSON.stringify({
        taskId: "task:current",
        projectId: "project_1",
        taskBranch: "2026-CURRENT",
        localPath: "docs/requirements/2026-CURRENT/plan.md",
      })],
      ["/repo/docs/requirements/2026-CURRENT/plan.md", "root plan"],
      ["/repo/.worktrees/2026-CURRENT/docs/requirements/2026-CURRENT/plan.md", "local edited plan"],
    ]);
    const readFile = vi.fn(async (_root: string, requestedPath: string) => files.get(requestedPath) ?? null);
    const writeFile = vi.fn();

    await recoverTaskArtifacts({
      workspaceRoot: "/repo",
      taskWorkspace: "/repo/.worktrees/2026-CURRENT",
      taskId: "task:current",
      projectId: "project_1",
      taskBranch: "2026-CURRENT",
      readFile,
      writeFile,
    });

    expect(writeFile).not.toHaveBeenCalled();
  });

  it("does not overwrite matching worktree artifacts while resolving a later task stage", async () => {
    const readFile = vi.fn(async (_root: string, requestedPath: string) => {
      if (requestedPath.endsWith("/.git")) return "gitdir: /repo/.git/worktrees/2026-CURRENT";
      if (requestedPath.endsWith("prd-manifest.json")) return JSON.stringify({
        taskId: "task:current",
        projectId: "project_1",
        taskBranch: "2026-CURRENT",
        localPath: "docs/requirements/2026-CURRENT/prd.md",
      });
      if (requestedPath.endsWith("/prd.md")) return "current prd";
      return null;
    });
    const writeFile = vi.fn().mockResolvedValue("/repo/.worktrees/2026-CURRENT/file");
    const inspectGit = vi.fn().mockResolvedValue({
      workspaceRealpath: "/repo",
      targetRealpath: "/repo/.worktrees/2026-CURRENT",
      branch: "2026-CURRENT",
      headCommit: "a".repeat(40),
      clean: false,
      isWorktree: true,
    });
    const resolved = await resolveAssignmentWorkspace({
      bindingId: "workspace_1",
      configurationVersion: 3,
      pathFingerprint: "hmac-sha256:abcdef",
    }, {
      getWorkspaceByBindingId: vi.fn().mockResolvedValue({
        projectId: "project_1",
        bindingId: "workspace_1",
        absolutePath: "/repo",
        realpath: "/repo",
        configurationVersion: 3,
        pathFingerprint: "hmac-sha256:abcdef",
      }),
    }, {
      resolve: vi.fn(async (_root: string, requestedPath: string) => ({
        workspaceRealpath: "/repo",
        targetRealpath: requestedPath,
        contained: true,
      })),
      readFile,
      writeFile,
      inspectGit,
    }, {
      taskId: "task:current",
      projectId: "project_1",
      taskBranch: "2026-CURRENT",
      nodeKey: "develop",
    });

    expect(resolved).toBe("/repo/.worktrees/2026-CURRENT");
    expect(writeFile).not.toHaveBeenCalled();
    expect(inspectGit).toHaveBeenCalledWith(
      "/repo",
      "/repo/.worktrees/2026-CURRENT",
    );
  });

  it("resolves a matching local binding without exposing its path to the platform", async () => {
    await expect(resolveAssignmentWorkspace({
      bindingId: "workspace_1",
      configurationVersion: 3,
      pathFingerprint: "hmac-sha256:abcdef",
    }, {
      getWorkspaceByBindingId: vi.fn().mockResolvedValue({
        projectId: "project_1",
        bindingId: "workspace_1",
        absolutePath: "/work/project-link",
        realpath: "/Volumes/code/project",
        configurationVersion: 3,
        pathFingerprint: "hmac-sha256:abcdef",
      }),
    }, {
      resolve: vi.fn().mockResolvedValue({
        workspaceRealpath: "/Volumes/code/project",
        targetRealpath: "/Volumes/code/project",
        contained: true,
      }),
    })).resolves.toBe("/Volumes/code/project");
  });

  it("rejects an assignment when the local binding version is stale", async () => {
    await expect(resolveAssignmentWorkspace({
      bindingId: "workspace_1",
      configurationVersion: 3,
      pathFingerprint: "hmac-sha256:abcdef",
    }, {
      getWorkspaceByBindingId: vi.fn().mockResolvedValue({
        projectId: "project_1",
        bindingId: "workspace_1",
        absolutePath: "/work/project",
        realpath: "/work/project",
        configurationVersion: 2,
        pathFingerprint: "hmac-sha256:abcdef",
      }),
    }, {
      resolve: vi.fn(),
    })).rejects.toMatchObject({ code: "workspace_configuration_stale" });
  });

  it("uses the task worktree after the preparation stage has created it", async () => {
    const readFile = vi.fn().mockResolvedValue("gitdir: /work/project/.git/worktrees/2026-HT100013");
    const inspectGit = vi.fn().mockResolvedValue({
      workspaceRealpath: "/work/project",
      targetRealpath: "/work/project/.worktrees/2026-HT100013",
      branch: "2026-HT100013",
      headCommit: "a".repeat(40),
      clean: false,
      isWorktree: true,
    });
    const resolve = vi.fn(async (workspaceRoot: string, requestedPath: string) => ({
      workspaceRealpath: "/work/project",
      targetRealpath: requestedPath,
      contained: true,
    }));

    await expect(resolveAssignmentWorkspace({
      bindingId: "workspace_1",
      configurationVersion: 3,
      pathFingerprint: "hmac-sha256:abcdef",
    }, {
      getWorkspaceByBindingId: vi.fn().mockResolvedValue({
        projectId: "project_1",
        bindingId: "workspace_1",
        absolutePath: "/work/project",
        realpath: "/work/project",
        configurationVersion: 3,
        pathFingerprint: "hmac-sha256:abcdef",
      }),
    }, { resolve, readFile, inspectGit }, {
      taskBranch: "2026-HT100013",
      nodeKey: "write_prd",
    })).resolves.toBe("/work/project/.worktrees/2026-HT100013");

    expect(inspectGit).toHaveBeenCalledWith(
      "/work/project",
      "/work/project/.worktrees/2026-HT100013",
    );
  });

  it("fails closed instead of falling back to the repository root when the task worktree is missing", async () => {
    const inspectGit = vi.fn().mockRejectedValue(new Error("not a git worktree"));
    await expect(resolveAssignmentWorkspace({
      bindingId: "workspace_1",
      configurationVersion: 3,
      pathFingerprint: "hmac-sha256:abcdef",
    }, {
      getWorkspaceByBindingId: vi.fn().mockResolvedValue({
        projectId: "project_1",
        bindingId: "workspace_1",
        absolutePath: "/work/project",
        realpath: "/work/project",
        configurationVersion: 3,
        pathFingerprint: "hmac-sha256:abcdef",
      }),
    }, {
      resolve: vi.fn(async (_root: string, requestedPath: string) => ({
        workspaceRealpath: "/work/project",
        targetRealpath: requestedPath,
        contained: true,
      })),
      inspectGit,
    }, {
      taskBranch: "2026-HT100013",
      nodeKey: "develop",
    })).rejects.toMatchObject({ code: "task_worktree_required" });
  });

  it("requires a task branch for every task execution stage", async () => {
    await expect(resolveAssignmentWorkspace({
      bindingId: "workspace_1",
      configurationVersion: 3,
      pathFingerprint: "hmac-sha256:abcdef",
    }, {
      getWorkspaceByBindingId: vi.fn().mockResolvedValue({
        projectId: "project_1",
        bindingId: "workspace_1",
        absolutePath: "/work/project",
        realpath: "/work/project",
        configurationVersion: 3,
        pathFingerprint: "hmac-sha256:abcdef",
      }),
    }, {
      resolve: vi.fn().mockResolvedValue({
        workspaceRealpath: "/work/project",
        targetRealpath: "/work/project",
        contained: true,
      }),
    }, {
      nodeKey: "develop",
    })).rejects.toMatchObject({ code: "task_worktree_required" });
  });

  it("rejects a task worktree whose inspected branch does not match the assignment", async () => {
    const inspectGit = vi.fn().mockResolvedValue({
      workspaceRealpath: "/work/project",
      targetRealpath: "/work/project/.worktrees/2026-HT100013",
      branch: "main",
      headCommit: "a".repeat(40),
      clean: true,
      isWorktree: true,
    });
    await expect(resolveAssignmentWorkspace({
      bindingId: "workspace_1",
      configurationVersion: 3,
      pathFingerprint: "hmac-sha256:abcdef",
    }, {
      getWorkspaceByBindingId: vi.fn().mockResolvedValue({
        projectId: "project_1",
        bindingId: "workspace_1",
        absolutePath: "/work/project",
        realpath: "/work/project",
        configurationVersion: 3,
        pathFingerprint: "hmac-sha256:abcdef",
      }),
    }, {
      resolve: vi.fn(async (_root: string, requestedPath: string) => ({
        workspaceRealpath: "/work/project",
        targetRealpath: requestedPath,
        contained: true,
      })),
      inspectGit,
    }, {
      taskBranch: "2026-HT100013",
      nodeKey: "develop",
    })).rejects.toMatchObject({ code: "task_worktree_required" });
  });

  it("blocks release stages without an explicitly bound release worktree", async () => {
    await expect(resolveAssignmentWorkspace({
      bindingId: "workspace_1",
      configurationVersion: 3,
      pathFingerprint: "hmac-sha256:abcdef",
    }, {
      getWorkspaceByBindingId: vi.fn().mockResolvedValue({
        projectId: "project_1",
        bindingId: "workspace_1",
        absolutePath: "/work/project",
        realpath: "/work/project",
        configurationVersion: 3,
        pathFingerprint: "hmac-sha256:abcdef",
      }),
    }, {
      resolve: vi.fn().mockResolvedValue({
        workspaceRealpath: "/work/project",
        targetRealpath: "/work/project",
        contained: true,
      }),
    }, {
      nodeKey: "integrate_staging",
      releaseBranch: "staging",
    })).rejects.toMatchObject({ code: "release_worktree_required" });
  });

  it("blocks release stages on a dirty release worktree", async () => {
    const inspectGit = vi.fn().mockResolvedValue({
      workspaceRealpath: "/work/project",
      targetRealpath: "/work/project/.worktrees/release-1",
      branch: "staging",
      headCommit: "a".repeat(40),
      clean: false,
      isWorktree: true,
    });
    await expect(resolveAssignmentWorkspace({
      bindingId: "workspace_1",
      configurationVersion: 3,
      pathFingerprint: "hmac-sha256:abcdef",
    }, {
      getWorkspaceByBindingId: vi.fn().mockResolvedValue({
        projectId: "project_1",
        bindingId: "workspace_1",
        absolutePath: "/work/project",
        realpath: "/work/project",
        configurationVersion: 3,
        pathFingerprint: "hmac-sha256:abcdef",
      }),
    }, {
      resolve: vi.fn(async (_root: string, requestedPath: string) => ({
        workspaceRealpath: "/work/project",
        targetRealpath: requestedPath,
        contained: true,
      })),
      inspectGit,
    }, {
      nodeKey: "integrate_staging",
      releaseBranch: "staging",
      releaseWorktreePath: ".worktrees/release-1",
    })).rejects.toMatchObject({ code: "release_worktree_dirty" });
  });

  it("rejects an absolute release worktree path even when it is inside the repository", async () => {
    await expect(resolveAssignmentWorkspace({
      bindingId: "workspace_1",
      configurationVersion: 3,
      pathFingerprint: "hmac-sha256:abcdef",
    }, {
      getWorkspaceByBindingId: vi.fn().mockResolvedValue({
        projectId: "project_1",
        bindingId: "workspace_1",
        absolutePath: "/work/project",
        realpath: "/work/project",
        configurationVersion: 3,
        pathFingerprint: "hmac-sha256:abcdef",
      }),
    }, {
      resolve: vi.fn().mockResolvedValue({
        workspaceRealpath: "/work/project",
        targetRealpath: "/work/project",
        contained: true,
      }),
    }, {
      nodeKey: "integrate_staging",
      releaseBranch: "staging",
      releaseWorktreePath: "/work/project/.worktrees/release-1",
    })).rejects.toMatchObject({ code: "release_worktree_required" });
  });

  it("prepares the task worktree before the create_worktree agent runs", async () => {
    const prepareTaskWorktree = vi.fn().mockResolvedValue(undefined);
    const inspectGit = vi.fn().mockResolvedValue({
      workspaceRealpath: "/work/project",
      targetRealpath: "/work/project/.worktrees/2026-HT100013",
      branch: "2026-HT100013",
      headCommit: "a".repeat(40),
      clean: true,
      isWorktree: true,
    });
    await expect(resolveAssignmentWorkspace({
      bindingId: "workspace_1",
      configurationVersion: 3,
      pathFingerprint: "hmac-sha256:abcdef",
    }, {
      getWorkspaceByBindingId: vi.fn().mockResolvedValue({
        projectId: "project_1",
        bindingId: "workspace_1",
        absolutePath: "/work/project",
        realpath: "/work/project",
        configurationVersion: 3,
        pathFingerprint: "hmac-sha256:abcdef",
      }),
    }, {
      resolve: vi.fn(async (_root: string, requestedPath: string) => ({
        workspaceRealpath: "/work/project",
        targetRealpath: requestedPath,
        contained: true,
      })),
      inspectGit,
      prepareTaskWorktree,
    }, {
      taskBranch: "2026-HT100013",
      taskBaseBranch: "main",
      nodeKey: "create_worktree",
    })).resolves.toBe("/work/project/.worktrees/2026-HT100013");
    expect(prepareTaskWorktree).toHaveBeenCalledWith(
      "/work/project",
      "2026-HT100013",
      "main",
    );
  });
  it("rejects a native-resolved symlink target outside the Workspace", async () => {
    await expect(assertPathInsideWorkspace({
      workspaceRoot: "/work/project",
      requestedPath: "/work/project/link/secrets.txt",
      resolveNativePath: async () => ({
        workspaceRealpath: "/work/project",
        targetRealpath: "/Users/alice/.ssh/id_ed25519",
        contained: false,
      }),
    })).rejects.toMatchObject({ code: "workspace_scope_denied" });
  });

  it("normalizes native path resolution errors as Workspace scope denials", async () => {
    await expect(assertPathInsideWorkspace({
      workspaceRoot: "/work/project",
      requestedPath: "/work/project/link/secrets.txt",
      resolveNativePath: async () => {
        throw new Error("Resolved path is outside the project Workspace");
      },
    })).rejects.toMatchObject({ code: "workspace_scope_denied" });
  });

  it("returns the native-resolved target realpath inside the Workspace", async () => {
    await expect(assertPathInsideWorkspace({
      workspaceRoot: "/work/project-link",
      requestedPath: "/work/project-link/src/index.ts",
      resolveNativePath: async () => ({
        workspaceRealpath: "/Volumes/code/project",
        targetRealpath: "/Volumes/code/project/src/index.ts",
        contained: true,
      }),
    })).resolves.toBe("/Volumes/code/project/src/index.ts");
  });

  it("invokes the native resolver with the requested Workspace boundary", async () => {
    const invoke = vi.fn().mockResolvedValue({
      workspaceRealpath: "/Volumes/code/project",
      targetRealpath: "/Volumes/code/project/src/index.ts",
      contained: true,
    });

    await expect(resolveWorkspaceBoundary({
      workspaceRoot: "/work/project-link",
      requestedPath: "/work/project-link/src/index.ts",
      invoke,
    })).resolves.toEqual({
      workspaceRealpath: "/Volumes/code/project",
      targetRealpath: "/Volumes/code/project/src/index.ts",
      contained: true,
    });
    expect(invoke).toHaveBeenCalledWith("resolve_workspace_path", {
      workspaceRoot: "/work/project-link",
      requestedPath: "/work/project-link/src/index.ts",
    });
  });

  it("maps workspace_full to full local Codex execution authority", () => {
    expect(buildCodexExecutionPolicy({
      permission: "workspace_full",
      workspaceRealpath: "/Volumes/code/project",
      networkTargets: [],
    })).toEqual({
      mode: "workspace_full",
      workspaceRealpath: "/Volumes/code/project",
    });
  });

  it("keeps read-only grants read-only without promoting network targets", () => {
    expect(buildCodexExecutionPolicy({
      permission: "read_only",
      workspaceRealpath: "/Volumes/code/project",
      networkTargets: ["api.example.com"],
    })).toEqual({
      mode: "read_only",
      workspaceRealpath: "/Volumes/code/project",
    });
  });

  it("joins only normalized project-relative paths to a Workspace", () => {
    expect(workspaceRelativePath("/Volumes/code/project", "packages/web/AGENTS.md"))
      .toBe("/Volumes/code/project/packages/web/AGENTS.md");
    expect(() => workspaceRelativePath("/Volumes/code/project", "../AGENTS.md"))
      .toThrow(expect.objectContaining({ code: "workspace_scope_denied" }));
    expect(() => workspaceRelativePath("/Volumes/code/project", "/tmp/AGENTS.md"))
      .toThrow(expect.objectContaining({ code: "workspace_scope_denied" }));
  });
});

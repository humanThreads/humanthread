import type { LoopAssignment } from "@humanthread/shared";
import type { LocalWorkspaceConfiguration } from "./execution-configuration";

export type WorkspacePathResolution = {
  workspaceRealpath: string;
  targetRealpath: string;
  contained: boolean;
};

export type WorkspaceGitIdentity = {
  workspaceRealpath: string;
  targetRealpath: string;
  branch: string;
  headCommit: string;
  clean: boolean;
  isWorktree: boolean;
};

export type WorkspaceExecutionEvidence = {
  workspaceRealpath: string;
  branch: string | null;
  headCommit: string | null;
  clean: boolean | null;
  isWorktree: boolean;
};

export type NativeWorkspacePathResolver = (
  workspaceRoot: string,
  requestedPath: string,
) => Promise<WorkspacePathResolution>;

export type NativeWorkspaceFileReader = (
  workspaceRoot: string,
  requestedPath: string,
  maxBytes?: number,
) => Promise<string | null>;

export type NativeWorkspaceFileWriter = (
  workspaceRoot: string,
  requestedPath: string,
  content: string,
) => Promise<unknown>;

export type NativeTaskWorktreePreparer = (
  workspaceRoot: string,
  taskBranch: string,
  baseBranch: string,
) => Promise<WorkspaceGitIdentity>;

function workspaceScopeDenied(): Error {
  return Object.assign(
    new Error("Resolved path is outside the project Workspace"),
    { code: "workspace_scope_denied" },
  );
}

export function workspaceRelativePath(workspaceRoot: string, relativePath: string): string {
  const normalizedRoot = workspaceRoot.replace(/\/+$/u, "") || "/";
  const validRelativePath = relativePath === "." || (
    relativePath.length > 0
    && relativePath.length <= 1_024
    && !relativePath.startsWith("/")
    && !relativePath.includes("\\")
    && !/^[a-z]:/iu.test(relativePath)
    && !/[\0-\x1f\x7f]/u.test(relativePath)
    && relativePath.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..")
  );
  if (!validRelativePath) throw workspaceScopeDenied();
  if (relativePath === ".") return normalizedRoot;
  return normalizedRoot === "/" ? `/${relativePath}` : `${normalizedRoot}/${relativePath}`;
}

type TaskArtifactRecoveryInput = {
  workspaceRoot: string;
  taskWorkspace: string;
  taskId: string;
  projectId: string;
  taskBranch: string;
  readFile: NativeWorkspaceFileReader;
  writeFile: NativeWorkspaceFileWriter;
};

const TASK_ARTIFACTS = [
  { manifest: "artifacts/write-prd/prd-manifest.json", document: "prd" },
  { manifest: "artifacts/write-plan/plan-manifest.json", document: "plan" },
] as const;

const TASK_ARTIFACT_MANIFEST_MAX_BYTES = 64 * 1024;
const TASK_ARTIFACT_DOCUMENT_MAX_BYTES = 1024 * 1024;

function parseTaskArtifactManifest(value: string | null): Record<string, unknown> | null {
  if (value === null) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function taskArtifactPath(manifest: Record<string, unknown>, kind: "prd" | "plan", taskBranch: string): string | null {
  const localPath = manifest.localPath;
  const expected = `docs/requirements/${taskBranch}/${kind}.md`;
  return typeof localPath === "string" && localPath === expected ? localPath : null;
}

/**
 * Bridges runs created before task-worktree execution was enforced. It only
 * copies current-task PRD/Plan artifacts from the project root and never
 * removes or resets anything in the destination worktree.
 */
export async function recoverTaskArtifacts(input: TaskArtifactRecoveryInput): Promise<{ recovered: string[] }> {
  const root = input.workspaceRoot.replace(/\/+$/u, "") || "/";
  const taskWorkspace = input.taskWorkspace.replace(/\/+$/u, "") || "/";
  if (
    !root.startsWith("/")
    || !taskWorkspace.startsWith(`${root}/`)
    || !/^\d{4}-[A-Za-z0-9][A-Za-z0-9_-]*$/u.test(input.taskBranch)
  ) return { recovered: [] };
  const taskWorkspaceRelative = taskWorkspace.slice(root.length + 1);
  const recovered: string[] = [];
  for (const artifact of TASK_ARTIFACTS) {
    const sourceManifestPath = workspaceRelativePath(input.workspaceRoot, artifact.manifest);
    const manifest = parseTaskArtifactManifest(await input.readFile(
      input.workspaceRoot,
      sourceManifestPath,
      TASK_ARTIFACT_MANIFEST_MAX_BYTES,
    ));
    if (
      !manifest
      || manifest.taskId !== input.taskId
      || manifest.projectId !== input.projectId
      || manifest.taskBranch !== input.taskBranch
    ) continue;
    const documentPath = taskArtifactPath(manifest, artifact.document, input.taskBranch);
    if (!documentPath) continue;
    const sourceDocumentPath = workspaceRelativePath(input.workspaceRoot, documentPath);
    const document = await input.readFile(
      input.workspaceRoot,
      sourceDocumentPath,
      TASK_ARTIFACT_DOCUMENT_MAX_BYTES,
    );
    if (document === null) continue;
    const targetManifestPath = workspaceRelativePath(input.workspaceRoot, `${taskWorkspaceRelative}/${artifact.manifest}`);
    const targetDocumentPath = workspaceRelativePath(input.workspaceRoot, `${taskWorkspaceRelative}/${documentPath}`);
    const targetManifest = await input.readFile(
      input.workspaceRoot,
      targetManifestPath,
      TASK_ARTIFACT_MANIFEST_MAX_BYTES,
    );
    const targetDocument = await input.readFile(
      input.workspaceRoot,
      targetDocumentPath,
      TASK_ARTIFACT_DOCUMENT_MAX_BYTES,
    );
    const parsedTargetManifest = parseTaskArtifactManifest(targetManifest);
    const targetBelongsToCurrentTask = parsedTargetManifest?.taskId === input.taskId
      && parsedTargetManifest.projectId === input.projectId
      && parsedTargetManifest.taskBranch === input.taskBranch;
    // Worktree-local task artifacts are authoritative during retry and rework.
    // Only an orphaned manifest from another task, with no paired document,
    // may be replaced by the current task's root artifact during migration.
    if (targetBelongsToCurrentTask || targetDocument !== null) continue;
    await input.writeFile(input.workspaceRoot, targetManifestPath, JSON.stringify(manifest, null, 2));
    await input.writeFile(input.workspaceRoot, targetDocumentPath, document);
    recovered.push(artifact.manifest, documentPath);
  }
  return { recovered };
}

function staleWorkspaceConfiguration(): Error {
  return Object.assign(new Error("Local Workspace configuration is stale"), {
    code: "workspace_configuration_stale",
  });
}

function taskWorktreeRequired(message = "Task execution requires a matching task worktree"): Error {
  return Object.assign(new Error(message), { code: "task_worktree_required" });
}

function releaseWorktreeRequired(message = "Release execution requires an explicitly bound release worktree"): Error {
  return Object.assign(new Error(message), { code: "release_worktree_required" });
}

function releaseWorktreeDirty(): Error {
  return Object.assign(new Error("Release worktree must be clean before execution"), {
    code: "release_worktree_dirty",
  });
}

const TASK_WORKTREE_PREPARATION_NODES = new Set(["create_worktree", "prepare_task_branch"]);
const TASK_WORKTREE_NODES = new Set([
  "get_requirement",
  "analyze_requirement",
  "write_prd",
  "write_plan",
  "develop",
  "test",
  "business_test",
  "upload_screenshot",
  "push_branch",
  "cleanup",
  "verify_and_push",
]);
const RELEASE_WORKTREE_NODES = new Set(["integrate_staging", "business_test", "release_production"]);

function isTaskWorktreeNode(nodeKey: string): boolean {
  return TASK_WORKTREE_PREPARATION_NODES.has(nodeKey) || TASK_WORKTREE_NODES.has(nodeKey);
}

function isReleaseWorktreeNode(nodeKey: string, taskBranch: string): boolean {
  return RELEASE_WORKTREE_NODES.has(nodeKey) && !taskBranch;
}

function validateTaskBranch(taskBranch: string): boolean {
  return /^\d{4}-[A-Za-z0-9][A-Za-z0-9_-]*$/u.test(taskBranch);
}

async function inspectWorkspaceGit(
  nativeRuntime: {
    inspectGit?: (workspaceRoot: string, requestedPath: string) => Promise<WorkspaceGitIdentity>;
  },
  workspaceRoot: string,
  requestedPath: string,
): Promise<WorkspaceGitIdentity> {
  if (!nativeRuntime.inspectGit) throw taskWorktreeRequired("Native Git worktree inspection is unavailable");
  try {
    const identity = await nativeRuntime.inspectGit(workspaceRoot, requestedPath);
    if (
      identity.workspaceRealpath !== workspaceRoot
      || identity.targetRealpath !== requestedPath
      || !identity.branch
      || !/^[a-f0-9]{40,64}$/u.test(identity.headCommit)
      || typeof identity.clean !== "boolean"
      || identity.isWorktree !== true
    ) throw new Error("Native Git worktree identity is invalid");
    return identity;
  } catch (error) {
    if (error && typeof error === "object" && Reflect.get(error, "code") === "release_worktree_dirty") throw error;
    throw new Error("Git worktree identity could not be verified");
  }
}

async function resolveAssignmentWorkspaceInternal(
  assignment: LoopAssignment["workspace"],
  localStore: {
    getWorkspaceByBindingId(bindingId: string): Promise<LocalWorkspaceConfiguration | null>;
  },
  nativeRuntime: {
    resolve(workspaceRoot: string, requestedPath: string): Promise<WorkspacePathResolution>;
    readFile?: NativeWorkspaceFileReader;
    writeFile?: NativeWorkspaceFileWriter;
    inspectGit?: (workspaceRoot: string, requestedPath: string) => Promise<WorkspaceGitIdentity>;
    prepareTaskWorktree?: NativeTaskWorktreePreparer;
  },
  options: {
    taskId?: string | null;
    projectId?: string | null;
    taskBranch?: string | null;
    taskBaseBranch?: string | null;
    nodeKey?: string | null;
    releaseBranch?: string | null;
    releaseWorktreePath?: string | null;
  } = {},
): Promise<WorkspaceExecutionEvidence> {
  const local = await localStore.getWorkspaceByBindingId(assignment.bindingId);
  if (
    !local
    || local.bindingId !== assignment.bindingId
    || local.configurationVersion !== assignment.configurationVersion
    || local.pathFingerprint !== assignment.pathFingerprint
  ) throw staleWorkspaceConfiguration();
  let resolution: WorkspacePathResolution;
  try {
    resolution = await nativeRuntime.resolve(local.absolutePath, local.absolutePath);
  } catch {
    throw staleWorkspaceConfiguration();
  }
  if (
    !resolution.contained
    || resolution.workspaceRealpath !== local.realpath
    || resolution.targetRealpath !== local.realpath
  ) throw staleWorkspaceConfiguration();

  const taskBranch = options.taskBranch?.trim() ?? "";
  const nodeKey = options.nodeKey?.trim() ?? "";
  const isWorktreePreparation = TASK_WORKTREE_PREPARATION_NODES.has(nodeKey);
  const isTaskStage = isTaskWorktreeNode(nodeKey);
  const isReleaseStage = isReleaseWorktreeNode(nodeKey, taskBranch);

  if (isTaskStage) {
    if (!taskBranch || !validateTaskBranch(taskBranch)) throw taskWorktreeRequired("Task branch is missing or invalid");
    if (isWorktreePreparation) {
      const taskBaseBranch = options.taskBaseBranch?.trim() ?? "";
      if (!taskBaseBranch || !nativeRuntime.prepareTaskWorktree) {
        throw taskWorktreeRequired("Native task worktree preparation is unavailable");
      }
      try {
        await nativeRuntime.prepareTaskWorktree(local.realpath, taskBranch, taskBaseBranch);
      } catch {
        throw taskWorktreeRequired("Task worktree could not be prepared");
      }
    }

    const taskWorktree = workspaceRelativePath(local.realpath, `.worktrees/${taskBranch}`);
    const taskResolution = await nativeRuntime.resolve(local.realpath, taskWorktree).catch(() => null);
    if (
      !taskResolution
      || !taskResolution.contained
      || taskResolution.workspaceRealpath !== local.realpath
      || taskResolution.targetRealpath !== taskWorktree
    ) throw taskWorktreeRequired();
    let identity: WorkspaceGitIdentity;
    try {
      identity = await inspectWorkspaceGit(nativeRuntime, local.realpath, taskWorktree);
    } catch {
      throw taskWorktreeRequired();
    }
    if (identity.branch !== taskBranch) throw taskWorktreeRequired("Task worktree branch does not match the assignment");
    if (nativeRuntime.readFile && nativeRuntime.writeFile && options.taskId && local.projectId && options.projectId === local.projectId) {
      await recoverTaskArtifacts({
        workspaceRoot: local.realpath,
        taskWorkspace: taskResolution.targetRealpath,
        taskId: options.taskId,
        projectId: local.projectId,
        taskBranch,
        readFile: nativeRuntime.readFile,
        writeFile: nativeRuntime.writeFile,
      });
    }
    return {
      workspaceRealpath: identity.targetRealpath,
      branch: identity.branch,
      headCommit: identity.headCommit,
      clean: identity.clean,
      isWorktree: identity.isWorktree,
    };
  }

  if (isReleaseStage) {
    const releaseBranch = options.releaseBranch?.trim() ?? "";
    const releaseWorktreePath = options.releaseWorktreePath?.trim() ?? "";
    if (!releaseBranch || !releaseWorktreePath || releaseWorktreePath === ".") throw releaseWorktreeRequired();
    let releasePath: string;
    try {
      releasePath = workspaceRelativePath(local.realpath, releaseWorktreePath);
    } catch {
      throw releaseWorktreeRequired("Release worktree path is invalid");
    }
    const releaseResolution = await nativeRuntime.resolve(local.realpath, releasePath).catch(() => null);
    if (
      !releaseResolution
      || !releaseResolution.contained
      || releaseResolution.workspaceRealpath !== local.realpath
      || releaseResolution.targetRealpath !== releasePath
    ) throw releaseWorktreeRequired();
    let identity: WorkspaceGitIdentity;
    try {
      identity = await inspectWorkspaceGit(nativeRuntime, local.realpath, releasePath);
    } catch {
      throw releaseWorktreeRequired();
    }
    if (identity.branch !== releaseBranch) throw releaseWorktreeRequired("Release worktree branch does not match the configured branch");
    if (!identity.clean) throw releaseWorktreeDirty();
    return {
      workspaceRealpath: identity.targetRealpath,
      branch: identity.branch,
      headCommit: identity.headCommit,
      clean: identity.clean,
      isWorktree: identity.isWorktree,
    };
  }

  return {
    workspaceRealpath: resolution.targetRealpath,
    branch: null,
    headCommit: null,
    clean: null,
    isWorktree: false,
  };
}

export async function resolveAssignmentWorkspace(
  assignment: LoopAssignment["workspace"],
  localStore: {
    getWorkspaceByBindingId(bindingId: string): Promise<LocalWorkspaceConfiguration | null>;
  },
  nativeRuntime: {
    resolve(workspaceRoot: string, requestedPath: string): Promise<WorkspacePathResolution>;
    readFile?: NativeWorkspaceFileReader;
    writeFile?: NativeWorkspaceFileWriter;
    inspectGit?: (workspaceRoot: string, requestedPath: string) => Promise<WorkspaceGitIdentity>;
    prepareTaskWorktree?: NativeTaskWorktreePreparer;
  },
  options: {
    taskId?: string | null;
    projectId?: string | null;
    taskBranch?: string | null;
    taskBaseBranch?: string | null;
    nodeKey?: string | null;
    releaseBranch?: string | null;
    releaseWorktreePath?: string | null;
  } = {},
): Promise<string> {
  return (await resolveAssignmentWorkspaceInternal(assignment, localStore, nativeRuntime, options)).workspaceRealpath;
}

export async function resolveAssignmentWorkspaceWithEvidence(
  assignment: LoopAssignment["workspace"],
  localStore: {
    getWorkspaceByBindingId(bindingId: string): Promise<LocalWorkspaceConfiguration | null>;
  },
  nativeRuntime: {
    resolve(workspaceRoot: string, requestedPath: string): Promise<WorkspacePathResolution>;
    readFile?: NativeWorkspaceFileReader;
    writeFile?: NativeWorkspaceFileWriter;
    inspectGit?: (workspaceRoot: string, requestedPath: string) => Promise<WorkspaceGitIdentity>;
    prepareTaskWorktree?: NativeTaskWorktreePreparer;
  },
  options: {
    taskId?: string | null;
    projectId?: string | null;
    taskBranch?: string | null;
    taskBaseBranch?: string | null;
    nodeKey?: string | null;
    releaseBranch?: string | null;
    releaseWorktreePath?: string | null;
  } = {},
): Promise<WorkspaceExecutionEvidence> {
  return resolveAssignmentWorkspaceInternal(assignment, localStore, nativeRuntime, options);
}

export type CodexExecutionPolicy =
  | { mode: "read_only"; workspaceRealpath: string }
  | { mode: "workspace_full"; workspaceRealpath: string };

type NativeInvoke = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;

function parseWorkspacePathResolution(value: unknown): WorkspacePathResolution {
  if (
    !value
    || typeof value !== "object"
    || typeof (value as Record<string, unknown>).workspaceRealpath !== "string"
    || typeof (value as Record<string, unknown>).targetRealpath !== "string"
    || typeof (value as Record<string, unknown>).contained !== "boolean"
  ) {
    throw new Error("Native Workspace path resolution is invalid");
  }

  const resolution = value as WorkspacePathResolution;
  return {
    workspaceRealpath: resolution.workspaceRealpath,
    targetRealpath: resolution.targetRealpath,
    contained: resolution.contained,
  };
}

export async function resolveWorkspaceBoundary(input: {
  workspaceRoot: string;
  requestedPath: string;
  invoke: NativeInvoke;
}): Promise<WorkspacePathResolution> {
  const value = await input.invoke("resolve_workspace_path", {
    workspaceRoot: input.workspaceRoot,
    requestedPath: input.requestedPath,
  });
  return parseWorkspacePathResolution(value);
}

export async function assertPathInsideWorkspace(input: {
  workspaceRoot: string;
  requestedPath: string;
  resolveNativePath: NativeWorkspacePathResolver;
}): Promise<string> {
  let resolution: WorkspacePathResolution;
  try {
    resolution = await input.resolveNativePath(
      input.workspaceRoot,
      input.requestedPath,
    );
  } catch {
    throw workspaceScopeDenied();
  }
  if (!resolution.contained) {
    throw workspaceScopeDenied();
  }
  return resolution.targetRealpath;
}

export function buildCodexExecutionPolicy(input: {
  permission: "read_only" | "workspace_full";
  workspaceRealpath: string;
  networkTargets: string[];
}): CodexExecutionPolicy {
  return {
    mode: input.permission,
    workspaceRealpath: input.workspaceRealpath,
  };
}

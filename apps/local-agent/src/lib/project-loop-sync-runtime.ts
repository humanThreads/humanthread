import { getNativeBridge } from "./native-bridge";
import {
  initializeProjectLoops,
  projectLoopCatalogV2Schema,
  projectLoopLockV2Schema,
  readProjectLoopStageContract,
  readProjectLoopInitializationState,
  resolveStageResources,
  type ProjectLoopStageContract,
  type ProjectLoopSyncFilesystem,
  type ResolvedStageResources,
} from "@humanthread/project-loop-sync";

import type { NativeLoopWorkerCredentials } from "./loop-worker-runtime";
import { workspaceRelativePath } from "./workspace-policy";

type NativeInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

function runtimeError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

function nativeWorkspaceReadError(error: unknown, relativePath: string): Error {
  const message = typeof error === "string"
    ? error
    : error instanceof Error
      ? error.message
      : error && typeof error === "object" && typeof Reflect.get(error, "message") === "string"
        ? String(Reflect.get(error, "message"))
        : "Native Workspace read failed";
  if (message.includes("Workspace file exceeds the requested read limit")) {
    return runtimeError("workspace_file_too_large", `${message}: ${relativePath}`);
  }
  return runtimeError("workspace_read_failed", `${message}: ${relativePath}`);
}

function parseJson<T>(content: string | null, parse: (value: unknown) => T, label: string): T | null {
  if (content === null) return null;
  try { return parse(JSON.parse(content)); } catch { throw runtimeError("local_structure_invalid", `${label} is invalid`); }
}

function defaultNativeInvoke(command: string, args?: Record<string, unknown>): Promise<unknown> {
  const bridge = getNativeBridge();
  if (!bridge) {
    throw new Error("本地系统动作仅在桌面客户端中可用。");
  }
  return bridge.invoke(command, args);
}

export function createNativeProjectLoopFilesystem(
  workspaceRoot: string,
  invoke: NativeInvoke = defaultNativeInvoke,
): ProjectLoopSyncFilesystem {
  const requestedPath = (relativePath: string) => workspaceRelativePath(workspaceRoot, relativePath);
  return {
    async readText(relativePath) {
      let value: unknown;
      try {
        value = await invoke("read_workspace_file", { workspaceRoot, requestedPath: requestedPath(relativePath), maxBytes: 1024 * 1024 });
      } catch (error) {
        throw nativeWorkspaceReadError(error, relativePath);
      }
      if (value === null) return null;
      if (typeof value !== "string") throw runtimeError("local_structure_invalid", "Native Workspace read result is invalid");
      return value;
    },
    async listTree(relativePath) {
      const value = await invoke("list_workspace_tree", { workspaceRoot, requestedPath: requestedPath(relativePath), maxEntries: 10_000 });
      if (!Array.isArray(value) || value.some((path) => typeof path !== "string")) {
        throw runtimeError("local_structure_invalid", "Native Workspace tree result is invalid");
      }
      return value as string[];
    },
    async mkdir(relativePath) {
      await invoke("create_workspace_directory", { workspaceRoot, requestedPath: requestedPath(relativePath) });
    },
    async writeTextExclusive(relativePath, content) {
      await invoke("create_workspace_file", { workspaceRoot, requestedPath: requestedPath(relativePath), content });
    },
    async writeTextAtomic(relativePath, content) {
      await invoke("replace_workspace_structure_file", { workspaceRoot, requestedPath: requestedPath(relativePath), content });
    },
    async renameExclusive(from, to) {
      await invoke("rename_workspace_loop_path", {
        workspaceRoot,
        fromPath: requestedPath(from),
        toPath: requestedPath(to),
      });
    },
    async removeTransactionTree(relativePath) {
      await invoke("remove_workspace_sync_transaction", {
        workspaceRoot,
        requestedPath: requestedPath(relativePath),
      });
    },
  };
}

async function readAgentCatalog(input: {
  projectId: string;
  credentials: NativeLoopWorkerCredentials;
  fetch: typeof fetch;
}) {
  const query = new URLSearchParams({ userId: input.credentials.userId, deviceId: input.credentials.deviceId });
  let response: Response;
  try {
    response = await input.fetch(
      `${input.credentials.apiBaseUrl.replace(/\/+$/u, "")}/api/agent/projects/${encodeURIComponent(input.projectId)}/loop-catalog?${query.toString()}`,
      {
        headers: {
          ...(input.credentials.apiToken.trim() ? { authorization: `Bearer ${input.credentials.apiToken.trim()}` } : {}),
          "x-agent-device-token": input.credentials.deviceToken.trim(),
        },
      },
    );
  } catch {
    throw runtimeError("loop_catalog_unavailable", "Desktop could not reach the project Loop catalog");
  }
  let payload: unknown;
  try {
    payload = await response.json() as unknown;
  } catch {
    throw runtimeError("loop_catalog_unavailable", "Desktop received an unreadable project Loop catalog response");
  }
  if (!response.ok || !payload || typeof payload !== "object" || Reflect.get(payload, "ok") !== true) {
    throw runtimeError("loop_catalog_unavailable", "Desktop could not load the project Loop catalog");
  }
  const parsed = projectLoopCatalogV2Schema.safeParse(Reflect.get(payload, "result"));
  if (!parsed.success || parsed.data.projectId !== input.projectId) throw runtimeError("invalid_loop_catalog", "Desktop received an invalid project Loop catalog");
  return parsed.data;
}

export async function syncProjectLoops(
  input: { workspaceRoot: string; projectId: string; credentials: NativeLoopWorkerCredentials },
  dependencies: { invoke?: NativeInvoke; fetch?: typeof fetch; now?: () => Date } = {},
) {
  const fs = createNativeProjectLoopFilesystem(input.workspaceRoot, dependencies.invoke);
  const previousState = await readProjectLoopInitializationState(fs);
  const catalog = await readAgentCatalog({ projectId: input.projectId, credentials: input.credentials, fetch: dependencies.fetch ?? fetch });
  return initializeProjectLoops({
    fs,
    catalog,
    previousState,
    now: (dependencies.now ?? (() => new Date()))(),
  });
}

export type NativeProjectLoopStageContract = {
  stage: ProjectLoopStageContract;
  resourcesByExecId: Record<string, ResolvedStageResources>;
};

export async function readNativeProjectLoopStageContract(input: {
  workspaceRoot: string;
  nodeId: string;
  stageRef?: {
    loopDefinitionId: string;
    loopVersionId: string;
    nodeId: string;
    subloopId: string;
  };
  assignmentGraph: unknown;
  invoke?: NativeInvoke;
}): Promise<NativeProjectLoopStageContract> {
  const fs = createNativeProjectLoopFilesystem(input.workspaceRoot, input.invoke);
  const lockText = await fs.readText(".humanthread/structure/lock.json");
  if (lockText === null) throw runtimeError("project_not_initialized", "Run ht init before starting this Loop");
  const lock = parseJson(lockText, (value) => projectLoopLockV2Schema.parse(value), "Loop lockfile");
  if (!lock) throw runtimeError("project_not_initialized", "Run ht init before starting this Loop");

  const subloopId = input.stageRef?.subloopId ?? input.nodeId;
  const entries = Object.values(lock.subloops).filter((entry) => (
    entry.stableId === subloopId
    && (!input.stageRef || entry.parentLoopId === input.stageRef.loopDefinitionId)
  ));
  if (entries.length === 0) throw runtimeError("stage_not_found", `Local lockfile does not contain Stage ${subloopId}`);
  if (entries.length > 1) throw runtimeError("stage_identity_ambiguous", `Local lockfile does not identify one Stage for ${subloopId}`);
  const stage = await readProjectLoopStageContract({ entry: entries[0]!, readText: (path) => fs.readText(path) });
  if (!stage.configured) throw runtimeError("stage_unconfigured", `Local Stage is not configured: ${input.nodeId}`);
  const resourcesByExecId: Record<string, ResolvedStageResources> = {};
  for (const exec of stage.agents.execRuns) {
    resourcesByExecId[exec.execId] = await resolveStageResources({
      stage,
      execId: exec.execId,
      readText: (path) => fs.readText(path),
      listTree: (path) => fs.listTree(path),
    });
  }
  return { stage, resourcesByExecId };
}

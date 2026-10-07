import { createHash } from "node:crypto";

import {
  buildLocalAgentWorkerId,
  type LiveSessionDispatch,
  type LoopAssignment,
} from "@humanthread/shared";

import type { ReasoningEffort } from "@humanthread/shared";

import { createNativeLoopOutboxStore } from "../desktop/loop-outbox-store";
import {
  createNativeExecutionConfigStore,
  type LocalExecutionConfigStore,
} from "../desktop/execution-config-store";
import { getNativeBridge } from "./native-bridge";
import { publishLocalWorkerActivity } from "../desktop/worker-preferences";
import { localAgentCapabilitySnapshot } from "./agent-capabilities";
import { AGENT_BUILD_VERSION } from "./build-version";
import { appendLoopExecutionLog } from "./loop-execution-logs";
import { createLoopAssignmentApi, type LoopAssignmentApiCredentials } from "./loop-assignment-api";
import {
  flushAssignmentOutbox,
  runLoopAssignment,
  startLoopWorker,
  type LoopRunnerDependencies,
} from "./loop-assignment-runner";
import type { LoopOutbox, LoopOutboxRecord } from "./loop-outbox";
import {
  createNativeCodexSpawn,
  type NativeCodexEventListener,
  type NativeCodexOutput,
} from "./native-codex-process";
import { createCodexAdapter } from "./providers/codex-adapter";
import { createCodexAppServerAdapter } from "./providers/codex-app-server-adapter";
import { buildCodexDaemonProcessKey } from "./providers/codex-app-server-binding";
import { createCodexAppServerClient } from "./providers/codex-app-server-client";
import {
  resolveProviderAdapter,
  type AgentProviderAdapter,
  type StructuredProviderExecutionInput,
} from "./providers/provider-adapter";
import { createNativeLocalModelCommands } from "./native-local-model-commands";
import {
  resolveLocalModelExecution,
  type LocalModelExecutionOptions,
} from "./local-model-routing-runtime";
import { loadProjectConstraints } from "./project-constraints";
import {
  readNativeProjectLoopStageContract,
  syncProjectLoops,
} from "./project-loop-sync-runtime";
import {
  resolveAssignmentWorkspaceWithEvidence,
  resolveWorkspaceBoundary,
  workspaceRelativePath,
  type WorkspaceGitIdentity,
} from "./workspace-policy";

type NativeInvoke = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;

type DirectAgentLiveSessionRuntime = {
  close(): Promise<void>;
};

/**
 * Starts a taskless Agent conversation on this Desktop. The platform supplies
 * only the relay ticket; the local model site, credential and working directory
 * stay under Desktop control.
 */
export async function openDirectAgentLiveSession(input: {
  session: LiveSessionDispatch;
  credentials: NativeLoopWorkerCredentials;
  invoke?: NativeInvoke;
  listen?: Parameters<typeof createCodexAppServerClient>[0]["listen"];
  executionStore?: Pick<LocalExecutionConfigStore, "getRuntime">;
  resolveWorkspace(input: { deviceId: string; sessionId: string }): Promise<string>;
  loadModelExecution?: () => Promise<LocalModelExecutionOptions | undefined>;
  /**
   * Resolves a platform-selected site against this device's own sites and
   * credentials. Must fail with `local_model_site_unavailable` when the site or
   * model is gone; falling back to the account default would silently run a
   * different model than the user chose.
   */
  loadSelectedModelExecution?: (input: {
    siteId: string;
    model: string;
    reasoningEffort: ReasoningEffort;
  }) => Promise<LocalModelExecutionOptions | undefined>;
  /** Test seam for the local model command surface. */
  createLocalModelCommands?: typeof createNativeLocalModelCommands;
}): Promise<DirectAgentLiveSessionRuntime> {
  if (input.session.kind !== "agent" || input.session.executionPolicy !== "direct") {
    throw Object.assign(new Error("Direct Agent runtime received an incompatible LiveSession"), {
      code: "live_session_invalid",
    });
  }
  if (input.session.target.type !== "agent_device" || input.session.target.deviceId !== input.credentials.deviceId) {
    throw Object.assign(new Error("Direct Agent LiveSession targets another device"), {
      code: "agent_device_required",
    });
  }
  const invoke = input.invoke ?? defaultNativeInvoke;
  const workspace = await input.resolveWorkspace({
    deviceId: input.credentials.deviceId,
    sessionId: input.session.sessionId,
  });
  const executionStore = input.executionStore
    ?? await createNativeExecutionConfigStore({ deviceId: input.credentials.deviceId });
  const runtime = await executionStore.getRuntime("codex");
  // A platform selection is authoritative: resolve it locally and never touch
  // the account default. Absence keeps the previous behaviour for older callers.
  const selection = input.session.modelSelection;
  const model = selection
    ? input.loadSelectedModelExecution
      ? await input.loadSelectedModelExecution(selection)
      : await resolveSelectedAgentModelExecution(
          input.credentials,
          selection,
          input.createLocalModelCommands ?? createNativeLocalModelCommands,
        )
    : input.loadModelExecution
      ? await input.loadModelExecution()
      : await resolveDirectAgentModelExecution(input.credentials);
  const processKey = buildCodexDaemonProcessKey({
    deploymentOrigin: input.credentials.apiBaseUrl,
    userId: input.credentials.userId,
    credentialRef: model?.credentialContext?.credentialRef ?? null,
    providerBaseUrl: model?.environmentOverrides?.OPENAI_BASE_URL ?? null,
    executable: runtime?.command ?? "codex",
    environmentRefs: runtime?.environmentRefs ?? [],
  });
  const client = createCodexAppServerClient({
    invoke,
    listen: input.listen ?? nativeListenForDefaultBridge(),
    processKey,
  });
  const server = await client.start({
    cwd: workspace,
    ...(model?.model === undefined ? {} : { model: model.model }),
    ...(model?.reasoningEffort === undefined ? {} : { reasoningEffort: model.reasoningEffort }),
    ...(runtime?.command ? { executable: runtime.command } : {}),
    ...(runtime?.environmentRefs ? { environmentRefs: runtime.environmentRefs } : {}),
    ...(model?.environmentOverrides ? { environmentOverrides: model.environmentOverrides } : {}),
    ...(model?.credentialContext === undefined ? {} : { credentialContext: model.credentialContext }),
    ...(model?.isolationContext === undefined ? {} : { isolationContext: model.isolationContext }),
  });
  const started = await client.request("thread/start", {
    cwd: workspace,
    ...(model?.model === undefined ? {} : { model: model.model }),
    sandbox: "danger-full-access",
    approvalPolicy: "never",
  });
  const thread = threadIdFromResponse(started);
  const bridge = createCodexTuiSessionBridge(<T>(command: string, args?: Record<string, unknown>) => (
    invoke(command, args) as Promise<T>
  ));
  await bridge.onSessionBinding({
    runId: `direct:${input.session.sessionId}`,
    processKey: server.processKey,
    threadId: thread,
    cwd: workspace,
    model: model?.model ?? null,
    taskId: input.session.taskId,
    projectId: input.session.projectId,
    liveSession: {
      sessionId: input.session.sessionId,
      relayUrl: input.session.relayUrl,
      authorization: input.session.authorization,
    },
  });
  let closed = false;
  return {
    async close() {
      if (closed) return;
      closed = true;
      await bridge.onSessionEnd(
        `direct:${input.session.sessionId}`,
        input.session.sessionId,
      ).catch(() => undefined);
      await client.stop().catch(() => undefined);
    },
  };
}

/**
 * Resolves a platform-selected model against the local site document. The
 * platform never holds the credential, so the site is validated here and a
 * missing site is a hard failure rather than a silent fallback.
 */
async function resolveSelectedAgentModelExecution(
  credentials: NativeLoopWorkerCredentials,
  selection: { siteId: string; model: string; reasoningEffort: ReasoningEffort },
  createCommands: typeof createNativeLocalModelCommands = createNativeLocalModelCommands,
): Promise<LocalModelExecutionOptions | undefined> {
  const commands = createCommands({
    deploymentOrigin: credentials.apiBaseUrl,
    userId: credentials.userId,
  }, defaultNativeInvoke);
  const sites = await commands.listSites();
  const site = sites.sites.find((candidate) => candidate.siteId === selection.siteId);
  if (!site) {
    throw Object.assign(new Error("本机已无此模型站点，请重新选择"), {
      code: "local_model_site_unavailable",
    });
  }
  const catalog = await commands.getCatalog();
  const models = catalog.sites[site.siteId]?.models ?? [];
  const model = models.find((entry) => entry.name === selection.model);
  // An empty catalogue means the site never listed candidates; without an entry
  // there is no modelKey to resolve, so the selection cannot be honoured.
  if (!model) {
    throw Object.assign(new Error("本机已无此模型，请重新选择"), {
      code: "local_model_site_unavailable",
    });
  }
  const routing = await commands.getRouting();
  return resolveLocalModelExecution({
    loopDefinitionId: "direct",
    nodeId: "direct",
    provider: "codex",
    deploymentOrigin: credentials.apiBaseUrl,
    userId: credentials.userId,
    platformReasoningEffort: selection.reasoningEffort,
    sites: {
      ...sites,
      // The platform chose by name; the local resolver selects by modelKey.
      accountDefault: { siteId: site.siteId, modelKey: model.modelKey, reasoningEffort: selection.reasoningEffort },
    },
    catalog,
    routing,
  });
}

async function resolveDirectAgentModelExecution(
  credentials: NativeLoopWorkerCredentials,
): Promise<LocalModelExecutionOptions | undefined> {
  const commands = createNativeLocalModelCommands({
    deploymentOrigin: credentials.apiBaseUrl,
    userId: credentials.userId,
  }, defaultNativeInvoke);
  const sites = await commands.listSites();
  if (!sites.accountDefault) {
    throw Object.assign(new Error("请先在 Desktop 设置中配置账号默认模型"), {
      code: "local_model_configuration_invalid",
    });
  }
  const [catalog, routing] = await Promise.all([commands.getCatalog(), commands.getRouting()]);
  return resolveLocalModelExecution({
    loopDefinitionId: "direct",
    nodeId: "direct",
    provider: "codex",
    deploymentOrigin: credentials.apiBaseUrl,
    userId: credentials.userId,
    sites,
    catalog,
    routing,
  });
}

function nativeListenForDefaultBridge(): Parameters<typeof createCodexAppServerClient>[0]["listen"] {
  return (event, handler) => {
    const bridge = getNativeBridge();
    if (!bridge) throw new Error("本地系统动作仅在桌面客户端中可用。");
    return bridge.listen(event, handler);
  };
}

function threadIdFromResponse(value: unknown): string {
  const response = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const thread = response.thread && typeof response.thread === "object" && !Array.isArray(response.thread)
    ? response.thread as Record<string, unknown>
    : {};
  const direct = typeof response.threadId === "string" ? response.threadId : null;
  const nested = typeof thread.id === "string" ? thread.id : null;
  const threadId = direct ?? nested;
  if (!threadId || threadId.length > 256 || /[\u0000-\u001F\u007F]/u.test(threadId)) {
    throw Object.assign(new Error("Codex app-server did not return a thread ID"), {
      code: "provider_protocol_error",
    });
  }
  return threadId;
}

export function liveSessionIdForAgentRun(runId: string): string {
  return createHash("md5").update("live-session\0").update(runId).digest("hex");
}

export function createCodexTuiSessionBridge(
  invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T>,
) {
  return {
    async onSessionBinding(binding: {
      runId: string;
      processKey: string;
      threadId: string;
      cwd: string;
      model: string | null;
      taskId?: string | null;
      projectId?: string | null;
      nodeKey?: string | null;
      liveSession?: {
        sessionId: string;
        relayUrl: string;
        authorization: string;
      };
    }): Promise<void> {
      const sessionId = binding.liveSession?.sessionId ?? liveSessionIdForAgentRun(binding.runId);
      await invoke("start_codex_tui_session", {
        sessionId,
        runId: binding.runId,
        processKey: binding.processKey,
        threadId: binding.threadId,
        cwd: binding.cwd,
        model: binding.model,
        taskId: binding.taskId ?? null,
        projectId: binding.projectId ?? null,
        nodeKey: binding.nodeKey ?? null,
      });
      if (binding.liveSession) {
        await invoke("open_live_session", {
          sessionId,
          relayUrl: binding.liveSession.relayUrl,
          authorization: binding.liveSession.authorization,
        });
      }
    },
    async onSessionEnd(runId: string, liveSessionId?: string): Promise<void> {
      const sessionId = liveSessionId ?? liveSessionIdForAgentRun(runId);
      await invoke("close_live_session", { sessionId });
      await invoke("freeze_codex_tui_session", { sessionId });
    },
  };
}

export async function writeNativeResultSchema(input: {
  workspaceRealpath: string;
  relativePath: string;
  schema: unknown;
  invoke: NativeInvoke;
}): Promise<string> {
  const separator = input.workspaceRealpath.endsWith("/") ? "" : "/";
  const requestedPath = `${input.workspaceRealpath}${separator}${input.relativePath}`;
  const value = await input.invoke("write_workspace_file", {
    workspaceRoot: input.workspaceRealpath,
    requestedPath,
    content: JSON.stringify(input.schema),
  });
  if (typeof value !== "string") throw new Error("Native result Schema path is invalid");
  return value;
}

export async function readNativeStageArtifact(input: {
  workspaceRealpath: string;
  relativePath: string;
  invoke: NativeInvoke;
}): Promise<string | null> {
  const value = await input.invoke("read_workspace_file", {
    workspaceRoot: input.workspaceRealpath,
    requestedPath: workspaceRelativePath(input.workspaceRealpath, input.relativePath),
    maxBytes: 1024 * 1024,
  });
  if (value !== null && typeof value !== "string") throw new Error("Native Stage artifact result is invalid");
  return value as string | null;
}

export async function readNativeWorkspaceFile(input: {
  workspaceRoot: string;
  requestedPath: string;
  maxBytes: number;
  invoke: NativeInvoke;
}): Promise<string | null> {
  const value = await input.invoke("read_workspace_file", {
    workspaceRoot: input.workspaceRoot,
    requestedPath: input.requestedPath,
    maxBytes: input.maxBytes,
  });
  if (value !== null && typeof value !== "string") throw new Error("Workspace file result is invalid");
  return value as string | null;
}

export async function inspectNativeWorkspaceGit(input: {
  workspaceRoot: string;
  requestedPath: string;
  invoke: NativeInvoke;
}): Promise<WorkspaceGitIdentity> {
  return parseNativeWorkspaceGitIdentity(await input.invoke("inspect_workspace_git", {
    workspaceRoot: input.workspaceRoot,
    requestedPath: input.requestedPath,
  }));
}

function parseNativeWorkspaceGitIdentity(value: unknown): WorkspaceGitIdentity {
  if (
    !value
    || typeof value !== "object"
    || typeof Reflect.get(value, "workspaceRealpath") !== "string"
    || typeof Reflect.get(value, "targetRealpath") !== "string"
    || typeof Reflect.get(value, "branch") !== "string"
    || typeof Reflect.get(value, "headCommit") !== "string"
    || typeof Reflect.get(value, "clean") !== "boolean"
    || typeof Reflect.get(value, "isWorktree") !== "boolean"
  ) throw new Error("Native Git workspace identity is invalid");
  return {
    workspaceRealpath: String(Reflect.get(value, "workspaceRealpath")),
    targetRealpath: String(Reflect.get(value, "targetRealpath")),
    branch: String(Reflect.get(value, "branch")),
    headCommit: String(Reflect.get(value, "headCommit")),
    clean: Reflect.get(value, "clean") as boolean,
    isWorktree: Reflect.get(value, "isWorktree") as boolean,
  };
}

export async function prepareNativeTaskWorktree(input: {
  workspaceRoot: string;
  taskBranch: string;
  baseBranch: string;
  invoke: NativeInvoke;
}): Promise<WorkspaceGitIdentity> {
  return parseNativeWorkspaceGitIdentity(await input.invoke("prepare_task_worktree", {
    workspaceRoot: input.workspaceRoot,
    taskBranch: input.taskBranch,
    baseBranch: input.baseBranch,
  }));
}

export async function runNativeStageCheck(input: {
  workspaceRealpath: string;
  command: string;
  invoke: NativeInvoke;
}): Promise<{ passed: boolean; summary: string }> {
  const value = await input.invoke("run_workspace_check", {
    workspaceRoot: input.workspaceRealpath,
    command: input.command,
    timeoutMs: 600_000,
  });
  if (
    !value
    || typeof value !== "object"
    || typeof Reflect.get(value, "passed") !== "boolean"
    || typeof Reflect.get(value, "summary") !== "string"
  ) throw new Error("Native Stage check result is invalid");
  return { passed: Reflect.get(value, "passed") as boolean, summary: String(Reflect.get(value, "summary")) };
}

export type NativeLoopWorkerCredentials = Omit<LoopAssignmentApiCredentials, "workerId" | "agentVersion">;

function assignmentInputRecord(assignment: LoopAssignment): Record<string, unknown> {
  const value = assignment.inputSnapshot;
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function releaseWorktreePathForAssignment(assignment: LoopAssignment): string | null {
  const input = assignmentInputRecord(assignment);
  const branchKey = assignment.node.key === "release_production" ? "production" : "staging";
  const paths = input.releaseWorktreePaths;
  if (paths && typeof paths === "object" && !Array.isArray(paths)) {
    const value = Reflect.get(paths, branchKey);
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  const legacy = input.releaseWorktreePath;
  return typeof legacy === "string" && legacy.trim().length > 0 ? legacy : null;
}

export function taskBaseBranchForAssignment(assignment: LoopAssignment): string | null {
  if (assignment.node.key !== "prepare_task_branch" && assignment.node.key !== "create_worktree") return null;
  const value = assignmentInputRecord(assignment).productionBranch;
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : "main";
}

function loopSyncSummary(value: unknown): string | null {
  if (!value || typeof value !== "object" || Reflect.get(value, "synchronized") !== true) return null;
  const count = (key: string) => {
    const candidate = Reflect.get(value, key);
    return typeof candidate === "number" && Number.isSafeInteger(candidate) && candidate >= 0 ? candidate : 0;
  };
  const guide = Reflect.get(value, "configurationGuide");
  const warnings = Reflect.get(value, "warnings");
  const blockingIssues = Reflect.get(value, "blockingIssues");
  return [
    `Loop sync completed: created=${count("createdFiles")} adopted=${count("adoptedFiles")} migrated=${count("migratedStages")}`,
    `guide=${typeof guide === "string" ? guide : "unavailable"}`,
    `warnings=${Array.isArray(warnings) ? warnings.length : 0}`,
    `blocking=${Array.isArray(blockingIssues) ? blockingIssues.length : 0}`,
  ].join(" ");
}

type NativeLoopWorkerDependencies = {
  createOutbox(deviceId: string): Promise<LoopOutbox>;
  createApi(credentials: LoopAssignmentApiCredentials): ReturnType<typeof createLoopAssignmentApi>;
  createProvider(options?: {
    transport?: "app-server" | "cli";
    onOutput?: (output: NativeCodexOutput) => void;
    command?: string;
    environmentRefs?: string[];
    environmentOverrides?: Record<string, string>;
    credentialContext?: StructuredProviderExecutionInput["credentialContext"];
    tuiBinding?: {
      taskId: string | null;
      projectId: string | null;
      nodeKey: string;
      liveSession?: {
        sessionId: string;
        relayUrl: string;
        authorization: string;
      };
    };
  }): AgentProviderAdapter;
  startTuiSession?: (input: {
    runId: string;
    processKey: string;
    threadId: string;
    cwd: string;
    model: string | null;
    taskId: string | null;
    projectId: string | null;
    nodeKey: string | null;
  }) => Promise<void>;
  endTuiSession?: (runId: string) => Promise<void>;
  createExecutionStore: typeof createNativeExecutionConfigStore;
  resolveWorkspace?: LoopRunnerDependencies["resolveWorkspace"];
  resolveProvider?: NonNullable<LoopRunnerDependencies["resolveProvider"]>;
  loadProjectConstraints: NonNullable<LoopRunnerDependencies["loadProjectConstraints"]>;
  loadLocalStageContract: NonNullable<LoopRunnerDependencies["loadLocalStageContract"]>;
  syncProjectLoops: typeof syncProjectLoops;
  writeResultSchema: LoopRunnerDependencies["writeResultSchema"];
  readStageArtifact: NonNullable<LoopRunnerDependencies["readStageArtifact"]>;
  runStageCheck: NonNullable<LoopRunnerDependencies["runStageCheck"]>;
  flush?: (outbox: LoopOutbox, api: ReturnType<typeof createLoopAssignmentApi>) => Promise<void>;
  runAssignment?: (
    assignment: LoopAssignment,
    leaseDurationMs?: number,
    onOutput?: (output: NativeCodexOutput) => void,
  ) => Promise<void>;
};

export async function resolveNativeConfiguredProvider(input: {
  assignment: LoopAssignment;
  executionStore: Pick<LocalExecutionConfigStore, "getRuntime">;
  createProvider: NativeLoopWorkerDependencies["createProvider"];
  onOutput?: (output: NativeCodexOutput) => void;
  credentialAccount?: {
    deploymentOrigin: string;
    userId: string;
  };
  localModelOptions?: LocalModelExecutionOptions;
}): Promise<AgentProviderAdapter> {
  const localRuntime = await input.executionStore.getRuntime(input.assignment.runtime.provider);
  const credentialContext = input.assignment.runtime.provider === "codex"
    && localRuntime?.credentialRef
    && input.credentialAccount
    ? {
      ...input.credentialAccount,
      credentialRef: localRuntime.credentialRef,
    }
    : undefined;
  const configuredProvider = input.createProvider({
    ...(input.onOutput ? { onOutput: input.onOutput } : {}),
    command: localRuntime?.command ?? "codex",
    environmentRefs: localRuntime?.environmentRefs ?? [],
    ...(input.localModelOptions?.environmentOverrides
      ? { environmentOverrides: input.localModelOptions.environmentOverrides }
      : {}),
    ...(credentialContext ? { credentialContext } : {}),
  });
  return resolveProviderAdapter(
    input.assignment.runtime,
    localRuntime,
    { [input.assignment.runtime.provider]: configuredProvider },
  );
}

function defaultNativeInvoke<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const bridge = getNativeBridge();
  if (!bridge) {
    throw new Error("本地系统动作仅在桌面客户端中可用。");
  }
  return bridge.invoke<T>(command, args);
}

function defaultDependencies(hooks: {
  startTuiSession?: NativeLoopWorkerDependencies["startTuiSession"];
  endTuiSession?: NativeLoopWorkerDependencies["endTuiSession"];
} = {}): NativeLoopWorkerDependencies {
  const nativeListen: NativeCodexEventListener = (event, handler) => {
    const bridge = getNativeBridge();
    if (!bridge) {
      throw new Error("本地系统动作仅在桌面客户端中可用。");
    }
    return bridge.listen(event, handler);
  };
  const resolveNativePath = async (workspaceRoot: string, requestedPath: string) => resolveWorkspaceBoundary({
    workspaceRoot,
    requestedPath,
    invoke: defaultNativeInvoke,
  });
  const tuiBridge = createCodexTuiSessionBridge(defaultNativeInvoke);
  const startTuiSession = hooks.startTuiSession ?? tuiBridge.onSessionBinding;
  const endTuiSession = hooks.endTuiSession ?? tuiBridge.onSessionEnd;
  return {
    createOutbox: (deviceId) => createNativeLoopOutboxStore({ deviceId }),
    createApi: (credentials) => createLoopAssignmentApi(credentials),
    startTuiSession,
    endTuiSession,
    createProvider: (options = {}) => {
      if (options.transport === "cli") {
        return createCodexAdapter({
          spawn: createNativeCodexSpawn({
            invoke: defaultNativeInvoke,
            listen: nativeListen,
            ...(options.onOutput ? { onOutput: options.onOutput } : {}),
            ...(options.command ? { executable: options.command } : {}),
            ...(options.environmentRefs ? { environmentRefs: options.environmentRefs } : {}),
            ...(options.credentialContext ? { credentialContext: options.credentialContext } : {}),
          }),
          resolveNativePath,
        });
      }
      const processKey = buildCodexDaemonProcessKey({
        deploymentOrigin: options.credentialContext?.deploymentOrigin ?? null,
        userId: options.credentialContext?.userId ?? null,
        credentialRef: options.credentialContext?.credentialRef ?? null,
        providerBaseUrl: options.environmentOverrides?.OPENAI_BASE_URL ?? null,
        executable: options.command ?? "codex",
        environmentRefs: options.environmentRefs ?? [],
      });
      const client = createCodexAppServerClient({
        invoke: defaultNativeInvoke,
        listen: nativeListen,
        processKey,
      });
      return createCodexAppServerAdapter({
        client,
        resolveNativePath,
    onSessionBinding: (binding) => startTuiSession({
          runId: binding.runId,
          processKey: binding.processKey,
          threadId: binding.threadId,
          cwd: binding.cwd,
          model: binding.model,
          taskId: options.tuiBinding?.taskId ?? null,
          projectId: options.tuiBinding?.projectId ?? null,
          nodeKey: options.tuiBinding?.nodeKey ?? null,
          ...(options.tuiBinding?.liveSession ? { liveSession: options.tuiBinding.liveSession } : {}),
        }),
        onSessionEnd: (binding) => endTuiSession(
          binding.runId,
          options.tuiBinding?.liveSession?.sessionId,
        ),
        ...(options.command ? { executable: options.command } : {}),
        ...(options.environmentRefs ? { environmentRefs: options.environmentRefs } : {}),
        readSchema: (workspaceRoot, requestedPath) => readNativeWorkspaceFile({
          workspaceRoot,
          requestedPath,
          maxBytes: 1_048_576,
          invoke: defaultNativeInvoke,
        }),
      });
    },
    createExecutionStore: (input) => createNativeExecutionConfigStore(input),
    loadProjectConstraints,
    loadLocalStageContract: ({ workspaceRoot, nodeId, assignment }) => readNativeProjectLoopStageContract({
      workspaceRoot,
      nodeId,
      ...(assignment.stageRef ? { stageRef: assignment.stageRef } : {}),
      assignmentGraph: assignment.graph,
    }),
    syncProjectLoops,
    writeResultSchema: (input) => writeNativeResultSchema({ ...input, invoke: defaultNativeInvoke }),
    readStageArtifact: (input) => readNativeStageArtifact({ ...input, invoke: defaultNativeInvoke }),
    runStageCheck: (input) => runNativeStageCheck({ ...input, invoke: defaultNativeInvoke }),
  };
}

export async function loadOrInitializeNativeStageContract(input: {
  workspaceRoot: string;
  nodeId: string;
  assignment: LoopAssignment;
  credentials: NativeLoopWorkerCredentials;
  executionStore: {
    getWorkspaceByBindingId(bindingId: string): Promise<{ projectId: string } | null>;
  };
}, dependencies: {
  readContract(input: { workspaceRoot: string; nodeId: string }): ReturnType<NonNullable<LoopRunnerDependencies["loadLocalStageContract"]>>;
  syncLoops(input: {
    workspaceRoot: string;
    projectId: string;
    credentials: NativeLoopWorkerCredentials;
  }): Promise<unknown>;
}) {
  try {
    return await dependencies.readContract({ workspaceRoot: input.workspaceRoot, nodeId: input.nodeId });
  } catch (error) {
    const code = error && typeof error === "object" ? Reflect.get(error, "code") : null;
    if (code !== "project_not_initialized" && code !== "stage_not_found") throw error;
  }
  const workspace = await input.executionStore.getWorkspaceByBindingId(input.assignment.workspace.bindingId);
  if (!workspace?.projectId) throw Object.assign(new Error("Local Workspace project identity is unavailable"), { code: "workspace_configuration_stale" });
  const syncResult = await dependencies.syncLoops({
    workspaceRoot: input.workspaceRoot,
    projectId: workspace.projectId,
    credentials: input.credentials,
  });
  const summary = loopSyncSummary(syncResult);
  if (summary) appendLoopExecutionLog({
    loopRunId: input.assignment.loopRunId,
    nodeKey: input.assignment.node.key,
    stream: "system",
    text: summary,
    occurredAt: new Date().toISOString(),
  });
  return dependencies.readContract({ workspaceRoot: input.workspaceRoot, nodeId: input.nodeId });
}

export async function createNativeLoopWorker(
  credentials: NativeLoopWorkerCredentials,
  overrides: Partial<NativeLoopWorkerDependencies> = {},
  options: { maxConcurrency?: number; codexTransport?: "app-server" | "cli" } = {},
) {
  // Every new Local Agent run uses the real Codex TUI over the app-server.
  // The CLI transport is retired; only a legacy checkpoint may still name it,
  // and that path resumes read-only instead of launching a new CLI turn.
  if (options.codexTransport === "cli") {
    throw Object.assign(new Error("Codex CLI transport is retired for new Local Agent runs"), {
      code: "provider_transport_retired",
    });
  }
  const dependencies = {
    ...defaultDependencies({
      ...(overrides.startTuiSession ? { startTuiSession: overrides.startTuiSession } : {}),
      ...(overrides.endTuiSession ? { endTuiSession: overrides.endTuiSession } : {}),
    }),
    ...overrides,
  };
  const outbox = await dependencies.createOutbox(credentials.deviceId);
  const api = dependencies.createApi({
    ...credentials,
    workerId: buildLocalAgentWorkerId(credentials.deviceId),
    agentVersion: AGENT_BUILD_VERSION,
  });
  const activeControllers = new Set<AbortController>();
  const activeDirectSessions = new Map<string, DirectAgentLiveSessionRuntime>();
  const capabilitySnapshot = localAgentCapabilitySnapshot(options.maxConcurrency ?? 1);
  const recordOutboxFailure = ({ record, error }: { record: LoopOutboxRecord; error: unknown }) => {
    if (!record.payload || typeof record.payload !== "object" || Array.isArray(record.payload)) return;
    const loopRunId = Reflect.get(record.payload, "loopRunId");
    if (typeof loopRunId !== "string" || !loopRunId) return;
    const code = error && typeof error === "object"
      ? String(Reflect.get(error, "code") ?? "request_failed")
      : "request_failed";
    const status = error && typeof error === "object" ? Reflect.get(error, "status") : undefined;
    appendLoopExecutionLog({
      loopRunId,
      nodeKey: "worker-sync",
      stream: "system",
      text: `Outbox sync degraded: ${code}${typeof status === "number" ? ` (HTTP ${status})` : ""}`,
      occurredAt: new Date().toISOString(),
    });
  };
  const flush = async () => {
    if (overrides.flush) {
      await overrides.flush(outbox, api);
      return true;
    }
    return (await flushAssignmentOutbox(outbox, api, {
      onRetryableFailure: recordOutboxFailure,
    })).online;
  };
  let executeAssignment = overrides.runAssignment;
  if (!executeAssignment) {
    const executionStore = await dependencies.createExecutionStore({ deviceId: credentials.deviceId });
    const resolveWorkspace = dependencies.resolveWorkspace ?? ((assignment) => resolveAssignmentWorkspaceWithEvidence(
      assignment.workspace,
      executionStore,
      {
        resolve: (workspaceRoot, requestedPath) => resolveWorkspaceBoundary({
          workspaceRoot,
          requestedPath,
          invoke: defaultNativeInvoke,
        }),
        readFile: (workspaceRoot, requestedPath, maxBytes = 16 * 1024) => readNativeWorkspaceFile({
            workspaceRoot,
            requestedPath,
            maxBytes,
            invoke: defaultNativeInvoke,
          }),
        writeFile: async (workspaceRoot, requestedPath, content) => {
          const value = await defaultNativeInvoke("write_workspace_file", {
            workspaceRoot,
            requestedPath,
            content,
          });
          if (typeof value !== "string") throw new Error("Workspace artifact write result is invalid");
          return value;
        },
        inspectGit: (workspaceRoot, requestedPath) => inspectNativeWorkspaceGit({
          workspaceRoot,
          requestedPath,
          invoke: defaultNativeInvoke,
        }),
        prepareTaskWorktree: (workspaceRoot, taskBranch, baseBranch) => prepareNativeTaskWorktree({
          workspaceRoot,
          taskBranch,
          baseBranch,
          invoke: defaultNativeInvoke,
        }),
      },
      {
        taskId: (assignmentInputRecord(assignment).taskId as string | null | undefined) ?? null,
        projectId: (assignmentInputRecord(assignment).projectId as string | null | undefined) ?? null,
        taskBranch: (assignmentInputRecord(assignment).taskBranch as string | null | undefined) ?? null,
        taskBaseBranch: taskBaseBranchForAssignment(assignment),
        nodeKey: assignment.node.key,
        releaseBranch: (assignmentInputRecord(assignment)[assignment.node.key === "release_production" ? "productionBranch" : "stagingBranch"] as string | null | undefined) ?? null,
        releaseWorktreePath: releaseWorktreePathForAssignment(assignment),
      },
    ));
    executeAssignment = async (assignment, leaseDurationMs, onOutput) => {
      const controller = new AbortController();
      activeControllers.add(controller);
      try {
        const createProviderForRun = (providerOptions: Parameters<NativeLoopWorkerDependencies["createProvider"]>[0] = {}) => dependencies.createProvider({
          ...providerOptions,
          ...(options.codexTransport ? { transport: options.codexTransport } : {}),
          tuiBinding: {
            taskId: (assignmentInputRecord(assignment).taskId as string | null | undefined) ?? null,
            projectId: (assignmentInputRecord(assignment).projectId as string | null | undefined) ?? null,
            nodeKey: assignment.node.key,
            ...(assignment.liveSession ? { liveSession: assignment.liveSession } : {}),
          },
        });
        const provider = createProviderForRun(onOutput ? { onOutput } : {});
        const resolveProvider = dependencies.resolveProvider ?? ((currentAssignment, currentLocalModelOptions) => (
          resolveNativeConfiguredProvider({
            assignment: currentAssignment,
            executionStore,
            createProvider: createProviderForRun,
            ...(currentLocalModelOptions ? { localModelOptions: currentLocalModelOptions } : {}),
            credentialAccount: {
              deploymentOrigin: credentials.apiBaseUrl,
              userId: credentials.userId,
            },
            ...(onOutput ? { onOutput } : {}),
          })
        ));
        const localModelCommands = createNativeLocalModelCommands({
          deploymentOrigin: credentials.apiBaseUrl,
          userId: credentials.userId,
        }, defaultNativeInvoke);
        const localWorkerId = buildLocalAgentWorkerId(credentials.deviceId);
        await runLoopAssignment(assignment, {
          api,
          outbox,
          provider,
          workerId: localWorkerId,
          capabilitySnapshot,
          resolveWorkspace,
          resolveProvider,
          resolveLocalModel: async (currentAssignment) => {
            const [sites, catalog, routing] = await Promise.all([
              localModelCommands.listSites(),
              localModelCommands.getCatalog(),
              localModelCommands.getRouting(),
            ]);
            return resolveLocalModelExecution({
              loopDefinitionId: currentAssignment.stageRef?.loopDefinitionId ?? currentAssignment.loopRunId,
              nodeId: currentAssignment.node.nodeId ?? currentAssignment.node.key,
              provider: currentAssignment.runtime.provider,
              deploymentOrigin: credentials.apiBaseUrl,
              userId: credentials.userId,
              ...(currentAssignment.node.type === "agent_action" && currentAssignment.node.reasoningEffort
                ? { platformReasoningEffort: currentAssignment.node.reasoningEffort }
                : {}),
              sites,
              catalog,
              routing,
            });
          },
          resolveChecklistMcp: async (currentAssignment) => {
            const apiBaseUrl = credentials.apiBaseUrl.trim().replace(/\/+$/u, "");
            if (!apiBaseUrl || !credentials.userId.trim() || !credentials.deviceId.trim() || !credentials.deviceToken.trim()) {
              throw Object.assign(new Error("Local Agent checklist MCP credentials are unavailable"), { code: "configuration_required" });
            }
            return {
              url: `${apiBaseUrl}/api/agent/loop-assignments/${encodeURIComponent(currentAssignment.agentRunId)}/checklist-mcp`,
              headers: {
                ...(credentials.apiToken.trim() ? { authorization: `Bearer ${credentials.apiToken.trim()}` } : {}),
                "x-agent-device-token": credentials.deviceToken.trim(),
                "x-humanthread-loop-user": credentials.userId.trim(),
                "x-humanthread-loop-device": credentials.deviceId.trim(),
                "x-humanthread-loop-worker": localWorkerId,
                "x-humanthread-loop-lease": String(currentAssignment.leaseGeneration),
              },
            };
          },
          readCurrentSequence: async (currentAssignment) => {
            const result = await api.currentSequence?.({
              agentRunId: currentAssignment.agentRunId,
              leaseGeneration: currentAssignment.leaseGeneration,
            });
            if (!result) throw Object.assign(new Error("Local Agent sequence endpoint is unavailable"), { code: "provider_protocol_error" });
            return result.acceptedThroughSequence;
          },
          loadProjectConstraints: dependencies.loadProjectConstraints,
          loadLocalStageContract: (input) => loadOrInitializeNativeStageContract({
            ...input,
            credentials,
            executionStore,
          }, {
            readContract: ({ workspaceRoot, nodeId }) => dependencies.loadLocalStageContract({ workspaceRoot, nodeId, assignment: input.assignment }),
            syncLoops: (syncInput) => dependencies.syncProjectLoops(syncInput),
          }),
          writeResultSchema: dependencies.writeResultSchema,
          readStageArtifact: dependencies.readStageArtifact,
          runStageCheck: dependencies.runStageCheck,
          ...(leaseDurationMs === undefined ? {} : { initialLeaseDurationMs: leaseDurationMs }),
          signal: controller.signal,
        });
      } finally {
        activeControllers.delete(controller);
      }
    };
  }
  const runAssignment = async (assignment: LoopAssignment, leaseDurationMs?: number) => {
    const logContext = {
      loopRunId: assignment.loopRunId,
      nodeKey: assignment.node.key,
    };
    const onProviderOutput = (output: NativeCodexOutput) => {
      appendLoopExecutionLog({
        ...logContext,
        stream: output.stream,
        text: output.chunk,
        occurredAt: new Date().toISOString(),
      });
    };
    appendLoopExecutionLog({
      ...logContext,
      stream: "system",
      text: `Local execution started for ${assignment.node.label}`,
      occurredAt: new Date().toISOString(),
    });
    try {
      await executeAssignment(assignment, leaseDurationMs, onProviderOutput);
      appendLoopExecutionLog({
        ...logContext,
        stream: "system",
        text: `Local execution finished for ${assignment.node.label}`,
        occurredAt: new Date().toISOString(),
      });
    } catch (error) {
      appendLoopExecutionLog({
        ...logContext,
        stream: "system",
        text: error instanceof Error ? `Local execution failed: ${error.message}` : "Local execution failed",
        occurredAt: new Date().toISOString(),
      });
      throw error;
    }
  };

  return startLoopWorker({
    api,
    flush,
    pendingAgentRunIds: async () => outbox.pendingAssignmentIds?.()
      ?? [...new Set((await outbox.list(100)).map(({ assignmentId }) => assignmentId))],
    runAssignment,
    openLiveSession: async (session) => {
      const runtime = await openDirectAgentLiveSession({
        session,
        credentials,
        executionStore: await dependencies.createExecutionStore({ deviceId: credentials.deviceId }),
        resolveWorkspace: async ({ deviceId, sessionId }) => directAgentWorkspacePath({
          deviceId,
          sessionId,
          invoke: defaultNativeInvoke,
        }),
      });
      activeDirectSessions.set(session.sessionId, runtime);
      return {
        close: async () => {
          activeDirectSessions.delete(session.sessionId);
          await runtime.close();
        },
      };
    },
    canClaim: async () => (await outbox.capacity()).canClaim,
    capabilitySnapshot,
    onActiveCountChange: publishLocalWorkerActivity,
    cancelActive: async () => {
      for (const controller of activeControllers) controller.abort();
      await Promise.all([...activeDirectSessions.values()].map((session) => session.close()));
      activeDirectSessions.clear();
    },
  });
}

async function directAgentWorkspacePath(input: {
  deviceId: string;
  sessionId: string;
  invoke: NativeInvoke;
}): Promise<string> {
  const root = await input.invoke("prepare_direct_agent_workspace", {
    deviceId: input.deviceId,
    sessionId: input.sessionId,
  });
  if (typeof root !== "string" || !root.startsWith("/")) {
    throw Object.assign(new Error("Direct Agent Workspace is invalid"), {
      code: "workspace_unavailable",
    });
  }
  return root;
}

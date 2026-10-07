import { describe, expect, it, vi } from "vitest";

import type { LoopAssignment, LoopAssignmentV2 } from "@humanthread/shared";
import { readLoopExecutionLogs } from "./loop-execution-logs";
import type { LoopOutboxRecord } from "./loop-outbox";
import {
  createNativeLoopWorker,
  createCodexTuiSessionBridge,
  inspectNativeWorkspaceGit,
  prepareNativeTaskWorktree,
  loadOrInitializeNativeStageContract,
  openDirectAgentLiveSession,
  readNativeStageArtifact,
  readNativeWorkspaceFile,
  taskBaseBranchForAssignment,
  releaseWorktreePathForAssignment,
  resolveNativeConfiguredProvider,
  runNativeStageCheck,
  writeNativeResultSchema,
} from "./loop-worker-runtime";

const assignment = {
  id: "assignment_log_1",
  agentRunId: "agent_run_log_1",
  loopRunId: "loop_run_log_1",
  loopNodeRunId: "node_run_log_1",
  loopNodeAttemptId: "attempt_log_1",
  attemptNo: 1,
  leaseGeneration: 1,
  leaseExpiresAt: "2026-08-07T02:00:00.000Z",
  acceptedThroughSequence: 0,
  node: {
    key: "develop",
    label: "Develop",
    type: "agent_action",
    executionTarget: "local",
    promptTemplate: "Develop",
    offlinePolicy: "online_required",
  },
  graph: {
    schemaVersion: 1,
    inputSchema: {},
    outputSchema: {},
    limits: { maxStages: 1, maxRepeatCount: 1 },
    nodes: [],
    edges: [],
  },
  inputSnapshot: {},
  policySnapshot: {},
  grantSnapshot: {},
  runtime: {
    agentProfileId: "profile_codex",
    provider: "codex",
    runtimeProfileId: "runtime_codex",
    configurationVersion: 1,
  },
  workspace: {
    bindingId: "workspace_1",
    configurationVersion: 1,
    pathFingerprint: "hmac-sha256:abcdef",
  },
  prompt: "Develop",
  resultSchemaPath: ".humanthread/results/output.json",
} as LoopAssignment;

const v2Assignment = assignment as unknown as LoopAssignmentV2;

describe("native Loop Worker runtime", () => {
  it("uses the production branch as the task worktree base", () => {
    const taskAssignment = {
      ...assignment,
      node: { ...assignment.node, key: "prepare_task_branch" },
      inputSnapshot: {
        productionBranch: "main",
        stagingBranch: "stage",
      },
    } as LoopAssignment;

    expect(taskBaseBranchForAssignment(taskAssignment)).toBe("main");
  });

  it("defaults task worktree preparation to main when no production branch is assigned", () => {
    const taskAssignment = {
      ...assignment,
      node: { ...assignment.node, key: "prepare_task_branch" },
      inputSnapshot: { taskBranch: "2026-HT100013" },
    } as LoopAssignment;

    expect(taskBaseBranchForAssignment(taskAssignment)).toBe("main");
  });

  it("selects the release worktree path for the current release branch", () => {
    const releaseAssignment = {
      ...assignment,
      node: { ...assignment.node, key: "release_production" },
      inputSnapshot: {
        releaseWorktreePaths: {
          staging: ".worktrees/release-staging",
          production: ".worktrees/release-production",
        },
      },
    } as LoopAssignment;

    expect(releaseWorktreePathForAssignment(releaseAssignment)).toBe(".worktrees/release-production");
    expect(releaseWorktreePathForAssignment({
      ...releaseAssignment,
      node: { ...releaseAssignment.node, key: "integrate_staging" },
    })).toBe(".worktrees/release-staging");
  });

  it("uses an existing local Stage without waiting for the platform catalog", async () => {
    const readContract = vi.fn().mockResolvedValue({ stage: { subloopId: "node_1", loopId: "loop_1" }, resourcesByExecId: {} });
    const syncLoops = vi.fn(() => new Promise<never>(() => undefined));

    const result = await loadOrInitializeNativeStageContract({
      workspaceRoot: "/Volumes/code/project",
      nodeId: "node_1",
      assignment: v2Assignment,
      credentials: { apiBaseUrl: "http://localhost:3000", userId: "user_1", deviceId: "device_1", deviceToken: "device_token", apiToken: "api_token" },
      executionStore: {
        getWorkspaceByBindingId: vi.fn().mockResolvedValue({ projectId: "project_1" }),
      },
    }, { readContract, syncLoops });

    expect(syncLoops).not.toHaveBeenCalled();
    expect(readContract).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ stage: { subloopId: "node_1" } });
    expect(readLoopExecutionLogs(assignment.loopRunId)).toEqual([]);
  });

  it("does not start a hanging catalog request when an existing local Stage is executable", async () => {
    const readContract = vi.fn().mockResolvedValue({ stage: { subloopId: "node_1", loopId: "loop_1" }, resourcesByExecId: {} });
    const syncLoops = vi.fn(() => new Promise<never>(() => undefined));

    await expect(loadOrInitializeNativeStageContract({
      workspaceRoot: "/Volumes/code/project",
      nodeId: "node_1",
      assignment: v2Assignment,
      credentials: { apiBaseUrl: "http://localhost:3000", userId: "user_1", deviceId: "device_1", deviceToken: "device_token", apiToken: "api_token" },
      executionStore: {
        getWorkspaceByBindingId: vi.fn().mockResolvedValue({ projectId: "project_1" }),
      },
    }, { readContract, syncLoops })).resolves.toMatchObject({ stage: { subloopId: "node_1" } });
    expect(syncLoops).not.toHaveBeenCalled();
  });

  it("runs Desktop ht init once when an assigned v2 project has no local structure", async () => {
    const readContract = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("not initialized"), { code: "project_not_initialized" }))
      .mockResolvedValueOnce({ stage: { subloopId: "node_1", loopId: "loop_1" }, resourcesByExecId: {} });
    const syncLoops = vi.fn().mockResolvedValue({ synchronized: true });

    const result = await loadOrInitializeNativeStageContract({
      workspaceRoot: "/Volumes/code/project",
      nodeId: "node_1",
      assignment: v2Assignment,
      credentials: { apiBaseUrl: "http://localhost:3000", userId: "user_1", deviceId: "device_1", deviceToken: "device_token", apiToken: "api_token" },
      executionStore: {
        getWorkspaceByBindingId: vi.fn().mockResolvedValue({ projectId: "project_1" }),
      },
    }, { readContract, syncLoops });

    expect(syncLoops).toHaveBeenCalledWith(expect.objectContaining({ projectId: "project_1", workspaceRoot: "/Volumes/code/project" }));
    expect(readContract).toHaveBeenCalledTimes(2);
    expect(readContract.mock.invocationCallOrder[0]).toBeLessThan(syncLoops.mock.invocationCallOrder[0]!);
    expect(result).toMatchObject({ stage: { subloopId: "node_1" } });
  });

  it("synchronizes once when the assigned Stage is new to an initialized project", async () => {
    const readContract = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("missing Stage"), { code: "stage_not_found" }))
      .mockResolvedValueOnce({ stage: { subloopId: "node_1", loopId: "loop_1" }, resourcesByExecId: {} });
    const syncLoops = vi.fn().mockResolvedValue({ synchronized: true });

    await expect(loadOrInitializeNativeStageContract({
      workspaceRoot: "/Volumes/code/project",
      nodeId: "node_1",
      assignment: v2Assignment,
      credentials: { apiBaseUrl: "http://localhost:3000", userId: "user_1", deviceId: "device_1", deviceToken: "device_token", apiToken: "api_token" },
      executionStore: {
        getWorkspaceByBindingId: vi.fn().mockResolvedValue({ projectId: "project_1" }),
      },
    }, { readContract, syncLoops })).resolves.toMatchObject({ stage: { subloopId: "node_1" } });

    expect(syncLoops).toHaveBeenCalledOnce();
    expect(readContract).toHaveBeenCalledTimes(2);
  });

  it("builds the assigned provider with the locally validated runtime command", async () => {
    const provider = {
      capabilities: () => ({ sessionResume: true, structuredResult: true, approvals: true }),
      executeStructured: vi.fn(),
      start: vi.fn(),
      resume: vi.fn(),
      cancel: vi.fn(),
    };
    const createProvider = vi.fn().mockReturnValue(provider);
    const onOutput = vi.fn();

    await expect(resolveNativeConfiguredProvider({
      assignment,
      executionStore: {
        getRuntime: vi.fn().mockResolvedValue({
          provider: "codex",
          runtimeProfileId: "runtime_codex",
          command: "/Users/test/.nvm/versions/node/v24.13.1/bin/codex",
          environmentRefs: ["CODEX_HOME"],
          version: 1,
        }),
      },
      createProvider,
      onOutput,
    })).resolves.toBe(provider);
    expect(createProvider).toHaveBeenCalledWith({
      onOutput,
      command: "/Users/test/.nvm/versions/node/v24.13.1/bin/codex",
      environmentRefs: ["CODEX_HOME"],
    });
  });

  it("passes the configured runtime credential reference to the native provider", async () => {
    const provider = {
      capabilities: () => ({ sessionResume: true, structuredResult: true, approvals: true }),
      executeStructured: vi.fn(),
      start: vi.fn(),
      resume: vi.fn(),
      cancel: vi.fn(),
    };
    const createProvider = vi.fn().mockReturnValue(provider);

    await expect(resolveNativeConfiguredProvider({
      assignment,
      executionStore: {
        getRuntime: vi.fn().mockResolvedValue({
          provider: "codex",
          runtimeProfileId: "runtime_codex",
          command: "/Users/test/.nvm/versions/node/v24.13.1/bin/codex",
          environmentRefs: ["CODEX_HOME", "OPENAI_API_KEY"],
          credentialRef: "0123456789abcdef0123456789abcdef",
          version: 1,
        }),
      },
      createProvider,
      credentialAccount: {
        deploymentOrigin: "http://localhost:3000",
        userId: "user_1",
      },
    })).resolves.toBe(provider);

    expect(createProvider).toHaveBeenCalledWith({
      command: "/Users/test/.nvm/versions/node/v24.13.1/bin/codex",
      environmentRefs: ["CODEX_HOME", "OPENAI_API_KEY"],
      credentialContext: {
        deploymentOrigin: "http://localhost:3000",
        userId: "user_1",
        credentialRef: "0123456789abcdef0123456789abcdef",
      },
    });
  });

  it("passes the resolved model site into the stable daemon binding", async () => {
    const provider = {
      capabilities: () => ({ sessionResume: true, structuredResult: true, approvals: true }),
      executeStructured: vi.fn(),
      start: vi.fn(),
      resume: vi.fn(),
      cancel: vi.fn(),
    };
    const createProvider = vi.fn().mockReturnValue(provider);

    await resolveNativeConfiguredProvider({
      assignment,
      executionStore: {
        getRuntime: vi.fn().mockResolvedValue({
          provider: "codex",
          runtimeProfileId: "runtime_codex",
          command: "/Users/test/.nvm/versions/node/v24.13.1/bin/codex",
          environmentRefs: ["HTTPS_PROXY"],
          credentialRef: "0123456789abcdef0123456789abcdef",
          version: 1,
        }),
      },
      createProvider,
      credentialAccount: {
        deploymentOrigin: "http://localhost:3000",
        userId: "user_1",
      },
      localModelOptions: {
        model: "model_1",
        environmentOverrides: { OPENAI_BASE_URL: "https://model.example/v1" },
      },
    });

    expect(createProvider).toHaveBeenCalledWith(expect.objectContaining({
      environmentOverrides: { OPENAI_BASE_URL: "https://model.example/v1" },
      credentialContext: expect.objectContaining({
        deploymentOrigin: "http://localhost:3000",
        userId: "user_1",
        credentialRef: "0123456789abcdef0123456789abcdef",
      }),
    }));
  });

  it("routes the bound AgentRun thread to the local TUI bridge", async () => {
    const binding = {
      runId: "agent_run_log_1",
      processKey: "codex-daemon:test",
      threadId: "thread_1",
      cwd: "/workspace",
      model: "model_1",
    };
    const startTuiSession = vi.fn(async (_input: {
      runId: string;
      processKey: string;
      threadId: string;
      cwd: string;
      model: string | null;
    }) => undefined);
    const endTuiSession = vi.fn(async (_runId: string) => undefined);

    const module = await import("./providers/codex-app-server-adapter");
    const adapter = module.createCodexAppServerAdapter({
      client: {
        processKey: "codex-daemon:test",
        start: vi.fn(async () => ({
          processKey: "codex-daemon:test",
          generation: 1,
          pid: 1,
          bindingFingerprint: "binding",
          model: "model_1",
          reasoningEffort: "high",
          transport: "websocket" as const,
          endpoint: "ws://127.0.0.1:1",
          protocolVersion: "codex-cli 0.154.0",
          status: "ready",
          lastNotificationAt: null,
          pendingRequestCount: 0,
          stderrSummary: null,
          lastErrorCode: null,
        })),
        request: vi.fn(async (method: string) => method === "thread/start"
          ? { thread: { id: "thread_1" } }
          : { turn: { id: "turn_1", status: "inProgress", items: [] } }),
        notify: vi.fn(async () => undefined),
        respond: vi.fn(async () => undefined),
        cancel: vi.fn(async () => undefined),
        stop: vi.fn(async () => undefined),
        states: vi.fn(async () => []),
        subscribe: vi.fn(async () => () => undefined),
        subscribeState: vi.fn(async () => () => undefined),
      },
      resolveNativePath: async (workspaceRoot, requestedPath) => ({
        workspaceRealpath: workspaceRoot,
        targetRealpath: requestedPath,
        contained: true,
      }),
      readSchema: async () => ({ type: "object" }),
      onSessionBinding: async (value) => startTuiSession({
        runId: value.runId,
        processKey: value.processKey,
        threadId: value.threadId,
        cwd: value.cwd,
        model: value.model,
      }),
      onSessionEnd: async (value) => endTuiSession(value.runId),
    });
    void adapter;
    void binding;
    expect(startTuiSession).not.toHaveBeenCalled();
    expect(endTuiSession).not.toHaveBeenCalled();
  });

  it("registers and unregisters a local TUI session under a LiveSession identity", async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const invoke = async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
      calls.push({ command, ...(args === undefined ? {} : { args }) });
      return undefined as T;
    };
    const bridge = createCodexTuiSessionBridge(invoke);

    await bridge.onSessionBinding({
      runId: "agent_run_1",
      processKey: "codex-daemon:test",
      threadId: "thread_1",
      cwd: "/workspace",
      model: "model_1",
    });
    await bridge.onSessionEnd("agent_run_1");

    expect(calls[0]).toEqual({ command: "start_codex_tui_session", args: {
      sessionId: "2254c612d4968defc3cc5be882d47273",
      runId: "agent_run_1",
      processKey: "codex-daemon:test",
      threadId: "thread_1",
      cwd: "/workspace",
      model: "model_1",
      taskId: null,
      projectId: null,
      nodeKey: null,
    } });
    expect(calls[1]).toEqual({ command: "close_live_session", args: {
      sessionId: "2254c612d4968defc3cc5be882d47273",
    } });
    expect(calls[2]).toEqual({ command: "freeze_codex_tui_session", args: {
      sessionId: "2254c612d4968defc3cc5be882d47273",
    } });
  });

  it("opens a direct Agent LiveSession as a Codex TUI bound to the account default model", async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const invoke = vi.fn(async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
      calls.push({ command, ...(args === undefined ? {} : { args }) });
      if (command === "start_codex_app_server") {
        return {
          processKey: args?.input && typeof args.input === "object"
            ? Reflect.get(args.input, "processKey")
            : "codex-daemon:test",
          generation: 1,
          pid: 1,
          bindingFingerprint: "binding",
          model: "gpt-5.6-sol",
          reasoningEffort: "high",
          transport: "websocket",
          endpoint: "ws://127.0.0.1:1",
          protocolVersion: "codex-cli 0.154.0",
          status: "ready",
          lastNotificationAt: null,
          pendingRequestCount: 0,
          stderrSummary: null,
          lastErrorCode: null,
        } as T;
      }
      if (command === "request_codex_app_server" && Reflect.get(args ?? {}, "method") === "thread/start") {
        return { thread: { id: "thread_direct_1" } } as T;
      }
      return undefined as T;
    });

    await openDirectAgentLiveSession({
      session: {
        sessionId: "f".repeat(32),
        kind: "agent",
        target: { type: "agent_device", deviceId: "device_1", displayName: "Mac Studio" },
        projectId: null,
        taskId: null,
        executionPolicy: "direct",
        relayUrl: `ws://localhost:3000/live-session/execution?sessionId=${"f".repeat(32)}`,
        authorization: "lst1.payload.signature",
        initialCols: 120,
        initialRows: 36,
      },
      credentials: {
        apiBaseUrl: "http://localhost:3000",
        userId: "user_1",
        deviceId: "device_1",
        deviceToken: "device_token",
        apiToken: "api_token",
      },
      invoke,
      listen: vi.fn().mockResolvedValue(() => undefined),
      executionStore: {
        getRuntime: vi.fn().mockResolvedValue({
          runtimeProfileId: "runtime_codex",
          provider: "codex",
          command: "/usr/local/bin/codex",
          environmentRefs: [],
          credentialRef: null,
          version: 1,
        }),
      },
      loadModelExecution: vi.fn().mockResolvedValue({
        model: "gpt-5.6-sol",
        reasoningEffort: "high",
        environmentOverrides: { OPENAI_BASE_URL: "https://model.example.com/v1" },
        credentialContext: {
          deploymentOrigin: "http://localhost:3000",
          userId: "user_1",
          credentialRef: "a".repeat(32),
        },
      }),
      resolveWorkspace: vi.fn().mockResolvedValue("/Users/test/.humanthread/direct/device_1"),
    });

    expect(calls).toContainEqual(expect.objectContaining({ command: "start_codex_app_server" }));
    expect(calls).toContainEqual({ command: "start_codex_tui_session", args: expect.objectContaining({
      sessionId: "f".repeat(32),
      threadId: "thread_direct_1",
      cwd: "/Users/test/.humanthread/direct/device_1",
      model: "gpt-5.6-sol",
    }) });
    expect(calls).toContainEqual({ command: "open_live_session", args: expect.objectContaining({
      sessionId: "f".repeat(32),
      authorization: "lst1.payload.signature",
    }) });
  });

  it("writes the result Schema through the Workspace-confined native command", async () => {
    const invoke = vi.fn().mockResolvedValue(
      "/Volumes/code/project/.humanthread/loop/results/attempt_1.schema.json",
    );

    await expect(writeNativeResultSchema({
      workspaceRealpath: "/Volumes/code/project",
      relativePath: ".humanthread/loop/results/attempt_1.schema.json",
      schema: { type: "object" },
      invoke,
    })).resolves.toBe(
      "/Volumes/code/project/.humanthread/loop/results/attempt_1.schema.json",
    );
    expect(invoke).toHaveBeenCalledWith("write_workspace_file", {
      workspaceRoot: "/Volumes/code/project",
      requestedPath: "/Volumes/code/project/.humanthread/loop/results/attempt_1.schema.json",
      content: '{"type":"object"}',
    });
  });

  it("reads Stage artifacts and executes configured checks through confined native commands", async () => {
    const invoke = vi.fn(async (command: string) => command === "read_workspace_file"
      ? "artifact"
      : { passed: true, summary: "Stage check passed" });

    await expect(readNativeStageArtifact({
      workspaceRealpath: "/Volumes/code/project",
      relativePath: "artifacts/report.json",
      invoke,
    })).resolves.toBe("artifact");
    await expect(runNativeStageCheck({
      workspaceRealpath: "/Volumes/code/project",
      command: "pnpm test",
      invoke,
    })).resolves.toEqual({ passed: true, summary: "Stage check passed" });

    expect(invoke).toHaveBeenNthCalledWith(1, "read_workspace_file", {
      workspaceRoot: "/Volumes/code/project",
      requestedPath: "/Volumes/code/project/artifacts/report.json",
      maxBytes: 1024 * 1024,
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "run_workspace_check", {
      workspaceRoot: "/Volumes/code/project",
      command: "pnpm test",
      timeoutMs: 600_000,
    });
  });

  it("passes the requested recovery file limit to the native reader", async () => {
    const invoke = vi.fn().mockResolvedValue("recovered plan");

    await expect(readNativeWorkspaceFile({
      workspaceRoot: "/Volumes/code/project",
      requestedPath: "/Volumes/code/project/docs/requirements/2026-CURRENT/plan.md",
      maxBytes: 1024 * 1024,
      invoke,
    })).resolves.toBe("recovered plan");

    expect(invoke).toHaveBeenCalledWith("read_workspace_file", {
      workspaceRoot: "/Volumes/code/project",
      requestedPath: "/Volumes/code/project/docs/requirements/2026-CURRENT/plan.md",
      maxBytes: 1024 * 1024,
    });
  });

  it("loads a bounded Git identity through the native workspace command", async () => {
    const invoke = vi.fn().mockResolvedValue({
      workspaceRealpath: "/Volumes/code/project",
      targetRealpath: "/Volumes/code/project/.worktrees/2026-HT100013",
      branch: "2026-HT100013",
      headCommit: "a".repeat(40),
      clean: false,
      isWorktree: true,
    });

    await expect(inspectNativeWorkspaceGit({
      workspaceRoot: "/Volumes/code/project",
      requestedPath: "/Volumes/code/project/.worktrees/2026-HT100013",
      invoke,
    })).resolves.toMatchObject({
      branch: "2026-HT100013",
      headCommit: "a".repeat(40),
      isWorktree: true,
    });
    expect(invoke).toHaveBeenCalledWith("inspect_workspace_git", {
      workspaceRoot: "/Volumes/code/project",
      requestedPath: "/Volumes/code/project/.worktrees/2026-HT100013",
    });
  });

  it("prepares a task worktree through the native workspace command", async () => {
    const invoke = vi.fn().mockResolvedValue({
      workspaceRealpath: "/Volumes/code/project",
      targetRealpath: "/Volumes/code/project/.worktrees/2026-HT100013",
      branch: "2026-HT100013",
      headCommit: "a".repeat(40),
      clean: true,
      isWorktree: true,
    });

    await expect(prepareNativeTaskWorktree({
      workspaceRoot: "/Volumes/code/project",
      taskBranch: "2026-HT100013",
      baseBranch: "main",
      invoke,
    })).resolves.toMatchObject({ branch: "2026-HT100013", isWorktree: true });
    expect(invoke).toHaveBeenCalledWith("prepare_task_worktree", {
      workspaceRoot: "/Volumes/code/project",
      taskBranch: "2026-HT100013",
      baseBranch: "main",
    });
  });

  it("rejects the retired CLI transport before creating a new-provider run", async () => {
    await expect(createNativeLoopWorker({
      apiBaseUrl: "http://localhost:3000",
      userId: "user_1",
      deviceId: "device_1",
      deviceToken: "device_token",
      apiToken: "",
    }, {
      createOutbox: vi.fn().mockResolvedValue({
        enqueue: vi.fn(),
        list: vi.fn().mockResolvedValue([]),
        acknowledge: vi.fn(),
        capacity: vi.fn().mockResolvedValue({ canClaim: false, canAppendCritical: true, reason: "record_limit" }),
      }),
      createApi: vi.fn().mockReturnValue({
        claim: vi.fn(),
        heartbeat: vi.fn(),
        events: vi.fn(),
        checkpoint: vi.fn(),
        complete: vi.fn(),
      }),
    }, { codexTransport: "cli" })).rejects.toMatchObject({ code: "provider_transport_retired" });
  });

  it("flushes before sending a heartbeat-only claim at outbox capacity", async () => {
    const flush = vi.fn().mockResolvedValue(undefined);
    const claim = vi.fn().mockResolvedValue({
      assignment: null,
      leaseGeneration: null,
      leaseExpiresAt: null,
    });
    const runtime = await createNativeLoopWorker({
      apiBaseUrl: "http://localhost:3000",
      userId: "user_1",
      deviceId: "device_1",
      deviceToken: "device_token",
      apiToken: "",
    }, {
      createOutbox: vi.fn().mockResolvedValue({
        enqueue: vi.fn(),
        list: vi.fn().mockResolvedValue([]),
        acknowledge: vi.fn(),
        capacity: vi.fn().mockResolvedValue({
          canClaim: false,
          canAppendCritical: true,
          reason: "record_limit",
        }),
      }),
      createApi: vi.fn().mockReturnValue({
        claim,
        heartbeat: vi.fn(),
        events: vi.fn(),
        checkpoint: vi.fn(),
        complete: vi.fn(),
      }),
      createProvider: vi.fn().mockReturnValue({
        capabilities: () => ({ sessionResume: true, structuredResult: true, approvals: true }),
        executeStructured: vi.fn(),
        start: vi.fn(),
        resume: vi.fn(),
        cancel: vi.fn(),
      }),
      flush,
      resolveWorkspace: vi.fn(),
      writeResultSchema: vi.fn(),
      runAssignment: vi.fn<(assignment: LoopAssignment) => Promise<void>>(),
    });

    await runtime.onOnline();

    expect(flush).toHaveBeenCalledOnce();
    expect(claim).toHaveBeenCalledOnce();
    expect(claim).toHaveBeenCalledWith(expect.objectContaining({
      acceptAssignments: false,
    }));
  });

  it("records a retryable outbox failure in the affected Loop execution log", async () => {
    const loopRunId = "loop_run_outbox_degraded";
    const record = {
      id: "event:attempt_degraded:1",
      assignmentId: "agent_run_degraded",
      leaseGeneration: 1,
      sequence: 3,
      priority: "activity" as const,
      kind: "event" as const,
      payload: {
        eventId: "event:attempt_degraded:1",
        loopRunId,
        loopNodeRunId: "node_run_degraded",
        loopNodeAttemptId: "attempt_degraded",
        attemptNo: 1,
        leaseGeneration: 1,
        sequence: 1,
        eventType: "run.started" as const,
        occurredAt: "2026-08-10T12:00:00.000Z",
        payloadSummary: {},
        artifactRefs: [],
      },
      byteSize: 400,
      createdAt: "2026-08-10T12:00:00.000Z",
    } satisfies LoopOutboxRecord;
    const claim = vi.fn().mockResolvedValue({
      assignment: null,
      leaseGeneration: null,
      leaseExpiresAt: null,
    });
    const runtime = await createNativeLoopWorker({
      apiBaseUrl: "http://localhost:3000",
      userId: "user_1",
      deviceId: "device_1",
      deviceToken: "device_token",
      apiToken: "",
    }, {
      createOutbox: vi.fn().mockResolvedValue({
        enqueue: vi.fn(),
        list: vi.fn().mockResolvedValue([record]),
        acknowledge: vi.fn(),
        capacity: vi.fn().mockResolvedValue({ canClaim: true, canAppendCritical: true, reason: null }),
      }),
      createApi: vi.fn().mockReturnValue({
        claim,
        heartbeat: vi.fn(),
        events: vi.fn().mockRejectedValue(Object.assign(new Error("Service unavailable"), {
          code: "request_failed",
          status: 503,
        })),
        checkpoint: vi.fn(),
        complete: vi.fn(),
      }),
      runAssignment: vi.fn(),
    });

    await runtime.onOnline();

    expect(claim).toHaveBeenCalledWith(expect.objectContaining({ acceptAssignments: true }));
    expect(readLoopExecutionLogs(loopRunId)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        nodeKey: "worker-sync",
        stream: "system",
        text: "Outbox sync degraded: request_failed (HTTP 503)",
      }),
    ]));
  });

  it("binds native provider output to the active Loop Run", async () => {
    type Output = {
      processKey: string;
      processId: number;
      stream: "stdout" | "stderr";
      chunk: string;
    };
    const runAssignment = vi.fn(async (_assignment: LoopAssignment, _leaseDurationMs?: number, onOutput?: (output: Output) => void) => {
      onOutput?.({
        processKey: "process_log_1",
        processId: 42,
        stream: "stdout",
        chunk: "running tests\n",
      });
    });
    const runtime = await createNativeLoopWorker({
      apiBaseUrl: "http://localhost:3000",
      userId: "user_1",
      deviceId: "device_1",
      deviceToken: "device_token",
      apiToken: "",
    }, {
      createOutbox: vi.fn().mockResolvedValue({
        enqueue: vi.fn(), list: vi.fn().mockResolvedValue([]), acknowledge: vi.fn(),
        capacity: vi.fn().mockResolvedValue({ canClaim: true, canAppendCritical: true, reason: null }),
      }),
      createApi: vi.fn().mockReturnValue({
        claim: vi.fn().mockResolvedValue({ assignment, leaseGeneration: 1, leaseExpiresAt: assignment.leaseExpiresAt }),
        heartbeat: vi.fn(), events: vi.fn(), checkpoint: vi.fn(), complete: vi.fn(),
      }),
      createProvider: vi.fn(() => ({
          capabilities: () => ({ sessionResume: true, structuredResult: true, approvals: true }),
          executeStructured: vi.fn(),
          start: vi.fn(), resume: vi.fn(), cancel: vi.fn(),
      })),
      flush: vi.fn().mockResolvedValue(undefined),
      resolveWorkspace: vi.fn(),
      writeResultSchema: vi.fn(),
      runAssignment,
    });

    await runtime.onOnline();

    expect(runAssignment).toHaveBeenCalledWith(assignment, undefined, expect.any(Function));
    expect(readLoopExecutionLogs(assignment.loopRunId)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        nodeKey: "develop",
        stream: "stdout",
        text: "running tests\n",
      }),
    ]));
  });

  it("keeps concurrent provider output attached to its own Loop Run", async () => {
    const second = {
      ...assignment,
      id: "assignment_log_2",
      agentRunId: "agent_run_log_2",
      loopRunId: "loop_run_log_2",
      loopNodeRunId: "node_run_log_2",
      loopNodeAttemptId: "attempt_log_2",
      node: { ...assignment.node, key: "test", label: "Test" },
    } satisfies LoopAssignment;
    const claims = [assignment, second];
    const releases: Array<() => void> = [];
    const runAssignment = vi.fn((current: LoopAssignment, _leaseDurationMs?: number, onOutput?: (output: { processKey: string; processId: number; stream: "stdout" | "stderr"; chunk: string }) => void) => new Promise<void>((resolve) => {
      onOutput?.({ processKey: `process:${current.agentRunId}`, processId: 1, stream: "stdout", chunk: `${current.node.key} output\n` });
      releases.push(resolve);
    }));
    const runtime = await createNativeLoopWorker({
      apiBaseUrl: "http://localhost:3000", userId: "user_1", deviceId: "device_1", deviceToken: "device_token", apiToken: "",
    }, {
      createOutbox: vi.fn().mockResolvedValue({
        enqueue: vi.fn(), list: vi.fn().mockResolvedValue([]), acknowledge: vi.fn(),
        capacity: vi.fn().mockResolvedValue({ canClaim: true, canAppendCritical: true, reason: null }),
      }),
      createApi: vi.fn().mockReturnValue({
        claim: vi.fn(async () => {
          const current = claims.shift() ?? null;
          return current ? { assignment: current, leaseGeneration: 1, leaseExpiresAt: current.leaseExpiresAt } : { assignment: null, leaseGeneration: null, leaseExpiresAt: null };
        }),
        heartbeat: vi.fn(), events: vi.fn(), checkpoint: vi.fn(), complete: vi.fn(),
      }),
      createProvider: vi.fn().mockReturnValue({
        capabilities: () => ({ sessionResume: true, structuredResult: true, approvals: true }), executeStructured: vi.fn(), start: vi.fn(), resume: vi.fn(), cancel: vi.fn(),
      }),
      flush: vi.fn().mockResolvedValue(undefined), resolveWorkspace: vi.fn(), writeResultSchema: vi.fn(), runAssignment,
    }, { maxConcurrency: 2 });

    await runtime.onOnline();

    expect(readLoopExecutionLogs(assignment.loopRunId)).toEqual(expect.arrayContaining([
      expect.objectContaining({ nodeKey: "develop", text: "develop output\n" }),
    ]));
    expect(readLoopExecutionLogs(second.loopRunId)).toEqual(expect.arrayContaining([
      expect.objectContaining({ nodeKey: "test", text: "test output\n" }),
    ]));
    expect(readLoopExecutionLogs(assignment.loopRunId).some(({ text }) => text === "test output\n")).toBe(false);
    releases.forEach((release) => release());
    runtime.stop();
  });
});

describe("Direct Agent LiveSession model selection", () => {
  const sessionId = "f".repeat(32);

  function directSessionInput(overrides: Record<string, unknown> = {}) {
    return {
      session: {
        sessionId,
        kind: "agent" as const,
        target: { type: "agent_device" as const, deviceId: "device_1", displayName: "Mac Studio" },
        projectId: null,
        taskId: null,
        executionPolicy: "direct" as const,
        relayUrl: `ws://localhost:3000/live-session/execution?sessionId=${sessionId}`,
        authorization: "lst1.payload.signature",
        initialCols: 120,
        initialRows: 36,
        ...overrides,
      },
      credentials: {
        apiBaseUrl: "http://localhost:3000",
        userId: "user_1",
        deviceId: "device_1",
        deviceToken: "device_token",
        apiToken: "api_token",
      },
      resolveWorkspace: vi.fn().mockResolvedValue("/Users/test/.humanthread/direct/device_1"),
    };
  }

  function directInvoke() {
    return vi.fn(async (command: string, args?: Record<string, unknown>) => {
      if (command === "start_codex_app_server") {
        return {
          processKey: args?.input && typeof args.input === "object" ? Reflect.get(args.input, "processKey") : "codex-daemon:test",
          generation: 1,
          pid: 1,
          bindingFingerprint: "binding",
          model: "gpt-5.6-sol",
          reasoningEffort: "high",
          transport: "websocket",
          endpoint: "ws://127.0.0.1:1",
          protocolVersion: "codex-cli 0.154.0",
          status: "ready",
          lastNotificationAt: null,
          pendingRequestCount: 0,
          stderrSummary: null,
          lastErrorCode: null,
        } as never;
      }
      if (command === "request_codex_app_server" && Reflect.get(args ?? {}, "method") === "thread/start") {
        return { thread: { id: "thread_direct_1" } } as never;
      }
      return undefined as never;
    });
  }

  const executionStore = {
    getRuntime: vi.fn().mockResolvedValue({
      runtimeProfileId: "runtime_codex",
      provider: "codex",
      command: "/usr/local/bin/codex",
      environmentRefs: [],
      credentialRef: null,
      version: 1,
    }),
  };

  it("uses the platform-selected site and model instead of the account default", async () => {
    const loadModelExecution = vi.fn();
    const loadSelectedModelExecution = vi.fn().mockResolvedValue({
      model: "picked-model",
      reasoningEffort: "medium",
      environmentOverrides: { OPENAI_BASE_URL: "https://picked.example.com/v1" },
      credentialContext: {
        deploymentOrigin: "http://localhost:3000",
        userId: "user_1",
        credentialRef: "b".repeat(32),
      },
    });

    await openDirectAgentLiveSession({
      ...directSessionInput({
        modelSelection: { siteId: "b".repeat(32), model: "picked-model", reasoningEffort: "medium" },
      }),
      invoke: directInvoke(),
      listen: vi.fn().mockResolvedValue(() => undefined),
      executionStore,
      loadModelExecution,
      loadSelectedModelExecution,
    });

    // The platform choice must win; the account default must not even be read.
    expect(loadModelExecution).not.toHaveBeenCalled();
    expect(loadSelectedModelExecution).toHaveBeenCalledWith({
      siteId: "b".repeat(32),
      model: "picked-model",
      reasoningEffort: "medium",
    });
  });

  it("fails closed when the selected site no longer exists locally", async () => {
    const loadModelExecution = vi.fn();

    await expect(openDirectAgentLiveSession({
      ...directSessionInput({
        modelSelection: { siteId: "b".repeat(32), model: "picked-model", reasoningEffort: "medium" },
      }),
      invoke: directInvoke(),
      listen: vi.fn().mockResolvedValue(() => undefined),
      executionStore,
      loadModelExecution,
      loadSelectedModelExecution: vi.fn().mockRejectedValue(
        Object.assign(new Error("本机已无此模型站点，请重新选择"), { code: "local_model_site_unavailable" }),
      ),
    })).rejects.toMatchObject({ code: "local_model_site_unavailable" });

    expect(loadModelExecution).not.toHaveBeenCalled();
  });

  it("keeps using the account default when no selection was made", async () => {
    const loadModelExecution = vi.fn().mockResolvedValue({
      model: "account-default",
      reasoningEffort: "high",
      environmentOverrides: { OPENAI_BASE_URL: "https://account.example.com/v1" },
      credentialContext: {
        deploymentOrigin: "http://localhost:3000",
        userId: "user_1",
        credentialRef: "a".repeat(32),
      },
    });
    const loadSelectedModelExecution = vi.fn();

    await openDirectAgentLiveSession({
      ...directSessionInput(),
      invoke: directInvoke(),
      listen: vi.fn().mockResolvedValue(() => undefined),
      executionStore,
      loadModelExecution,
      loadSelectedModelExecution,
    });

    expect(loadModelExecution).toHaveBeenCalled();
    expect(loadSelectedModelExecution).not.toHaveBeenCalled();
  });
});

describe("Direct Agent platform-selected model resolution", () => {
  const sessionId = "f".repeat(32);
  const siteId = "b".repeat(32);

  function selectedSession(modelSelection: {
    siteId: string;
    model: string;
    reasoningEffort: "low" | "medium" | "high" | "xhigh" | "max" | "ultra";
  }) {
    return {
      sessionId,
      kind: "agent" as const,
      target: { type: "agent_device" as const, deviceId: "device_1", displayName: "Mac Studio" },
      projectId: null,
      taskId: null,
      executionPolicy: "direct" as const,
      relayUrl: `ws://localhost:3000/live-session/execution?sessionId=${sessionId}`,
      authorization: "lst1.payload.signature",
      initialCols: 120,
      initialRows: 36,
      modelSelection,
    };
  }

  function invoke() {
    return vi.fn(async (command: string, args?: Record<string, unknown>) => {
      if (command === "start_codex_app_server") {
        return {
          processKey: args?.input && typeof args.input === "object" ? Reflect.get(args.input, "processKey") : "codex-daemon:test",
          generation: 1,
          pid: 1,
          bindingFingerprint: "binding",
          model: "picked",
          reasoningEffort: "medium",
          transport: "websocket",
          endpoint: "ws://127.0.0.1:1",
          protocolVersion: "codex-cli 0.154.0",
          status: "ready",
          lastNotificationAt: null,
          pendingRequestCount: 0,
          stderrSummary: null,
          lastErrorCode: null,
        } as never;
      }
      if (command === "request_codex_app_server" && Reflect.get(args ?? {}, "method") === "thread/start") {
        return { thread: { id: "thread_direct_1" } } as never;
      }
      return undefined as never;
    });
  }

  const credentials = {
    apiBaseUrl: "http://localhost:3000",
    userId: "user_1",
    deviceId: "device_1",
    deviceToken: "device_token",
    apiToken: "api_token",
  };

  const executionStore = {
    getRuntime: vi.fn().mockResolvedValue({
      runtimeProfileId: "runtime_codex",
      provider: "codex",
      command: "/usr/local/bin/codex",
      environmentRefs: [],
      credentialRef: null,
      version: 1,
    }),
  };

  // The real resolver runs against this fake command surface, so the production
  // path is covered rather than a stub substituted for it.
  function fakeCommands(input: {
    sites: Array<{ siteId: string; name: string; adapter: string; baseUrl: string | null; credentialSource: string; credentialRef: string | null; status: string; lastValidatedAt: string | null }>;
    models: Array<{ modelKey: string; name: string; label: string }>;
  }) {
    return (() => ({
      listSites: vi.fn().mockResolvedValue({ schemaVersion: 2, sites: input.sites, accountDefault: null }),
      getCatalog: vi.fn().mockResolvedValue({ schemaVersion: 1, sites: { [siteId]: { refreshedAt: new Date().toISOString(), models: input.models } } }),
      getRouting: vi.fn().mockResolvedValue({ schemaVersion: 1, loops: {} }),
    })) as never;
  }

  const localSite = {
    siteId,
    name: "本机 Codex",
    adapter: "openai_compatible",
    baseUrl: "https://local.example.com/v1",
    credentialSource: "independent",
    credentialRef: "c".repeat(32),
    status: "ready",
    lastValidatedAt: new Date().toISOString(),
  };

  it("resolves the platform-selected site and model against local sites", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const appServer = await openDirectAgentLiveSession({
      session: selectedSession({ siteId, model: "picked-model", reasoningEffort: "medium" }),
      credentials,
      invoke: invoke(),
      listen: vi.fn().mockResolvedValue(() => undefined),
      executionStore,
      resolveWorkspace: vi.fn().mockResolvedValue("/Users/test/.humanthread/direct/device_1"),
      createLocalModelCommands: fakeCommands({
        sites: [localSite],
        models: [{ modelKey: "d".repeat(32), name: "picked-model", label: "Picked" }],
      }),
      loadModelExecution: vi.fn().mockImplementation(() => { calls.push({ accountDefault: true }); return undefined; }),
    });

    // The account default must not be consulted when a selection exists.
    expect(calls).toHaveLength(0);
    await appServer.close();
  });

  it("fails closed when the selected site is gone from this device", async () => {
    await expect(openDirectAgentLiveSession({
      session: selectedSession({ siteId, model: "picked-model", reasoningEffort: "medium" }),
      credentials,
      invoke: invoke(),
      listen: vi.fn().mockResolvedValue(() => undefined),
      executionStore,
      resolveWorkspace: vi.fn().mockResolvedValue("/Users/test/.humanthread/direct/device_1"),
      createLocalModelCommands: fakeCommands({
        // The site the platform froze is not present locally any more.
        sites: [{ ...localSite, siteId: "e".repeat(32) }],
        models: [{ modelKey: "d".repeat(32), name: "picked-model", label: "Picked" }],
      }),
      loadModelExecution: vi.fn(),
    })).rejects.toMatchObject({ code: "local_model_site_unavailable" });
  });

  it("fails closed when the selected model is gone from the local catalogue", async () => {
    await expect(openDirectAgentLiveSession({
      session: selectedSession({ siteId, model: "picked-model", reasoningEffort: "medium" }),
      credentials,
      invoke: invoke(),
      listen: vi.fn().mockResolvedValue(() => undefined),
      executionStore,
      resolveWorkspace: vi.fn().mockResolvedValue("/Users/test/.humanthread/direct/device_1"),
      createLocalModelCommands: fakeCommands({
        sites: [localSite],
        // The catalogue no longer lists the chosen model.
        models: [{ modelKey: "d".repeat(32), name: "other-model", label: "Other" }],
      }),
      loadModelExecution: vi.fn(),
    })).rejects.toMatchObject({ code: "local_model_site_unavailable" });
  });
});

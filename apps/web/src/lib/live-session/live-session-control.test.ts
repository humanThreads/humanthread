import { describe, expect, it, vi } from "vitest";

import {
  ACTIVE_TARGET_HEARTBEAT_WINDOW_MS,
  createLiveSessionControl,
  projectLiveSessionView,
  type LiveSessionControlDependencies,
} from "./live-session-control";

const now = new Date("2026-09-24T10:00:00.000Z");

function dependencies(overrides: Partial<LiveSessionControlDependencies> = {}): LiveSessionControlDependencies {
  return {
    authorizeSpace: vi.fn().mockResolvedValue({ spaceId: "space_company", role: "member" }),
    authorizeProject: vi.fn().mockResolvedValue({ projectId: "project_1", role: "maintainer" }),
    loadAgentDevice: vi.fn().mockResolvedValue({
      id: "device_1",
      userId: "user_1",
      name: "Mac Studio",
      status: "authorized",
      lastSeenAt: new Date(now.getTime() - 5_000),
      runtimeReady: true,
      connectorOnline: true,
    }),
    loadWorkerProjectTarget: vi.fn().mockResolvedValue({
      projectId: "project_1",
      spaceId: "space_company",
      workerPoolId: "a".repeat(32),
      workerPoolName: "ht-agnet",
      workerPoolStatus: "active",
      workerPoolLastSeenAt: new Date(now.getTime() - 5_000),
      workerPoolCapacity: 1,
    }),
    resolveDirectWorkerRuntime: vi.fn().mockResolvedValue({
      endpoint: "https://model.example.com/v1",
      apiKey: "model-key",
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
    }),
    loadTask: vi.fn().mockResolvedValue({
      id: "task_1",
      projectId: "project_1",
      spaceId: "space_company",
      statusCategory: "todo",
    }),
    createBusinessRun: vi.fn().mockResolvedValue({
      type: "agent_run",
      id: "agent_run_1",
    }),
    createSession: vi.fn().mockImplementation(async (input) => ({
      ...input,
      id: input.id,
      status: "starting" as const,
      controlState: "detached" as const,
      createdAt: now,
      updatedAt: now,
    })),
    listSessions: vi.fn().mockResolvedValue([]),
    closeSession: vi.fn().mockResolvedValue(true),
    createId: vi.fn().mockReturnValue("b".repeat(32)),
    now: () => now,
    listModelSites: vi.fn().mockResolvedValue([]),
    recordModelAudit: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function workerDirectInput(overrides: Record<string, unknown> = {}) {
  return {
    commandId: "a".repeat(32),
    kind: "worker",
    surface: "web",
    spaceId: "space_company",
    projectId: "project_1",
    taskId: null,
    executionPolicy: "direct",
    target: { type: "worker_pool" },
    businessRunId: null,
    initialCols: 120,
    initialRows: 36,
    ...overrides,
  } as never;
}

describe("LiveSession control", () => {
  it("creates a taskless direct Agent session that waits for the Desktop executor", async () => {
    const deps = dependencies();
    const control = createLiveSessionControl(deps);

    await expect(control.create({
      commandId: "c".repeat(32),
      kind: "agent",
      surface: "web",
      spaceId: "space_company",
      projectId: null,
      taskId: null,
      executionPolicy: "direct",
      target: { type: "agent_device", deviceId: "device_1" },
      businessRunId: null,
      initialCols: 120,
      initialRows: 36,
    }, { userId: "user_1" })).resolves.toMatchObject({ session: {
      kind: "agent",
      status: "starting",
      executionPolicy: "direct",
      projectId: null,
      taskId: null,
      target: { type: "agent_device", deviceId: "device_1", displayName: "Mac Studio" },
    } });
    expect(deps.loadWorkerProjectTarget).not.toHaveBeenCalled();
  });

  it("creates a taskless direct Worker session from the selected project Pool", async () => {
    const deps = dependencies();
    const control = createLiveSessionControl(deps);

    await expect(control.create({
      commandId: "d".repeat(32),
      kind: "worker",
      surface: "desktop",
      spaceId: "space_company",
      projectId: "project_1",
      taskId: null,
      executionPolicy: "direct",
      target: { type: "worker_pool" },
      businessRunId: null,
      initialCols: 120,
      initialRows: 36,
    }, { userId: "user_1" })).resolves.toMatchObject({ session: {
      kind: "worker",
      projectId: "project_1",
      taskId: null,
      executionPolicy: "direct",
      target: { type: "worker_pool", workerPoolId: "a".repeat(32), displayName: "ht-agnet" },
    } });
    expect(deps.loadWorkerProjectTarget).toHaveBeenCalledWith({ projectId: "project_1" });
    expect(deps.loadTask).not.toHaveBeenCalled();
  });

  it("rejects an offline Agent device without falling back", async () => {
    const deps = dependencies({
      loadAgentDevice: vi.fn().mockResolvedValue({
        id: "device_1",
        userId: "user_1",
        name: "Mac Studio",
        status: "authorized",
        lastSeenAt: new Date(now.getTime() - ACTIVE_TARGET_HEARTBEAT_WINDOW_MS - 1),
        runtimeReady: true,
        connectorOnline: true,
      }),
    });
    const control = createLiveSessionControl(deps);

    await expect(control.create({
      commandId: "e".repeat(32),
      kind: "agent",
      surface: "web",
      spaceId: "space_company",
      projectId: null,
      taskId: null,
      executionPolicy: "direct",
      target: { type: "agent_device", deviceId: "device_1" },
      businessRunId: null,
      initialCols: 120,
      initialRows: 36,
    }, { userId: "user_1" })).rejects.toMatchObject({ code: "agent_device_offline" });
  });

  it("creates a direct Agent session without creating a Loop business run", async () => {
    const deps = dependencies();
    const control = createLiveSessionControl(deps);

    await expect(control.create({
      commandId: "1".repeat(32),
      kind: "agent",
      surface: "desktop",
      spaceId: "space_company",
      projectId: "project_1",
      taskId: "task_1",
      executionPolicy: "direct",
      target: { type: "agent_device", deviceId: "device_1" },
      businessRunId: null,
      initialCols: 120,
      initialRows: 36,
    }, { userId: "user_1" })).resolves.toMatchObject({ session: {
      kind: "agent",
      projectId: "project_1",
      taskId: "task_1",
      executionPolicy: "direct",
    } });
    expect(deps.createBusinessRun).not.toHaveBeenCalled();
  });

  it("rejects a completed Task for new Worker and Agent Task sessions", async () => {
    const control = createLiveSessionControl(dependencies({
      loadTask: vi.fn().mockResolvedValue({
        id: "task_1",
        projectId: "project_1",
        spaceId: "space_company",
        statusCategory: "completed",
      }),
    }));

    await expect(control.create({
      commandId: "f".repeat(32),
      kind: "worker",
      surface: "web",
      spaceId: "space_company",
      projectId: "project_1",
      taskId: "task_1",
      executionPolicy: "direct",
      target: { type: "worker_pool" },
      businessRunId: null,
      initialCols: 120,
      initialRows: 36,
    }, { userId: "user_1" })).rejects.toMatchObject({ code: "task_not_open" });
  });

  it("does not expose terminal content in the active view projection", () => {
    expect(projectLiveSessionView({
      id: "a".repeat(32),
      kind: "worker",
      surface: "web",
      spaceId: "space_company",
      projectId: "project_1",
      taskId: "task_1",
      executionPolicy: "direct",
      target: { type: "worker_pool", workerPoolId: "b".repeat(32), displayName: "ht-agnet" },
      targetDisplayName: "ht-agnet",
      businessRun: null,
      status: "running",
      controlState: "viewer",
      journal: { status: "ready", retentionDays: 30, firstSequence: 0, lastSequence: 12 },
      modelSelection: null,
      createdAt: now,
      updatedAt: now,
    })).not.toHaveProperty("contentMarkdown");
  });

  it("projects the history flag so the UI can separate finished sessions", () => {
    const base = {
      id: "a".repeat(32),
      kind: "worker" as const,
      surface: "web" as const,
      spaceId: "space_company",
      projectId: "project_1",
      taskId: "task_1",
      executionPolicy: "loop" as const,
      target: { type: "worker_pool" as const, workerPoolId: "b".repeat(32), displayName: "ht-agnet" },
      targetDisplayName: "ht-agnet",
      businessRun: null,
      status: "running" as const,
      controlState: "viewer" as const,
      journal: { status: "ready" as const, retentionDays: 30, firstSequence: 0, lastSequence: 12 },
      modelSelection: null,
      createdAt: now,
      updatedAt: now,
    };

    expect(projectLiveSessionView({ ...base, history: true })).toMatchObject({ history: true });
    // An active session carries no flag, so older fixtures and clients keep working.
    expect(projectLiveSessionView(base)).not.toHaveProperty("history");
  });

  it("returns a single-use execution ticket without persisting it in the session view", async () => {
    const deps = dependencies();
    const control = createLiveSessionControl(deps, {
      createTicket: vi.fn().mockReturnValue({
        token: "lst1.payload.signature",
        expiresAt: new Date("2026-09-24T10:01:00.000Z"),
      }),
    });

    const result = await control.create({
      commandId: "2".repeat(32),
      kind: "agent",
      surface: "web",
      spaceId: "space_company",
      projectId: "project_1",
      taskId: "task_1",
      executionPolicy: "loop",
      target: { type: "agent_device", deviceId: "device_1" },
      businessRunId: null,
      initialCols: 120,
      initialRows: 36,
    }, { userId: "user_1" });

    expect(result).toMatchObject({
      session: { id: "b".repeat(32) },
      ticket: { token: "lst1.payload.signature" },
    });
    expect(createSessionArguments(deps)).not.toHaveProperty("ticket");
  });
});

function createSessionArguments(deps: LiveSessionControlDependencies): Record<string, unknown> {
  const mock = deps.createSession as unknown as { mock: { calls: Array<[Record<string, unknown>]> } };
  return mock.mock.calls[0]?.[0] ?? {};
}

describe("LiveSession model selection", () => {
  const siteId = "c".repeat(32);
  const catalogue = [{ name: "gpt-5.6-terra", label: "GPT-5.6 Terra" }];

  it("rejects a model selection whose site is outside the project scope", async () => {
    const deps = dependencies({
      listModelSites: vi.fn().mockResolvedValue([{ id: siteId, name: "mc", models: catalogue }]),
    });
    const control = createLiveSessionControl(deps);

    await expect(control.create(workerDirectInput({
      modelSelection: { siteId: "d".repeat(32), model: "gpt-5.6-terra", reasoningEffort: "high" },
    }), { userId: "user_1" })).rejects.toMatchObject({ code: "model_selection_invalid" });
  });

  it("rejects a model that is not in the selected site catalogue", async () => {
    const deps = dependencies({
      listModelSites: vi.fn().mockResolvedValue([{ id: siteId, name: "mc", models: catalogue }]),
    });
    const control = createLiveSessionControl(deps);

    await expect(control.create(workerDirectInput({
      modelSelection: { siteId, model: "not-listed", reasoningEffort: "high" },
    }), { userId: "user_1" })).rejects.toMatchObject({ code: "model_selection_invalid" });
  });

  it("accepts a free-form model when the site catalogue is empty", async () => {
    const deps = dependencies({
      listModelSites: vi.fn().mockResolvedValue([{ id: siteId, name: "mc", models: [] }]),
    });
    const control = createLiveSessionControl(deps);

    await expect(control.create(workerDirectInput({
      modelSelection: { siteId, model: "legacy-model-name", reasoningEffort: "high" },
    }), { userId: "user_1" })).resolves.toMatchObject({
      session: { model: { siteId, model: "legacy-model-name", reasoningEffort: "high", siteName: "mc" } },
    });
  });

  it("persists the validated selection on the session record", async () => {
    const deps = dependencies({
      listModelSites: vi.fn().mockResolvedValue([{ id: siteId, name: "mc", models: catalogue }]),
    });
    const control = createLiveSessionControl(deps);

    await expect(control.create(workerDirectInput({
      modelSelection: { siteId, model: "gpt-5.6-terra", reasoningEffort: "high" },
    }), { userId: "user_1" })).resolves.toMatchObject({
      session: {
        model: {
          siteId,
          siteName: "mc",
          model: "gpt-5.6-terra",
          label: "GPT-5.6 Terra",
          reasoningEffort: "high",
        },
      },
    });
    expect(deps.createSession).toHaveBeenCalledWith(expect.objectContaining({
      modelSelection: { siteId, model: "gpt-5.6-terra", reasoningEffort: "high" },
    }));
  });

  it("leaves the selection null when the caller omits it", async () => {
    const deps = dependencies();
    const control = createLiveSessionControl(deps);

    await expect(control.create(workerDirectInput(), { userId: "user_1" })).resolves.toMatchObject({
      session: { model: null },
    });
    expect(deps.listModelSites).not.toHaveBeenCalled();
  });

  it("records selection and rejection audit events without credentials", async () => {
    const accepted = dependencies({
      listModelSites: vi.fn().mockResolvedValue([{ id: siteId, name: "mc", models: catalogue }]),
    });
    await createLiveSessionControl(accepted).create(workerDirectInput({
      modelSelection: { siteId, model: "gpt-5.6-terra", reasoningEffort: "high" },
    }), { userId: "user_1" });

    const selectedCall = vi.mocked(accepted.recordModelAudit!).mock.calls.find(
      ([entry]) => entry.action === "live_session.model.selected",
    );
    expect(selectedCall?.[0].metadata).toMatchObject({
      siteId,
      model: "gpt-5.6-terra",
      reasoningEffort: "high",
      source: "explicit",
    });
    expect(JSON.stringify(selectedCall?.[0].metadata)).not.toMatch(/apiKey|endpoint|credential/iu);

    const rejected = dependencies({
      listModelSites: vi.fn().mockResolvedValue([{ id: siteId, name: "mc", models: catalogue }]),
    });
    await createLiveSessionControl(rejected).create(workerDirectInput({
      modelSelection: { siteId, model: "not-listed", reasoningEffort: "high" },
    }), { userId: "user_1" }).catch(() => undefined);

    const rejectedCall = vi.mocked(rejected.recordModelAudit!).mock.calls.find(
      ([entry]) => entry.action === "live_session.model.rejected",
    );
    expect(rejectedCall?.[0].metadata).toMatchObject({ siteId, code: "model_selection_invalid" });
    expect(JSON.stringify(rejectedCall?.[0].metadata)).not.toMatch(/apiKey|endpoint|credential/iu);
  });
});

describe("LiveSession model selection without a project stage config", () => {
  const siteId = "c".repeat(32);

  it("accepts an explicit selection when the project has no stage default", async () => {
    // The project has no task_development binding at all, so the *default* cannot
    // be resolved. The user's explicit choice must still be honoured: the stage
    // config is only needed for the fallback path.
    const deps = dependencies({
      listModelSites: vi.fn().mockResolvedValue([
        { id: siteId, name: "mc", models: [{ name: "gpt-5.6-terra", label: "Terra" }] },
      ]),
      resolveDirectWorkerRuntime: vi.fn(async (input: { projectId: string; selection?: unknown }) => {
        if (!input.selection) {
          throw Object.assign(new Error("项目尚未配置 Worker 模型"), { code: "worker_direct_runtime_missing" });
        }
        return {
          endpoint: "https://model.example.com/v1",
          apiKey: "key",
          model: "gpt-5.6-terra",
          reasoningEffort: "high",
        };
      }),
    });
    const control = createLiveSessionControl(deps);

    await expect(control.create(workerDirectInput({
      modelSelection: { siteId, model: "gpt-5.6-terra", reasoningEffort: "high" },
    }), { userId: "user_1" })).resolves.toMatchObject({
      session: { model: { siteId, model: "gpt-5.6-terra" } },
    });
    expect(deps.resolveDirectWorkerRuntime).toHaveBeenCalledWith(expect.objectContaining({
      selection: { siteId, model: "gpt-5.6-terra", reasoningEffort: "high" },
    }));
  });
});

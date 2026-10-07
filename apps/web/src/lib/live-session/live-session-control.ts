import {
  createLiveSessionInputSchema,
  liveSessionViewSchema,
  type CreateLiveSessionInput,
  type LiveSessionView,
} from "../../../../../packages/shared/src/index";

export const ACTIVE_TARGET_HEARTBEAT_WINDOW_MS = 30_000;

type LiveSessionStatus = LiveSessionView["status"];
type LiveSessionControlState = LiveSessionView["controlState"];
type LiveSessionJournal = LiveSessionView["journal"];

export interface AgentDeviceTargetRecord {
  id: string;
  userId: string;
  name: string;
  status: string;
  lastSeenAt: Date | null;
  runtimeReady: boolean;
  connectorOnline: boolean;
  /** Model sites reported by this Desktop device; empty when none were reported. */
  modelSites?: LiveSessionDeviceModelSite[];
}

export type LiveSessionDeviceModelSite = {
  siteId: string;
  name: string;
  adapter: string;
  models: Array<{ name: string; label: string }>;
};

export interface WorkerProjectTargetRecord {
  projectId: string;
  spaceId: string;
  workerPoolId: string;
  workerPoolName: string;
  workerPoolStatus: string;
  workerPoolLastSeenAt: Date | null;
  workerPoolCapacity: number;
}

export interface LiveSessionTaskRecord {
  id: string;
  projectId: string;
  spaceId: string | null;
  statusCategory: string;
}

export interface LiveSessionRecord {
  id: string;
  kind: CreateLiveSessionInput["kind"];
  surface: CreateLiveSessionInput["surface"];
  spaceId: string;
  projectId: string | null;
  taskId: string | null;
  executionPolicy: CreateLiveSessionInput["executionPolicy"];
  target: LiveSessionView["target"];
  targetDisplayName: string;
  businessRun: LiveSessionView["businessRun"];
  status: LiveSessionStatus;
  controlState: LiveSessionControlState;
  journal: LiveSessionJournal;
  /** Immutable snapshot of the user's model choice; null means "use the resolved default". */
  modelSelection: {
    siteId: string;
    model: string;
    reasoningEffort: string;
  } | null;
  createdAt: Date;
  updatedAt: Date;
  /**
   * True when the execution behind this session already finished. Set by the
   * store; the session row itself stays so its journal remains readable.
   */
  history?: boolean;
}

export type LiveSessionModelSite = {
  id: string;
  name: string;
  models: Array<{ name: string; label: string }>;
};

export interface LiveSessionControlDependencies {
  authorizeSpace(input: { userId: string; spaceId: string }): Promise<{ spaceId: string; role: string }>;
  authorizeProject(input: { userId: string; projectId: string }): Promise<{ projectId: string; role: string }>;
  loadAgentDevice(input: { userId: string; deviceId: string }): Promise<AgentDeviceTargetRecord | null>;
  loadWorkerProjectTarget(input: { projectId: string }): Promise<WorkerProjectTargetRecord | null>;
  resolveDirectWorkerRuntime?(input: {
    projectId: string;
    /** Present when the user chose a model; the selection can stand on its own. */
    selection?: { siteId: string; model: string; reasoningEffort: string } | null;
  }): Promise<{
    endpoint: string;
    apiKey: string;
    model: string;
    reasoningEffort: string;
  }>;
  listModelSites?(input: { userId: string; projectId: string }): Promise<LiveSessionModelSite[]>;
  recordModelAudit?(input: {
    action: string;
    actorUserId: string;
    workerPoolId: string;
    metadata: Record<string, unknown>;
  }): Promise<void>;
  loadTask(input: { userId: string; taskId: string }): Promise<LiveSessionTaskRecord | null>;
  createBusinessRun(input: {
    kind: "agent_run" | "loop_run";
    userId: string;
    projectId: string;
    taskId: string;
    executionPolicy: "direct" | "loop";
    target: LiveSessionView["target"];
    commandId: string;
  }): Promise<{ type: "agent_run" | "loop_run"; id: string }>;
  createSession(input: LiveSessionRecord & { ownerUserId: string }): Promise<LiveSessionRecord>;
  listSessions(input: { userId: string }): Promise<LiveSessionRecord[]>;
  closeSession(input: { userId: string; sessionId: string }): Promise<boolean>;
  createId(input: readonly string[]): string;
  now(): Date;
}

export interface LiveSessionControlOptions {
  createTicket(input: {
    sessionId: string;
    kind: "control" | "execution";
    now: Date;
  }): { token: string; expiresAt: Date };
}

function liveSessionError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function sameDateOrAfter(value: Date | null, threshold: Date): boolean {
  return value !== null && value.getTime() >= threshold.getTime();
}

function openTask(record: LiveSessionTaskRecord | null): record is LiveSessionTaskRecord {
  return Boolean(record && record.statusCategory !== "completed" && record.statusCategory !== "cancelled");
}

export function projectLiveSessionView(
  record: LiveSessionRecord,
  /** Resolved site display name; absent when the site was deleted after creation. */
  modelSiteName?: string | null,
  /** Resolved display label for the chosen model, when the site still lists it. */
  modelLabel?: string | null,
): LiveSessionView {
  return liveSessionViewSchema.parse({
    id: record.id,
    kind: record.kind,
    surface: record.surface,
    spaceId: record.spaceId,
    projectId: record.projectId,
    taskId: record.taskId,
    executionPolicy: record.executionPolicy,
    target: record.target,
    targetDisplayName: record.targetDisplayName,
    businessRun: record.businessRun,
    status: record.status,
    controlState: record.controlState,
    journal: record.journal,
    // A deleted site must not break the session view: report no model rather
    // than failing the whole response.
    model: record.modelSelection && modelSiteName
      ? {
          siteId: record.modelSelection.siteId,
          siteName: modelSiteName,
          model: record.modelSelection.model,
          label: modelLabel ?? record.modelSelection.model,
          reasoningEffort: record.modelSelection.reasoningEffort,
        }
      : null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    ...(record.history === undefined ? {} : { history: record.history }),
  });
}

export function createLiveSessionControl(
  dependencies: LiveSessionControlDependencies,
  options: Partial<LiveSessionControlOptions> = {},
) {
  async function create(inputValue: CreateLiveSessionInput, actor: { userId: string }): Promise<{
    session: LiveSessionView;
    ticket: { token: string; expiresAt: Date } | null;
  }> {
    const input = createLiveSessionInputSchema.parse(inputValue);
    await dependencies.authorizeSpace({ userId: actor.userId, spaceId: input.spaceId });

    let target: LiveSessionView["target"];
    let resolvedModelSelection: LiveSessionRecord["modelSelection"] = null;
    let resolvedModelSiteName: string | null = null;
    let resolvedModelLabel: string | null = null;
    if (input.kind === "agent") {
      if (input.target.type !== "agent_device") throw liveSessionError("agent_device_required", "Agent device is required");
      const device = await dependencies.loadAgentDevice({ userId: actor.userId, deviceId: input.target.deviceId });
      if (!device || device.userId !== actor.userId || device.status !== "authorized") {
        throw liveSessionError("agent_device_offline", "Agent device is unavailable");
      }
      const threshold = new Date(dependencies.now().getTime() - ACTIVE_TARGET_HEARTBEAT_WINDOW_MS);
      if (!sameDateOrAfter(device.lastSeenAt, threshold) || !device.connectorOnline) {
        throw liveSessionError("agent_device_offline", "Agent device is offline");
      }
      if (!device.runtimeReady) throw liveSessionError("agent_runtime_unavailable", "Agent runtime is unavailable");
      target = { type: "agent_device", deviceId: device.id, displayName: device.name };
    } else {
      if (!input.projectId) throw liveSessionError("worker_project_required", "Worker project is required");
      await dependencies.authorizeProject({ userId: actor.userId, projectId: input.projectId });
      const projectTarget = await dependencies.loadWorkerProjectTarget({ projectId: input.projectId });
      if (!projectTarget) throw liveSessionError("worker_pool_missing", "Project Worker Pool is not configured");
      const threshold = new Date(dependencies.now().getTime() - ACTIVE_TARGET_HEARTBEAT_WINDOW_MS);
      if (
        projectTarget.workerPoolStatus !== "active"
        || !sameDateOrAfter(projectTarget.workerPoolLastSeenAt, threshold)
        || projectTarget.workerPoolCapacity < 1
      ) throw liveSessionError("worker_pool_unavailable", "Project Worker Pool is unavailable");
      target = {
        type: "worker_pool",
        workerPoolId: projectTarget.workerPoolId,
        displayName: projectTarget.workerPoolName,
      };
      if (input.modelSelection) {
        if (!dependencies.listModelSites) {
          throw liveSessionError("model_selection_invalid", "模型选择当前不可用，请重新选择");
        }
        const sites = await dependencies.listModelSites({ userId: actor.userId, projectId: input.projectId });
        const site = sites.find((candidate) => candidate.id === input.modelSelection!.siteId);
        if (!site) {
          await dependencies.recordModelAudit?.({
            action: "live_session.model.rejected",
            actorUserId: actor.userId,
            workerPoolId: projectTarget.workerPoolId,
            metadata: { siteId: input.modelSelection.siteId, code: "model_selection_invalid" },
          });
          throw liveSessionError("model_selection_invalid", "所选模型站点不可用，请重新选择");
        }
        // An empty catalogue means the site has not been given a candidate list;
        // accept any well-formed model name so existing stage configs keep working.
        const catalogue = site.models ?? [];
        if (catalogue.length > 0 && !catalogue.some((entry) => entry.name === input.modelSelection!.model)) {
          await dependencies.recordModelAudit?.({
            action: "live_session.model.rejected",
            actorUserId: actor.userId,
            workerPoolId: projectTarget.workerPoolId,
            metadata: { siteId: site.id, code: "model_selection_invalid" },
          });
          throw liveSessionError("model_selection_invalid", "所选模型不在站点的模型清单中，请重新选择");
        }
        resolvedModelSelection = {
          siteId: site.id,
          model: input.modelSelection.model,
          reasoningEffort: input.modelSelection.reasoningEffort,
        };
        resolvedModelSiteName = site.name;
        resolvedModelLabel = catalogue.find((entry) => entry.name === input.modelSelection!.model)?.label ?? null;
      }
      if (input.executionPolicy === "direct") {
        if (!dependencies.resolveDirectWorkerRuntime) {
          throw liveSessionError("worker_direct_runtime_missing", "Direct Worker runtime is unavailable");
        }
        // Pass the explicit choice so a project with no stage default can still
        // start a session the user configured by hand; the stage config is only
        // required for the fallback path.
        await dependencies.resolveDirectWorkerRuntime({
          projectId: input.projectId,
          selection: resolvedModelSelection,
        });
      }
    }

    if (input.taskId) {
      const task = await dependencies.loadTask({ userId: actor.userId, taskId: input.taskId });
      if (!openTask(task)) throw liveSessionError("task_not_open", "Task is not open");
      if (input.projectId && task.projectId !== input.projectId) {
        throw liveSessionError("task_not_open", "Task does not belong to the selected project");
      }
    }
    let businessRun: LiveSessionRecord["businessRun"] = input.businessRunId
      ? { type: input.executionPolicy === "loop" ? "loop_run" : "agent_run", id: input.businessRunId }
      : null;
    if (input.taskId && input.projectId && businessRun === null && input.executionPolicy === "loop") {
      businessRun = await dependencies.createBusinessRun({
        kind: "loop_run",
        userId: actor.userId,
        projectId: input.projectId,
        taskId: input.taskId,
        executionPolicy: input.executionPolicy,
        target,
        commandId: input.commandId,
      });
    }

    const timestamp = dependencies.now();
    const record: LiveSessionRecord = {
      id: dependencies.createId([
        "live-session",
        actor.userId,
        input.commandId,
        input.kind,
        input.taskId ?? input.projectId ?? input.spaceId,
      ]),
      kind: input.kind,
      surface: input.surface,
      spaceId: input.spaceId,
      projectId: input.projectId,
      taskId: input.taskId,
      executionPolicy: input.executionPolicy,
      target,
      targetDisplayName: target.displayName,
      businessRun,
      status: "starting",
      controlState: "detached",
      journal: {
        status: "ready",
        retentionDays: 30,
        firstSequence: 0,
        lastSequence: 0,
      },
      modelSelection: resolvedModelSelection,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const session = projectLiveSessionView(await dependencies.createSession({
      ...record,
      ownerUserId: actor.userId,
    }), resolvedModelSiteName, resolvedModelLabel);
    // WorkerPoolAudit has a required WorkerPool foreign key, and an Agent session
    // has no Pool. Auditing an Agent session would require inventing a pool id,
    // so only Worker sessions are audited here; the Agent choice stays visible on
    // the session view and in the execution dispatch.
    if (target.type === "worker_pool") await dependencies.recordModelAudit?.({
      action: "live_session.model.selected",
      actorUserId: actor.userId,
      workerPoolId: target.workerPoolId,
      metadata: {
        sessionId: session.id,
        siteId: resolvedModelSelection?.siteId ?? null,
        model: resolvedModelSelection?.model ?? null,
        reasoningEffort: resolvedModelSelection?.reasoningEffort ?? null,
        source: resolvedModelSelection ? "explicit" : "default",
      },
    });
    return {
      session,
      ticket: options.createTicket
        ? options.createTicket({
            sessionId: session.id,
            kind: "execution",
            now: timestamp,
          })
        : null,
    };
  }

  async function list(actor: { userId: string }): Promise<LiveSessionView[]> {
    return (await dependencies.listSessions({ userId: actor.userId })).map((record) => projectLiveSessionView(record));
  }

  async function close(actor: { userId: string }, sessionId: string): Promise<void> {
    if (!await dependencies.closeSession({ userId: actor.userId, sessionId })) {
      throw liveSessionError("live_session_not_found", "Live session was not found");
    }
  }

  return {
    create,
    list,
    close,
    authorizeProject: dependencies.authorizeProject,
    loadAgentDevice: dependencies.loadAgentDevice,
    listModelSites(input: { userId: string; projectId: string }): Promise<LiveSessionModelSite[]> {
      return dependencies.listModelSites?.(input) ?? Promise.resolve([]);
    },
    resolveDirectWorkerRuntime(input: {
      projectId: string;
      selection?: { siteId: string; model: string; reasoningEffort: string } | null;
    }): Promise<{
      endpoint: string;
      apiKey: string;
      model: string;
      reasoningEffort: string;
    }> {
      if (!dependencies.resolveDirectWorkerRuntime) {
        throw liveSessionError("worker_direct_runtime_missing", "Direct Worker runtime is unavailable");
      }
      return dependencies.resolveDirectWorkerRuntime(input);
    },
  };
}

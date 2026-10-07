type WorkerResourceScope = {
  ownerType: "personal" | "company";
  ownerUserId: string | null;
  companyId: string | null;
};

type WorkerStageConfiguration = {
  siteId: string;
  model: string;
  reasoningEffort: string;
};

export type DirectWorkerRuntime = {
  endpoint: string;
  apiKey: string;
  model: string;
  reasoningEffort: string;
};

export interface DirectWorkerRuntimeDependencies {
  loadProject(projectId: string): Promise<WorkerResourceScope | null>;
  loadBinding(projectId: string): Promise<{ workerStageConfigurations: unknown } | null>;
  resolveModelSiteSecret(input: {
    scope: WorkerResourceScope;
    siteId: string;
  }): Promise<{ id: string; endpoint: string; apiKeyReference: string; apiKey: string }>;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function firstStageConfiguration(value: unknown): WorkerStageConfiguration | null {
  const stages = record(value);
  if (!stages) return null;
  // A JSON object's key order is not stable across storage round-trips, so the
  // default is chosen by an explicit sort instead of Object.values order.
  for (const key of Object.keys(stages).sort()) {
    const stage = record(stages[key]);
    if (
      typeof stage?.siteId === "string"
      && typeof stage.model === "string"
      && typeof stage.reasoningEffort === "string"
    ) {
      return {
        siteId: stage.siteId,
        model: stage.model,
        reasoningEffort: stage.reasoningEffort,
      };
    }
  }
  return null;
}

export async function resolveDirectWorkerRuntime(
  projectId: string,
  dependencies: DirectWorkerRuntimeDependencies,
  /** Session-level choice made at creation time; takes priority over the project default. */
  selection?: { siteId: string; model: string; reasoningEffort: string } | null,
): Promise<DirectWorkerRuntime> {
  const [project, binding] = await Promise.all([
    dependencies.loadProject(projectId),
    dependencies.loadBinding(projectId),
  ]);
  if (!project) {
    throw Object.assign(new Error("项目尚未配置 Worker 模型，无法启动无任务会话"), {
      code: "worker_direct_runtime_missing",
    });
  }
  const chosen = selection ?? firstStageConfiguration(binding?.workerStageConfigurations);
  if (!chosen) {
    throw Object.assign(new Error("项目尚未配置 Worker 模型，无法启动无任务会话"), {
      code: "worker_direct_runtime_missing",
    });
  }
  const secret = await dependencies.resolveModelSiteSecret({
    scope: project,
    siteId: chosen.siteId,
  });
  return {
    endpoint: secret.endpoint,
    apiKey: secret.apiKey,
    model: chosen.model,
    reasoningEffort: chosen.reasoningEffort,
  };
}

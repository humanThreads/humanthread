import { z } from "zod";

import { getNativeBridge } from "../lib/native-bridge";

import {
  agentProviderSchema,
  agentRuntimeEnvironmentRefs,
  computePathFingerprint,
  type AgentProvider,
  type LocalRuntimeConfiguration,
  type LocalWorkspaceConfiguration,
} from "../lib/execution-configuration";

export { computePathFingerprint } from "../lib/execution-configuration";

const EXECUTION_CONFIGURATION_STATE_KEY = "execution-configuration:v1";
const EXECUTION_CONFIGURATION_SCHEMA_VERSION = 1;
const MAX_PATH_LENGTH = 4_096;

const boundedIdSchema = z.string().trim().min(1).max(96).regex(/^[A-Za-z0-9_-]+$/u);
const deviceExecutionIdSchema = z.string().trim().min(1).max(96)
  .regex(/^[A-Za-z0-9_-]+(?::[A-Za-z0-9_-]+)*$/u);
const absolutePathSchema = z.string().min(1).max(MAX_PATH_LENGTH).superRefine((value, context) => {
  if (/[\u0000-\u001F\u007F]/u.test(value)) {
    context.addIssue({ code: "custom", message: "Path contains control characters" });
  }
  if (!value.startsWith("/") && !/^[A-Za-z]:[\\/]/u.test(value) && !value.startsWith("\\\\")) {
    context.addIssue({ code: "custom", message: "Path must be absolute" });
  }
});
const installationKeySchema = z.string().min(32).max(128).regex(/^[A-Za-z0-9_-]+$/u);
const environmentRefAllowlist = new Set<string>(agentRuntimeEnvironmentRefs);
const environmentRefSchema = z.string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/u)
  .refine(
    (value) => environmentRefAllowlist.has(value),
    "Runtime environment reference is not allowlisted",
  );
const runtimeCommandSchema = z.string().trim().min(1).max(1_024).refine(
  (value) => !/[\u0000-\u001F\u007F]/u.test(value),
  "Runtime command contains control characters",
);

const persistedWorkspaceSchema = z.object({
  bindingId: deviceExecutionIdSchema.nullable().default(null),
  absolutePath: absolutePathSchema,
  realpath: absolutePathSchema,
  configurationVersion: z.number().int().positive(),
}).strict();

const persistedRuntimeSchema = z.object({
  runtimeProfileId: deviceExecutionIdSchema.nullable().default(null),
  provider: agentProviderSchema,
  command: runtimeCommandSchema,
  environmentRefs: z.array(environmentRefSchema).max(32).refine(
    (values) => new Set(values).size === values.length,
    "Runtime environment references must be unique",
  ),
  credentialRef: z.string().regex(/^[0-9a-f]{32}$/u).nullable().default(null),
  version: z.number().int().positive().default(1),
}).strict();

const persistedExecutionConfigurationSchema = z.object({
  schemaVersion: z.literal(EXECUTION_CONFIGURATION_SCHEMA_VERSION),
  installationKey: installationKeySchema,
  workspaces: z.record(boundedIdSchema, persistedWorkspaceSchema),
  runtimes: z.partialRecord(agentProviderSchema, persistedRuntimeSchema).superRefine((runtimes, context) => {
    for (const [provider, runtime] of Object.entries(runtimes)) {
      if (provider !== runtime.provider) {
        context.addIssue({ code: "custom", message: "Runtime provider key does not match value" });
      }
    }
  }),
  workerPreferences: z.object({
    enabled: z.boolean(),
    maxConcurrency: z.number().int().min(1).max(128),
  }).strict().default({ enabled: true, maxConcurrency: 1 }),
  sessionJournalPreferences: z.object({
    retentionDays: z.number().int().min(1).max(3_650),
  }).strict().default({ retentionDays: 30 }),
}).strict();

type PersistedExecutionConfiguration = z.infer<typeof persistedExecutionConfigurationSchema>;

export interface PersistentExecutionConfigStore {
  get<T>(key: string): Promise<T | null | undefined>;
  set(key: string, value: unknown): Promise<void>;
  save(): Promise<void>;
}

export interface LocalExecutionConfigStore {
  getWorkspace(projectId: string): Promise<LocalWorkspaceConfiguration | null>;
  getWorkspaceByBindingId(bindingId: string): Promise<LocalWorkspaceConfiguration | null>;
  setWorkspace(projectId: string, input: Omit<LocalWorkspaceConfiguration,
    "projectId" | "pathFingerprint">): Promise<LocalWorkspaceConfiguration>;
  removeWorkspace(projectId: string): Promise<void>;
  getRuntime(provider: AgentProvider): Promise<LocalRuntimeConfiguration | null>;
  upsertRuntime(input: LocalRuntimeConfiguration): Promise<LocalRuntimeConfiguration>;
  disableRuntime(provider: AgentProvider, version: number): Promise<{
    provider: AgentProvider;
    status: "disabled";
    version: number;
  }>;
  rotateInstallationKey(): Promise<LocalWorkspaceConfiguration[]>;
  getWorkerPreferences(): Promise<{ enabled: boolean; maxConcurrency: number }>;
  setWorkerPreferences(input: { enabled: boolean; maxConcurrency: number }): Promise<{
    enabled: boolean;
    maxConcurrency: number;
  }>;
  getSessionJournalPreferences(): Promise<{ retentionDays: number }>;
  setSessionJournalPreferences(input: { retentionDays: number }): Promise<{ retentionDays: number }>;
}

function configurationError(message: string): Error {
  return Object.assign(new Error(message), { code: "execution_configuration_corrupted" });
}

function parsePersistedState(value: unknown): PersistedExecutionConfiguration {
  const parsed = persistedExecutionConfigurationSchema.safeParse(value);
  if (!parsed.success) throw configurationError("Local execution configuration is corrupted");
  return parsed.data;
}

function serializedState(value: unknown): string | undefined {
  return JSON.stringify(value);
}

function createInstallationKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function copyState(state: PersistedExecutionConfiguration): PersistedExecutionConfiguration {
  return structuredClone(state);
}

function normalizeProjectId(projectId: string): string {
  return boundedIdSchema.parse(projectId);
}

function normalizeDeviceExecutionId(id: string): string {
  return deviceExecutionIdSchema.parse(id);
}

function normalizeProvider(provider: AgentProvider): AgentProvider {
  return agentProviderSchema.parse(provider);
}

export function buildExecutionConfigStorePath(deviceId: string): string {
  const normalized = boundedIdSchema.safeParse(deviceId);
  if (!normalized.success || normalized.data.length > 64) {
    throw new Error("Invalid local Agent device ID");
  }
  return `execution-configuration-${normalized.data}.json`;
}

export async function createNativeExecutionConfigStore(input: {
  deviceId: string;
  openStore?: (path: string) => Promise<PersistentExecutionConfigStore>;
  createInstallationKey?: () => string;
}): Promise<LocalExecutionConfigStore> {
  const openStore = input.openStore ?? (async (path) => {
    const bridge = getNativeBridge();
    if (!bridge) {
      throw new Error("本地执行配置存储仅在桌面客户端中可用。");
    }
    return bridge.loadStore(path);
  });
  const persistentStore = await openStore(buildExecutionConfigStorePath(input.deviceId));
  const persisted = await persistentStore.get(EXECUTION_CONFIGURATION_STATE_KEY);
  let state: PersistedExecutionConfiguration;
  if (persisted === null || persisted === undefined) {
    state = persistedExecutionConfigurationSchema.parse({
      schemaVersion: EXECUTION_CONFIGURATION_SCHEMA_VERSION,
      installationKey: (input.createInstallationKey ?? createInstallationKey)(),
      workspaces: {},
      runtimes: {},
      workerPreferences: { enabled: true, maxConcurrency: 1 },
      sessionJournalPreferences: { retentionDays: 30 },
    });
    await persistentStore.set(EXECUTION_CONFIGURATION_STATE_KEY, state);
    await persistentStore.save();
  } else {
    state = parsePersistedState(persisted);
    if (serializedState(persisted) !== serializedState(state)) {
      await persistentStore.set(EXECUTION_CONFIGURATION_STATE_KEY, state);
      await persistentStore.save();
    }
  }
  let mutationQueue = Promise.resolve();

  async function persist(nextState: PersistedExecutionConfiguration): Promise<void> {
    const validated = persistedExecutionConfigurationSchema.parse(nextState);
    await persistentStore.set(EXECUTION_CONFIGURATION_STATE_KEY, validated);
    await persistentStore.save();
    state = validated;
  }

  function mutate<T>(action: () => Promise<T>): Promise<T> {
    const result = mutationQueue.then(action);
    mutationQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  async function projectWorkspace(
    projectId: string,
    workspace: PersistedExecutionConfiguration["workspaces"][string],
  ): Promise<LocalWorkspaceConfiguration> {
    return {
      projectId,
      ...workspace,
      pathFingerprint: await computePathFingerprint(workspace.realpath, state.installationKey),
    };
  }

  return {
    async getWorkspace(projectId) {
      const normalizedProjectId = normalizeProjectId(projectId);
      const workspace = state.workspaces[normalizedProjectId];
      return workspace ? projectWorkspace(normalizedProjectId, workspace) : null;
    },
    async getWorkspaceByBindingId(bindingId) {
      const normalizedBindingId = normalizeDeviceExecutionId(bindingId);
      const entry = Object.entries(state.workspaces)
        .find(([, workspace]) => workspace.bindingId === normalizedBindingId);
      return entry ? projectWorkspace(entry[0], entry[1]) : null;
    },
    async setWorkspace(projectId, workspace) {
      return mutate(async () => {
        const normalizedProjectId = normalizeProjectId(projectId);
        const parsedWorkspace = persistedWorkspaceSchema.parse(workspace);
        const nextState = copyState(state);
        nextState.workspaces[normalizedProjectId] = parsedWorkspace;
        await persist(nextState);
        return projectWorkspace(normalizedProjectId, parsedWorkspace);
      });
    },
    async removeWorkspace(projectId) {
      return mutate(async () => {
        const normalizedProjectId = normalizeProjectId(projectId);
        if (!state.workspaces[normalizedProjectId]) return;
        const nextState = copyState(state);
        delete nextState.workspaces[normalizedProjectId];
        await persist(nextState);
      });
    },
    async getRuntime(provider) {
      const runtime = state.runtimes[normalizeProvider(provider)];
      return runtime ? {
        ...structuredClone(runtime),
        credentialRef: runtime.credentialRef ?? null,
      } : null;
    },
    async upsertRuntime(runtime) {
      return mutate(async () => {
        const parsedRuntime = persistedRuntimeSchema.parse(runtime);
        const nextState = copyState(state);
        nextState.runtimes[parsedRuntime.provider] = parsedRuntime;
        await persist(nextState);
        return {
          ...structuredClone(parsedRuntime),
          credentialRef: parsedRuntime.credentialRef ?? null,
        };
      });
    },
    async disableRuntime(provider, version) {
      return mutate(async () => {
        const normalizedProvider = normalizeProvider(provider);
        const parsedVersion = z.number().int().positive().parse(version);
        const nextState = copyState(state);
        delete nextState.runtimes[normalizedProvider];
        await persist(nextState);
        return { provider: normalizedProvider, status: "disabled", version: parsedVersion };
      });
    },
    async rotateInstallationKey() {
      return mutate(async () => {
        const nextState = copyState(state);
        nextState.installationKey = (input.createInstallationKey ?? createInstallationKey)();
        for (const workspace of Object.values(nextState.workspaces)) {
          workspace.configurationVersion += 1;
        }
        await persist(nextState);
        return Promise.all(Object.entries(state.workspaces)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([projectId, workspace]) => projectWorkspace(projectId, workspace)));
      });
    },
    async getWorkerPreferences() {
      return structuredClone(state.workerPreferences);
    },
    async setWorkerPreferences(preferences) {
      return mutate(async () => {
        const parsed = persistedExecutionConfigurationSchema.shape.workerPreferences.parse(preferences);
        const nextState = copyState(state);
        nextState.workerPreferences = parsed;
        await persist(nextState);
        return structuredClone(parsed);
      });
    },
    async getSessionJournalPreferences() {
      return structuredClone(state.sessionJournalPreferences);
    },
    async setSessionJournalPreferences(preferences) {
      return mutate(async () => {
        const parsed = persistedExecutionConfigurationSchema.shape.sessionJournalPreferences.parse(preferences);
        const nextState = copyState(state);
        nextState.sessionJournalPreferences = parsed;
        await persist(nextState);
        return structuredClone(parsed);
      });
    },
  };
}

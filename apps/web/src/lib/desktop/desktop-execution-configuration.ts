import { createHash } from "node:crypto";
import {
  deviceRuntimeProfileUpsertRequestSchema,
  workspaceConfigurationRevokeRequestSchema,
  workspaceConfigurationUpsertRequestSchema,
  type DeviceRuntimeProfileUpsertRequest,
  type WorkspaceConfigurationRevokeRequest,
  type WorkspaceConfigurationUpsertRequest,
} from "@humanthread/workbench-client";
import type {
  DeviceAgentRuntimeProfile,
  OrchestrationEventEnvelope,
  ProjectDeviceWorkspace,
} from "@humanthread/shared";
import {
  assertCanReadProject,
  executeIdempotentCommand,
  listDeviceExecutionConfiguration,
  prisma,
  revokeProjectDeviceWorkspace,
  upsertDeviceAgentRuntimeProfile,
  upsertProjectDeviceWorkspace,
  type DeviceExecutionConfigurationDependencies,
} from "../../../../../packages/db/src/index";
import { boundedPersistenceId } from "../../../../../packages/db/src/bounded-id";

import { resolveDesktopReadContext, type DesktopReadContext } from "./desktop-read-models";

type WorkspaceUpsertCommand = Omit<WorkspaceConfigurationUpsertRequest, "validatedAt"> & {
  actorUserId: string;
  projectId: string;
  localDeviceId: string;
  validatedAt: Date;
};

type WorkspaceRevokeCommand = WorkspaceConfigurationRevokeRequest & {
  actorUserId: string;
  projectId: string;
  localDeviceId: string;
};

type RuntimeUpsertCommand = Omit<DeviceRuntimeProfileUpsertRequest, "validatedAt"> & {
  actorUserId: string;
  localDeviceId: string;
  validatedAt: Date;
};

interface DesktopExecutionConfigurationDependencies {
  resolveDesktopReadContext: typeof resolveDesktopReadContext;
  listDeviceExecutionConfiguration: typeof listDeviceExecutionConfiguration;
  executeWorkspaceUpsert(input: WorkspaceUpsertCommand): Promise<ProjectDeviceWorkspace>;
  executeWorkspaceRevoke(input: WorkspaceRevokeCommand): Promise<ProjectDeviceWorkspace>;
  executeRuntimeUpsert(input: RuntimeUpsertCommand): Promise<DeviceAgentRuntimeProfile>;
}

const DEFAULT_DEPENDENCIES: DesktopExecutionConfigurationDependencies = {
  resolveDesktopReadContext,
  listDeviceExecutionConfiguration,
  executeWorkspaceUpsert: runWorkspaceUpsert,
  executeWorkspaceRevoke: runWorkspaceRevoke,
  executeRuntimeUpsert: runRuntimeUpsert,
};

function dependenciesWith(
  overrides: Partial<DesktopExecutionConfigurationDependencies>,
): DesktopExecutionConfigurationDependencies {
  return { ...DEFAULT_DEPENDENCIES, ...overrides };
}

export function buildDesktopConfigurationAggregateId(parts: readonly string[]): string {
  const readable = parts.join(":");
  return readable.length <= 96
    ? readable
    : boundedPersistenceId("desktop-config", parts, 96);
}

function validationError(message: string): Error {
  return Object.assign(new Error(message), { code: "validation_failed" as const });
}

function authorizationError(message: string): Error {
  return Object.assign(new Error(message), { code: "authorization_denied" as const });
}

function requireDesktopDevice(context: DesktopReadContext): {
  actorUserId: string;
  localDeviceId: string;
} {
  if (
    context.actor.authKind !== "desktop_token" ||
    !context.nativeExecutionAuthorized ||
    !context.localDeviceId
  ) {
    throw authorizationError("Authorized Desktop device is required");
  }
  return {
    actorUserId: context.actor.userId,
    localDeviceId: context.localDeviceId,
  };
}

function parseRequest<T>(schema: { safeParse(value: unknown): {
  success: boolean;
  data?: T;
} }, value: unknown, message: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw validationError(message);
  return parsed.data as T;
}

export async function updateDesktopWorkspace(
  request: Request,
  projectId: string,
  input: WorkspaceConfigurationUpsertRequest,
  dependencyOverrides: Partial<DesktopExecutionConfigurationDependencies> = {},
): Promise<ProjectDeviceWorkspace> {
  const parsed = parseRequest<WorkspaceConfigurationUpsertRequest>(
    workspaceConfigurationUpsertRequestSchema,
    input,
    "Invalid Desktop Workspace configuration",
  );
  const dependencies = dependenciesWith(dependencyOverrides);
  const device = requireDesktopDevice(await dependencies.resolveDesktopReadContext(request));
  return dependencies.executeWorkspaceUpsert({
    ...parsed,
    ...device,
    projectId,
    validatedAt: new Date(parsed.validatedAt),
  });
}

export async function revokeDesktopWorkspace(
  request: Request,
  projectId: string,
  input: WorkspaceConfigurationRevokeRequest,
  dependencyOverrides: Partial<DesktopExecutionConfigurationDependencies> = {},
): Promise<ProjectDeviceWorkspace> {
  const parsed = parseRequest<WorkspaceConfigurationRevokeRequest>(
    workspaceConfigurationRevokeRequestSchema,
    input,
    "Invalid Desktop Workspace revocation",
  );
  const dependencies = dependenciesWith(dependencyOverrides);
  const device = requireDesktopDevice(await dependencies.resolveDesktopReadContext(request));
  return dependencies.executeWorkspaceRevoke({ ...parsed, ...device, projectId });
}

export async function readDesktopAgentRuntimes(
  request: Request,
  dependencyOverrides: Partial<DesktopExecutionConfigurationDependencies> = {},
): Promise<DeviceAgentRuntimeProfile[]> {
  const dependencies = dependenciesWith(dependencyOverrides);
  const device = requireDesktopDevice(await dependencies.resolveDesktopReadContext(request));
  const result = await dependencies.listDeviceExecutionConfiguration(device);
  return result.runtimeProfiles;
}

export async function updateDesktopAgentRuntime(
  request: Request,
  input: DeviceRuntimeProfileUpsertRequest,
  dependencyOverrides: Partial<DesktopExecutionConfigurationDependencies> = {},
): Promise<DeviceAgentRuntimeProfile> {
  const parsed = parseRequest<DeviceRuntimeProfileUpsertRequest>(
    deviceRuntimeProfileUpsertRequestSchema,
    input,
    "Invalid Desktop Agent runtime configuration",
  );
  const dependencies = dependenciesWith(dependencyOverrides);
  const device = requireDesktopDevice(await dependencies.resolveDesktopReadContext(request));
  return dependencies.executeRuntimeUpsert({
    ...parsed,
    ...device,
    validatedAt: new Date(parsed.validatedAt),
  });
}

function commandIdentity(
  operation: string,
  targetId: string,
  externalCommandId: string,
): string {
  const digest = createHash("sha256")
    .update(`${operation}\0${targetId}\0${externalCommandId}`)
    .digest("hex");
  return `desktop-config:${digest}`;
}

function eventIdentity(commandId: string, eventType: string): string {
  return `event:${createHash("sha256").update(`${commandId}\0${eventType}`).digest("hex")}`;
}

async function executeConfigurationCommand<TResult extends ProjectDeviceWorkspace | DeviceAgentRuntimeProfile>(
  input: {
    operation: string;
    eventType: string;
    externalCommandId: string;
    targetId: string;
    actorUserId: string;
    expectedVersion?: number;
    payload: Record<string, unknown>;
    apply(dependencies: DeviceExecutionConfigurationDependencies): Promise<TResult>;
  },
): Promise<TResult> {
  const issuedAt = new Date();
  const commandId = commandIdentity(input.operation, input.targetId, input.externalCommandId);
  return executeIdempotentCommand({
    command: {
      commandId,
      correlationId: `desktop-config:${input.targetId}`,
      actor: { type: "user", id: input.actorUserId },
      ...(input.expectedVersion === undefined ? {} : { expectedVersion: input.expectedVersion }),
      payload: input.payload,
      issuedAt,
    },
    aggregate: { type: "workspace", id: input.targetId },
    db: {
      $transaction: (callback) => prisma.$transaction(async (tx) => callback(tx as never)),
    },
    apply: async (tx) => {
      const result = await input.apply({
        authorizeProject: ({ userId, projectId }) => assertCanReadProject({
          userId,
          projectId,
          db: tx as never,
        }),
        db: {
          $transaction: async (callback) => callback(tx as never),
        },
      });
      const version = "configurationVersion" in result
        ? result.configurationVersion
        : result.version;
      const event: OrchestrationEventEnvelope = {
        id: eventIdentity(commandId, input.eventType),
        eventType: input.eventType,
        aggregateType: "workspace",
        aggregateId: input.targetId,
        aggregateVersion: version,
        sequence: version,
        correlationId: `desktop-config:${input.targetId}`,
        commandId,
        actorType: "user",
        actorId: input.actorUserId,
        occurredAt: issuedAt,
        payload: input.payload,
      };
      return {
        result,
        events: [event],
        // The repository write already ran against this outer transaction.
        persist: async () => 1,
      };
    },
  });
}

function runWorkspaceUpsert(input: WorkspaceUpsertCommand): Promise<ProjectDeviceWorkspace> {
  return executeConfigurationCommand({
    operation: "workspace.upsert",
    eventType: "desktop.workspace.configured",
    externalCommandId: input.commandId,
    targetId: buildDesktopConfigurationAggregateId([input.projectId, input.localDeviceId]),
    actorUserId: input.actorUserId,
    ...(input.expectedVersion === undefined
      ? {}
      : { expectedVersion: input.expectedVersion }),
    payload: {
      projectId: input.projectId,
      localDeviceId: input.localDeviceId,
      status: input.status,
      pathFingerprint: input.pathFingerprint,
    },
    apply: (dependencies) => upsertProjectDeviceWorkspace({
      actorUserId: input.actorUserId,
      projectId: input.projectId,
      localDeviceId: input.localDeviceId,
      ...(input.expectedVersion === undefined
        ? {}
        : { expectedVersion: input.expectedVersion }),
      status: input.status,
      pathFingerprint: input.pathFingerprint,
      validatedAt: input.validatedAt,
    }, dependencies),
  });
}

function runWorkspaceRevoke(input: WorkspaceRevokeCommand): Promise<ProjectDeviceWorkspace> {
  return executeConfigurationCommand({
    operation: "workspace.revoke",
    eventType: "desktop.workspace.revoked",
    externalCommandId: input.commandId,
    targetId: buildDesktopConfigurationAggregateId([input.projectId, input.localDeviceId]),
    actorUserId: input.actorUserId,
    expectedVersion: input.expectedVersion,
    payload: {
      projectId: input.projectId,
      localDeviceId: input.localDeviceId,
    },
    apply: (dependencies) => revokeProjectDeviceWorkspace({
      actorUserId: input.actorUserId,
      projectId: input.projectId,
      localDeviceId: input.localDeviceId,
      expectedVersion: input.expectedVersion,
      revokedAt: new Date(),
    }, dependencies),
  });
}

function runRuntimeUpsert(input: RuntimeUpsertCommand): Promise<DeviceAgentRuntimeProfile> {
  return executeConfigurationCommand({
    operation: "runtime.upsert",
    eventType: "desktop.agent_runtime.configured",
    externalCommandId: input.commandId,
    targetId: buildDesktopConfigurationAggregateId([input.localDeviceId, input.provider]),
    actorUserId: input.actorUserId,
    ...(input.expectedVersion === undefined
      ? {}
      : { expectedVersion: input.expectedVersion }),
    payload: {
      localDeviceId: input.localDeviceId,
      provider: input.provider,
      status: input.status,
      capabilities: input.capabilities,
      modelSites: input.modelSites ?? [],
    },
    apply: (dependencies) => upsertDeviceAgentRuntimeProfile({
      actorUserId: input.actorUserId,
      localDeviceId: input.localDeviceId,
      ...(input.expectedVersion === undefined
        ? {}
        : { expectedVersion: input.expectedVersion }),
      provider: input.provider,
      label: input.label,
      status: input.status,
      capabilities: input.capabilities,
      modelSites: input.modelSites ?? [],
      validatedAt: input.validatedAt,
    }, dependencies),
  });
}

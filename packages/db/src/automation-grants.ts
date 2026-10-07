import { createHash } from "node:crypto";
import { createEventEnvelope } from "@humanthread/orchestration-core";
import {
  automationGrantSchema,
  LOOP_AUTOMATION_POLICY_VERSION,
  parsePublishedLoopGraph,
  type AutomationGrantSnapshot,
  type OrchestrationCommand,
} from "@humanthread/shared";
import { assertCanReadProject, assertCanWriteProject } from "./access-control";
import { boundedPersistenceId } from "./bounded-id";
import {
  executeIdempotentCommand,
  type OrchestrationCommandDb,
  type OrchestrationEventsTx,
} from "./orchestration-events";
import { prisma } from "./prisma";

type JsonRecord = Record<string, unknown>;

interface AutomationGrantRow {
  id: string;
  projectId: string;
  status: string;
  scope: unknown;
  expiresAt: Date | null;
  revokedAt: Date | null;
  version: number;
}

interface AutomationGrantTx extends OrchestrationEventsTx {
  project: {
    findUnique(args: unknown): Promise<{ id: string; spaceId: string | null } | null>;
  };
  projectLoopBinding: {
    findUnique(args: unknown): Promise<{
      id: string;
      projectId: string;
      automationGrantIds: unknown;
    } | null>;
    findMany(args: unknown): Promise<Array<{
      id: string;
      projectId: string;
      activeVersion: { status: string; graph: unknown };
    }>>;
  };
  automationGrant: {
    create(args: { data: JsonRecord }): Promise<unknown>;
    findUnique(args: unknown): Promise<AutomationGrantRow | null>;
    findMany(args: unknown): Promise<AutomationGrantRow[]>;
    updateMany(args: { where: JsonRecord; data: JsonRecord }): Promise<{ count: number }>;
  };
}

interface AutomationGrantDb extends OrchestrationCommandDb<AutomationGrantTx> {}

export interface AutomationGrantDependencies {
  now(): Date;
  authorizeManageAutomation(input: { userId: string; projectId: string }): Promise<unknown>;
  authorizeReadAutomation(input: { userId: string; projectId: string }): Promise<unknown>;
  db: AutomationGrantDb;
}

const DEFAULTS: AutomationGrantDependencies = {
  now: () => new Date(),
  authorizeManageAutomation: (input) => assertCanWriteProject(input),
  authorizeReadAutomation: (input) => assertCanReadProject(input),
  db: prisma as unknown as AutomationGrantDb,
};

export function fingerprintAutomationGrant(value: unknown): string {
  const normalized = parseGrant(value);
  return `sha256:${createHash("sha256").update(canonicalJson(normalized)).digest("hex")}`;
}

export async function createAutomationGrant(input: {
  actorUserId: string;
  projectId: string;
  commandId: string;
  grant: unknown;
  confirmationFingerprint: string;
}, dependencies: AutomationGrantDependencies = DEFAULTS): Promise<{
  id: string;
  projectId: string;
  status: "active";
  version: number;
  confirmationFingerprint: string;
}> {
  const projectId = requiredId(input.projectId, "projectId", 64);
  const actorUserId = requiredId(input.actorUserId, "actorUserId", 64);
  const externalCommandId = requiredId(input.commandId, "commandId", 128);
  await dependencies.authorizeManageAutomation({ userId: actorUserId, projectId });

  const normalized = parseGrant(input.grant);
  if (normalized.projectId !== projectId) {
    throw validationError("Automation grant belongs to another Project");
  }
  if (normalized.status !== "active" || normalized.revokedAt !== null) {
    throw validationError("A new AutomationGrant must be active and unrevoked");
  }
  if (normalized.policyVersion !== LOOP_AUTOMATION_POLICY_VERSION) {
    throw validationError("Automation grant policy version is not current");
  }
  const confirmationFingerprint = fingerprintAutomationGrant(normalized);
  if (input.confirmationFingerprint !== confirmationFingerprint) {
    throw validationError("Automation grant confirmation is stale");
  }

  const issuedAt = dependencies.now();
  const command = grantCommand({
    operation: "create",
    externalCommandId,
    projectId,
    grantId: normalized.id,
    actorUserId,
    issuedAt,
  });
  const result = {
    id: normalized.id,
    projectId,
    status: "active" as const,
    version: 1,
    confirmationFingerprint,
  };

  return executeIdempotentCommand({
    command,
    aggregate: { type: "loop", id: normalized.id },
    db: dependencies.db,
    apply: async (tx) => {
      const project = await tx.project.findUnique({
        where: { id: projectId },
        select: { id: true, spaceId: true },
      });
      if (!project) throw notFound("Project not found");
      if (!project.spaceId || project.spaceId !== normalized.spaceId) {
        throw validationError("Automation grant Space does not own the Project");
      }
      await assertGrantBindingScope({ tx, grant: normalized, projectId });

      return {
        result,
        events: [grantEvent({
          command,
          grantId: normalized.id,
          projectId,
          version: 1,
          eventType: "loop.automation_grant.created",
          payload: { confirmationFingerprint, policyVersion: normalized.policyVersion },
        })],
        persist: async (currentTx) => {
          await currentTx.automationGrant.create({
            data: {
              id: normalized.id,
              spaceId: normalized.spaceId,
              projectId,
              bindingId: normalized.bindingIds.length === 1 ? normalized.bindingIds[0] : null,
              nodeKey: normalized.nodeKeys.length === 1 ? normalized.nodeKeys[0] : null,
              status: normalized.status,
              scope: normalized,
              policyVersion: normalized.policyVersion,
              confirmationFingerprint,
              createdByUserId: actorUserId,
              confirmedAt: new Date(normalized.confirmedAt),
              expiresAt: normalized.expiresAt === null ? null : new Date(normalized.expiresAt),
              revokedAt: null,
              version: 1,
            },
          });
          return 1;
        },
      };
    },
  });
}

async function assertGrantBindingScope(input: {
  tx: AutomationGrantTx;
  grant: AutomationGrantSnapshot;
  projectId: string;
}): Promise<void> {
  if (input.grant.bindingIds.length === 0) return;
  const bindings = await input.tx.projectLoopBinding.findMany({
    where: { id: { in: input.grant.bindingIds }, projectId: input.projectId },
    select: {
      id: true,
      projectId: true,
      activeVersion: { select: { status: true, graph: true } },
    },
  });
  if (bindings.length !== input.grant.bindingIds.length) {
    throw validationError("Automation grant references an unavailable Loop binding");
  }

  const executableNodes = new Map<string, "local" | "platform">();
  for (const binding of bindings) {
    if (binding.projectId !== input.projectId || binding.activeVersion.status !== "published") {
      throw validationError("Automation grant requires published Loop bindings from the same Project");
    }
    let graph;
    try {
      graph = parsePublishedLoopGraph(binding.activeVersion.graph);
    } catch {
      throw validationError("Automation grant Loop graph is invalid");
    }
    for (const node of graph.nodes) {
      if (node.type === "agent_action") executableNodes.set(node.key, "local");
      if (node.type === "platform_action") executableNodes.set(node.key, "platform");
    }
  }

  if (executableNodes.size > 0 && input.grant.nodeKeys.length === 0) {
    throw validationError("Automation grant must declare executable Loop nodes");
  }
  for (const nodeKey of input.grant.nodeKeys) {
    const executionPlane = executableNodes.get(nodeKey);
    if (!executionPlane) {
      throw validationError("Automation grant node is outside the selected Loop bindings");
    }
    if (!input.grant.executionPlanes.includes(executionPlane)) {
      throw validationError("Automation grant execution plane does not cover its Loop nodes");
    }
  }
}

export async function revokeAutomationGrant(input: {
  actorUserId: string;
  projectId: string;
  grantId: string;
  commandId: string;
}, dependencies: AutomationGrantDependencies = DEFAULTS): Promise<{
  id: string;
  projectId: string;
  status: "revoked";
  revokedAt: string;
  version: number;
}> {
  const projectId = requiredId(input.projectId, "projectId", 64);
  const actorUserId = requiredId(input.actorUserId, "actorUserId", 64);
  const grantId = requiredId(input.grantId, "grantId", 96);
  const externalCommandId = requiredId(input.commandId, "commandId", 128);
  await dependencies.authorizeManageAutomation({ userId: actorUserId, projectId });
  const issuedAt = dependencies.now();
  const command = grantCommand({
    operation: "revoke",
    externalCommandId,
    projectId,
    grantId,
    actorUserId,
    issuedAt,
  });

  return executeIdempotentCommand({
    command,
    aggregate: { type: "loop", id: grantId },
    db: dependencies.db,
    apply: async (tx) => {
      const current = await tx.automationGrant.findUnique({
        where: { id: grantId },
        select: {
          id: true,
          projectId: true,
          status: true,
          scope: true,
          expiresAt: true,
          revokedAt: true,
          version: true,
        },
      });
      if (!current || current.projectId !== projectId) throw notFound("AutomationGrant not found");
      if (current.status === "revoked" && current.revokedAt) {
        return {
          result: {
            id: current.id,
            projectId,
            status: "revoked" as const,
            revokedAt: current.revokedAt.toISOString(),
            version: current.version,
          },
          events: [],
          persist: async () => undefined,
        };
      }
      if (current.status !== "active" || current.revokedAt !== null) {
        throw validationError("AutomationGrant lifecycle state is invalid");
      }
      const result = {
        id: current.id,
        projectId,
        status: "revoked" as const,
        revokedAt: issuedAt.toISOString(),
        version: current.version + 1,
      };
      return {
        result,
        events: [grantEvent({
          command,
          grantId,
          projectId,
          version: result.version,
          eventType: "loop.automation_grant.revoked",
          payload: { revokedAt: result.revokedAt },
        })],
        persist: async (currentTx) => {
          const updated = await currentTx.automationGrant.updateMany({
            where: {
              id: grantId,
              projectId,
              status: "active",
              revokedAt: null,
              version: current.version,
            },
            data: {
              status: "revoked",
              revokedAt: issuedAt,
              version: { increment: 1 },
            },
          });
          return updated.count;
        },
      };
    },
  });
}

export async function listProjectAutomationGrants(input: {
  actorUserId: string;
  projectId: string;
  now?: Date;
}, dependencies: AutomationGrantDependencies = DEFAULTS): Promise<AutomationGrantSnapshot[]> {
  const projectId = requiredId(input.projectId, "projectId", 64);
  const actorUserId = requiredId(input.actorUserId, "actorUserId", 64);
  await dependencies.authorizeReadAutomation({ userId: actorUserId, projectId });
  return dependencies.db.$transaction(async (tx) => {
    const rows = await tx.automationGrant.findMany({
      where: { projectId },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      select: {
        id: true,
        projectId: true,
        status: true,
        scope: true,
        expiresAt: true,
        revokedAt: true,
        version: true,
      },
    });
    return rows.map(hydrateLiveGrant);
  });
}

export async function snapshotBindingGrants(input: {
  bindingId: string;
  now: Date;
}, dependencies: Pick<AutomationGrantDependencies, "db"> = DEFAULTS): Promise<AutomationGrantSnapshot[]> {
  const bindingId = requiredId(input.bindingId, "bindingId", 96);
  if (Number.isNaN(input.now.getTime())) throw validationError("Snapshot time is invalid");
  return dependencies.db.$transaction(async (tx) => {
    const binding = await tx.projectLoopBinding.findUnique({
      where: { id: bindingId },
      select: { id: true, projectId: true, automationGrantIds: true },
    });
    if (!binding) throw notFound("Loop binding not found");
    const grantIds = parseGrantIds(binding.automationGrantIds);
    if (grantIds.length === 0) return [];
    const rows = await tx.automationGrant.findMany({
      where: { id: { in: grantIds } },
      select: {
        id: true,
        projectId: true,
        status: true,
        scope: true,
        expiresAt: true,
        revokedAt: true,
        version: true,
      },
    });
    return rows
      .filter((row) => (
        row.projectId === binding.projectId
        && row.status === "active"
        && row.revokedAt === null
        && (row.expiresAt === null || row.expiresAt > input.now)
      ))
      .map((row) => ({ row, grant: parseGrant(row.scope) }))
      .filter(({ row, grant }) => (
        grant.id === row.id
        && grant.projectId === binding.projectId
        && grant.status === "active"
        && grant.revokedAt === null
        && grant.bindingIds.includes(bindingId)
        && (row.expiresAt === null
          ? grant.expiresAt === null
          : grant.expiresAt !== null && Date.parse(grant.expiresAt) === row.expiresAt.getTime())
        && Date.parse(grant.confirmedAt) <= input.now.getTime()
      ))
      .map(({ grant }) => grant)
      .sort((left, right) => left.id.localeCompare(right.id));
  });
}

function hydrateLiveGrant(row: AutomationGrantRow): AutomationGrantSnapshot {
  const snapshot = parseGrant(row.scope);
  return parseGrant({
    ...snapshot,
    status: row.status,
    expiresAt: row.expiresAt === null ? null : row.expiresAt.toISOString(),
    revokedAt: row.revokedAt === null ? null : row.revokedAt.toISOString(),
  });
}

function parseGrant(value: unknown): AutomationGrantSnapshot {
  const result = automationGrantSchema.safeParse(value);
  if (!result.success) throw validationError("AutomationGrant is invalid");
  return result.data;
}

function parseGrantIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 32) throw validationError("Loop automation grants are invalid");
  const ids = value.map((id) => requiredId(id, "automationGrantId", 96));
  return [...new Set(ids)].sort();
}

function grantCommand(input: {
  operation: "create" | "revoke";
  externalCommandId: string;
  projectId: string;
  grantId: string;
  actorUserId: string;
  issuedAt: Date;
}): OrchestrationCommand<unknown> {
  return {
    commandId: boundedPersistenceId("command", [
      `automation_grant.${input.operation}`,
      input.projectId,
      input.grantId,
      input.externalCommandId,
    ]),
    correlationId: `project:${input.projectId}`,
    actor: { type: "user", id: input.actorUserId },
    payload: { operation: input.operation, grantId: input.grantId },
    issuedAt: input.issuedAt,
  };
}

function grantEvent(input: {
  command: OrchestrationCommand<unknown>;
  grantId: string;
  projectId: string;
  version: number;
  eventType: string;
  payload: JsonRecord;
}) {
  return createEventEnvelope({
    id: boundedPersistenceId("event", [input.eventType, input.command.commandId]),
    eventType: input.eventType,
    aggregate: { type: "loop", id: input.grantId, version: input.version },
    sequence: input.version,
    correlationId: input.command.correlationId,
    commandId: input.command.commandId,
    actor: input.command.actor,
    occurredAt: input.command.issuedAt,
    payload: { projectId: input.projectId, ...input.payload },
  });
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as JsonRecord;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

function requiredId(value: unknown, name: string, maxLength: number): string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > maxLength
    || value !== value.trim()
  ) throw validationError(`${name} is invalid`);
  return value;
}

function validationError(message: string): Error {
  return Object.assign(new Error(message), { code: "validation_failed" });
}

function notFound(message: string): Error {
  return Object.assign(new Error(message), { code: "not_found" });
}

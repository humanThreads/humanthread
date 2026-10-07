import { createHash } from "node:crypto";
import type { OrchestrationActor } from "@humanthread/shared";
import { createEventEnvelope } from "@humanthread/orchestration-core";
import { assertCanWriteProject, executeIdempotentCommand, prisma } from "../../../../../packages/db/src/index";

export type ProjectRoadmapAction =
  | { type: "stage.create"; name: string; status?: string; startAt?: string | null; targetAt?: string | null }
  | { type: "stage.update"; stageId: string; expectedNodeVersion: number; name?: string; status?: string; startAt?: string | null; targetAt?: string | null }
  | { type: "stage.reorder"; stageIds: string[] }
  | { type: "stage.delete"; stageId: string; expectedNodeVersion: number }
  | { type: "milestone.create"; stageId: string; name: string; status?: string; targetAt?: string | null }
  | { type: "milestone.update"; milestoneId: string; expectedNodeVersion: number; name?: string; status?: string; targetAt?: string | null; riskSummary?: string | null }
  | { type: "milestone.reorder"; stageId: string; milestoneIds: string[] }
  | { type: "milestone.delete"; milestoneId: string; expectedNodeVersion: number }
  | { type: "task.move"; taskId: string; milestoneId: string | null; expectedTaskVersion: number };

export interface ProjectRoadmapCommandInput {
  projectId: string;
  actor: OrchestrationActor;
  commandId: string;
  correlationId: string;
  expectedVersion: number;
  action: ProjectRoadmapAction;
}

type ExecuteInput = ProjectRoadmapCommandInput & { eventType: string };
interface RoadmapDependencies {
  authorize(input: { userId: string; projectId: string }): Promise<unknown>;
  execute(input: ExecuteInput): Promise<{ projectId: string; version: number }>;
}

function commandError(code: "validation_failed" | "version_conflict" | "not_found", message: string): Error {
  return Object.assign(new Error(message), { code });
}

function dateValue(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw commandError("validation_failed", "Invalid roadmap date");
  return date;
}

function assertName(name: string | undefined): void {
  if (name !== undefined && !name.trim()) throw commandError("validation_failed", "Roadmap name is required");
}

function roadmapNodeId(prefix: "stage" | "milestone", projectId: string, commandId: string): string {
  return `${prefix}:${createHash("sha256").update(`${projectId}\0${commandId}`).digest("hex")}`;
}

function eventType(action: ProjectRoadmapAction): string {
  return `project.roadmap.${action.type.replace(".", ".")}${action.type.endsWith("create") ? "d" : action.type.endsWith("update") ? "d" : action.type.endsWith("delete") ? "d" : action.type.endsWith("reorder") ? "ed" : "d"}`;
}

export async function persistProjectRoadmapAction(tx: typeof prisma, input: ExecuteInput): Promise<void> {
  const { action, projectId } = input;
  if (action.type === "stage.create") {
    assertName(action.name);
    const last = await tx.projectStage.aggregate({ where: { projectId }, _max: { sortOrder: true } });
    const startAt = dateValue(action.startAt);
    const targetAt = dateValue(action.targetAt);
    const stageId = roadmapNodeId("stage", projectId, input.commandId);
    await tx.projectStage.create({ data: { id: stageId, projectId, key: stageId, name: action.name.trim(), status: action.status ?? "planned", sortOrder: (last._max.sortOrder ?? -1) + 1, entryCriteria: {}, exitCriteria: {}, ...(startAt === undefined ? {} : { startAt }), ...(targetAt === undefined ? {} : { targetAt }) } });
    return;
  }
  if (action.type === "stage.update") {
    assertName(action.name);
    const startAt = dateValue(action.startAt);
    const targetAt = dateValue(action.targetAt);
    const result = await tx.projectStage.updateMany({ where: { id: action.stageId, projectId, version: action.expectedNodeVersion }, data: { ...(action.name === undefined ? {} : { name: action.name.trim() }), ...(action.status === undefined ? {} : { status: action.status }), ...(startAt === undefined ? {} : { startAt }), ...(targetAt === undefined ? {} : { targetAt }), version: { increment: 1 } } });
    if (result.count !== 1) throw commandError("version_conflict", "Project stage changed");
    return;
  }
  if (action.type === "stage.reorder") {
    const [total, count] = await Promise.all([
      tx.projectStage.count({ where: { projectId } }),
      tx.projectStage.count({ where: { projectId, id: { in: action.stageIds } } }),
    ]);
    if (total !== action.stageIds.length || count !== total || new Set(action.stageIds).size !== total) throw commandError("validation_failed", "Invalid Project stage order");
    for (const [sortOrder, id] of action.stageIds.entries()) await tx.projectStage.update({ where: { id }, data: { sortOrder, version: { increment: 1 } } });
    return;
  }
  if (action.type === "stage.delete") {
    if (await tx.milestone.count({ where: { stageId: action.stageId, projectId } })) throw commandError("validation_failed", "Only empty stages can be removed");
    const result = await tx.projectStage.deleteMany({ where: { id: action.stageId, projectId, version: action.expectedNodeVersion } });
    if (result.count !== 1) throw commandError("version_conflict", "Project stage changed");
    return;
  }
  if (action.type === "milestone.create") {
    assertName(action.name);
    const stage = await tx.projectStage.findFirst({ where: { id: action.stageId, projectId }, select: { id: true } });
    if (!stage) throw commandError("not_found", "Project stage not found");
    const last = await tx.milestone.aggregate({ where: { stageId: action.stageId }, _max: { sortOrder: true } });
    const targetAt = dateValue(action.targetAt);
    await tx.milestone.create({ data: { id: roadmapNodeId("milestone", projectId, input.commandId), projectId, stageId: action.stageId, name: action.name.trim(), status: action.status ?? "planned", sortOrder: (last._max.sortOrder ?? -1) + 1, ...(targetAt === undefined ? {} : { targetAt }), requiredCheckPolicy: {} } });
    return;
  }
  if (action.type === "milestone.update") {
    assertName(action.name);
    const targetAt = dateValue(action.targetAt);
    const result = await tx.milestone.updateMany({ where: { id: action.milestoneId, projectId, version: action.expectedNodeVersion }, data: { ...(action.name === undefined ? {} : { name: action.name.trim() }), ...(action.status === undefined ? {} : { status: action.status }), ...(targetAt === undefined ? {} : { targetAt }), ...(action.riskSummary === undefined ? {} : { riskSummary: action.riskSummary?.trim() || null }), version: { increment: 1 } } });
    if (result.count !== 1) throw commandError("version_conflict", "Project milestone changed");
    return;
  }
  if (action.type === "milestone.reorder") {
    const scope = { projectId, stageId: action.stageId };
    const [total, count] = await Promise.all([
      tx.milestone.count({ where: scope }),
      tx.milestone.count({ where: { ...scope, id: { in: action.milestoneIds } } }),
    ]);
    if (total !== action.milestoneIds.length || count !== total || new Set(action.milestoneIds).size !== total) throw commandError("validation_failed", "Invalid milestone order");
    for (const [sortOrder, id] of action.milestoneIds.entries()) await tx.milestone.update({ where: { id }, data: { sortOrder, version: { increment: 1 } } });
    return;
  }
  if (action.type === "milestone.delete") {
    if (await tx.task.count({ where: { projectId, milestoneId: action.milestoneId } })) throw commandError("validation_failed", "Only empty milestones can be removed");
    const result = await tx.milestone.deleteMany({ where: { id: action.milestoneId, projectId, version: action.expectedNodeVersion } });
    if (result.count !== 1) throw commandError("version_conflict", "Project milestone changed");
    return;
  }
  if (action.milestoneId) {
    const milestone = await tx.milestone.findFirst({ where: { id: action.milestoneId, projectId }, select: { id: true } });
    if (!milestone) throw commandError("not_found", "Project milestone not found");
  }
  const result = await tx.task.updateMany({ where: { id: action.taskId, projectId, version: action.expectedTaskVersion }, data: { milestoneId: action.milestoneId, version: { increment: 1 } } });
  if (result.count !== 1) throw commandError("version_conflict", "Project Task changed");
}

const defaultDependencies: RoadmapDependencies = {
  authorize: (input) => assertCanWriteProject(input),
  execute: (input) => executeIdempotentCommand({
    command: { commandId: input.commandId, correlationId: input.correlationId, actor: input.actor, expectedVersion: input.expectedVersion, payload: input.action, issuedAt: new Date() },
    aggregate: { type: "project", id: input.projectId },
    db: { $transaction: (callback) => prisma.$transaction(async (tx) => callback(tx as never)) },
    apply: async (rawTx) => {
      const tx = rawTx as unknown as typeof prisma;
      const project = await tx.project.findUnique({ where: { id: input.projectId }, select: { id: true, version: true } });
      if (!project) throw commandError("not_found", "Project not found");
      if (project.version !== input.expectedVersion) throw commandError("version_conflict", "Project version conflict");
      const nextVersion = project.version + 1;
      return {
        result: { projectId: input.projectId, version: nextVersion },
        events: [createEventEnvelope({ id: `event:${input.commandId}:roadmap`, eventType: input.eventType, aggregate: { type: "project", id: input.projectId, version: nextVersion }, sequence: nextVersion, correlationId: input.correlationId, commandId: input.commandId, actor: input.actor, occurredAt: new Date(), payload: input.action })],
        persist: async () => {
          const updated = await tx.project.updateMany({ where: { id: input.projectId, version: input.expectedVersion }, data: { version: nextVersion } });
          if (updated.count !== 1) return 0;
          await persistProjectRoadmapAction(tx, input);
          return 1;
        },
      };
    },
  }),
};

export async function commandProjectRoadmap(input: ProjectRoadmapCommandInput, dependencies: RoadmapDependencies = defaultDependencies): Promise<{ projectId: string; version: number }> {
  if (input.actor.type !== "user") throw commandError("validation_failed", "Project roadmap command requires a user actor");
  if (!input.commandId.trim() || input.commandId.length > 96 || input.expectedVersion < 1) throw commandError("validation_failed", "Invalid Project roadmap command metadata");
  await dependencies.authorize({ userId: input.actor.id, projectId: input.projectId });
  return dependencies.execute({ ...input, eventType: eventType(input.action) });
}

import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { assertCanWriteProject } from "./access-control";
import { prisma } from "./prisma";

export type ReleasePlanStatus = "draft" | "running" | "succeeded" | "failed" | "cancelled";

function id(parts: string[]): string {
  return createHash("md5").update(parts.join("\0")).digest("hex");
}

export function releasePlanReference(kind: string, value: string): string {
  return id(["release-plan-ref", kind, value]);
}

function isSnapshotItem(value: unknown): value is { taskId?: unknown; stageId?: unknown } {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

type ReleasePlanTask = {
  id: string;
  title: string;
  taskBranch: string | null;
  milestoneId: string | null;
  milestone: { stageId: string | null } | null;
};

export function buildReleasePlanSnapshot(tasks: readonly ReleasePlanTask[]) {
  return tasks.map((task) => ({
    taskId: task.id,
    title: task.title,
    taskBranch: task.taskBranch,
    milestoneId: task.milestoneId,
    stageId: task.milestone?.stageId ?? null,
  }));
}

function eligible(statusCategory: string, status: string): boolean {
  return statusCategory === "completed" && !["cancelled", "canceled"].includes(status);
}

export function releasePlanSnapshotKey(taskIds: readonly string[]): string {
  return [...new Set(taskIds)].sort().join("\0");
}

export async function createReleasePlan(input: {
  actorUserId: string;
  projectId: string;
  name: string;
  taskIds: string[];
  commandId: string;
}) {
  await assertCanWriteProject({ userId: input.actorUserId, projectId: input.projectId });
  const name = input.name.trim();
  if (!name) throw Object.assign(new Error("Release plan name is required"), { code: "validation_failed" });
  const taskIds = [...new Set(input.taskIds.map((value) => value.trim()).filter(Boolean))];
  if (!taskIds.length) throw Object.assign(new Error("At least one completed task is required"), { code: "validation_failed" });
  const tasks = await prisma.task.findMany({
    where: { projectId: input.projectId, id: { in: taskIds } },
    select: { id: true, title: true, taskBranch: true, status: true, statusCategory: true, milestoneId: true, milestone: { select: { stageId: true } } },
  });
  if (tasks.length !== taskIds.length || tasks.some((task) => !eligible(task.statusCategory, task.status))) {
    throw Object.assign(new Error("Release plans may contain only completed, non-cancelled tasks"), { code: "validation_failed" });
  }
  const snapshotKey = releasePlanSnapshotKey(taskIds);
  const activePlans = await prisma.releasePlan.findMany({
    where: { projectId: releasePlanReference("project", input.projectId), status: { in: ["draft", "running"] } },
    select: { name: true, status: true, selectedSnapshot: true },
  });
  const duplicate = activePlans.find((plan) => {
    const snapshot = Array.isArray(plan.selectedSnapshot) ? plan.selectedSnapshot : [];
    const selected = snapshot.flatMap((item) => isSnapshotItem(item) && typeof item.taskId === "string" ? [item.taskId] : []);
    return releasePlanSnapshotKey(selected) === snapshotKey;
  });
  if (duplicate) throw Object.assign(new Error("已有相同任务的发布计划正在" + (duplicate.status === "running" ? "运行" : "准备") + "：" + duplicate.name), { code: "validation_failed" });
  const planId = id(["release-plan", input.projectId, input.commandId]);
  const snapshot = buildReleasePlanSnapshot(tasks);
  return prisma.$transaction(async (tx) => {
    const plan = await tx.releasePlan.create({ data: { id: planId, projectId: releasePlanReference("project", input.projectId), name, status: "draft", selectedSnapshot: snapshot, createdById: releasePlanReference("user", input.actorUserId) } });
    await tx.releasePlanTask.createMany({ data: tasks.map((task) => ({ id: id(["release-plan-task", planId, task.id]), releasePlanId: planId, taskId: releasePlanReference("task", task.id), milestoneId: task.milestoneId ? releasePlanReference("milestone", task.milestoneId) : null, stageId: task.milestone?.stageId ? releasePlanReference("stage", task.milestone.stageId) : null, taskTitle: task.title, status: "selected" })) });
    return plan;
  });
}

export async function listReleasePlans(projectId: string) {
  return prisma.releasePlan.findMany({ where: { projectId: releasePlanReference("project", projectId) }, orderBy: { createdAt: "desc" }, include: { tasks: { orderBy: { stageId: "asc" } } } });
}

export async function startReleasePlan(input: { actorUserId: string; projectId: string; planId: string; loopRunId: string }) {
  await assertCanWriteProject({ userId: input.actorUserId, projectId: input.projectId });
  const result = await prisma.releasePlan.updateMany({ where: { id: input.planId, projectId: releasePlanReference("project", input.projectId), status: "draft" }, data: { status: "running", loopRunId: releasePlanReference("loop-run", input.loopRunId), startedAt: new Date() } });
  if (result.count !== 1) throw Object.assign(new Error("Release plan is not startable"), { code: "validation_failed" });
  return prisma.releasePlan.findUnique({ where: { id: input.planId } });
}

export async function prepareReleasePlan(input: { actorUserId: string; projectId: string; planId: string }) {
  await assertCanWriteProject({ userId: input.actorUserId, projectId: input.projectId });
  const result = await prisma.releasePlan.updateMany({
    where: { id: input.planId, projectId: releasePlanReference("project", input.projectId), status: "draft" },
    data: { status: "running", startedAt: new Date() },
  });
  if (result.count !== 1) throw Object.assign(new Error("Release plan is not startable"), { code: "validation_failed" });
  return prisma.releasePlan.findUnique({ where: { id: input.planId } });
}

export async function attachReleasePlanLoopRun(input: { actorUserId: string; projectId: string; planId: string; loopRunId: string }) {
  await assertCanWriteProject({ userId: input.actorUserId, projectId: input.projectId });
  const result = await prisma.releasePlan.updateMany({
    where: { id: input.planId, projectId: releasePlanReference("project", input.projectId), status: "running" },
    data: { loopRunId: releasePlanReference("loop-run", input.loopRunId) },
  });
  if (result.count !== 1) throw Object.assign(new Error("Release plan cannot be linked to Loop Run"), { code: "validation_failed" });
  return prisma.releasePlan.findUnique({ where: { id: input.planId } });
}

export async function completeReleasePlan(input: { planId: string; loopRunId?: string | null; now?: Date }) {
  const now = input.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    const plan = await tx.releasePlan.findUnique({ where: { id: input.planId }, include: { tasks: true } });
    if (!plan) throw Object.assign(new Error("Release plan not found"), { code: "not_found" });
    if (plan.status === "succeeded") return plan;
    // Terminal events are delivered at-least-once. A late success event must
    // never reopen a plan that was already closed as failed or cancelled.
    if (plan.status === "failed" || plan.status === "cancelled") return plan;
    if (plan.status !== "running") throw Object.assign(new Error("Release plan is not completable"), { code: "validation_failed" });
    if (input.loopRunId && plan.loopRunId && releasePlanReference("loop-run", input.loopRunId) !== plan.loopRunId) throw Object.assign(new Error("Release plan Loop Run mismatch"), { code: "validation_failed" });
    const closed = await tx.releasePlan.updateMany({
      where: { id: plan.id, status: "running" },
      data: { status: "succeeded", completedAt: now },
    });
    if (closed.count !== 1) return tx.releasePlan.findUnique({ where: { id: plan.id } });
    await tx.releasePlanTask.updateMany({ where: { releasePlanId: plan.id }, data: { status: "published" } });
    const snapshot = Array.isArray(plan.selectedSnapshot) ? plan.selectedSnapshot : [];
    const taskIds = snapshot.flatMap((item) => isSnapshotItem(item) && typeof item.taskId === "string" ? [item.taskId] : []);
    await tx.task.updateMany({ where: { id: { in: taskIds } }, data: { publicationStatus: "published", publishedAt: now } });
    const stageIds = [...new Set(snapshot.flatMap((item) => isSnapshotItem(item) && typeof item.stageId === "string" ? [item.stageId] : []))];
    for (const stageId of stageIds) {
      const remaining = await tx.task.count({ where: { milestone: { stageId }, statusCategory: { notIn: ["cancelled", "canceled"] }, publicationStatus: { not: "published" } } });
      if (!remaining) await tx.projectStage.updateMany({ where: { id: stageId }, data: { publicationStatus: "published", publishedAt: now } });
    }
    return tx.releasePlan.findUnique({ where: { id: plan.id } });
  });
}

export async function failReleasePlan(input: { planId: string; reason: string; now?: Date }) {
  return prisma.releasePlan.updateMany({ where: { id: input.planId, status: { in: ["draft", "running"] } }, data: { status: "failed", failureReason: input.reason.trim() || "Release failed", completedAt: input.now ?? new Date() } });
}

export interface ReleasePlanLoopEventDependencies {
  loadRun(loopRunId: string): Promise<{
    status: string;
    id: string;
    releasePlan: { id: string; status: string } | null;
  } | null>;
  complete(input: { planId: string; loopRunId?: string | null }): Promise<unknown>;
  fail(input: { planId: string; reason: string }): Promise<unknown>;
}

const DEFAULT_RELEASE_PLAN_LOOP_EVENT_DEPENDENCIES: ReleasePlanLoopEventDependencies = {
  loadRun: async (loopRunId) => {
    const run = await prisma.loopRun.findUnique({ where: { id: loopRunId }, select: { status: true, id: true } });
    if (!run) return null;
    const releasePlan = await prisma.releasePlan.findUnique({ where: { loopRunId: releasePlanReference("loop-run", loopRunId) }, select: { id: true, status: true } });
    return { ...run, releasePlan };
  },
  complete: completeReleasePlan,
  fail: failReleasePlan,
};

export async function handleReleasePlanLoopEvent(
  input: unknown,
  dependencies: ReleasePlanLoopEventDependencies = DEFAULT_RELEASE_PLAN_LOOP_EVENT_DEPENDENCIES,
) {
  if (!input || typeof input !== "object") return false;
  const event = input as Record<string, unknown>;
  const payload = event.payload && typeof event.payload === "object" ? event.payload as Record<string, unknown> : event;
  const aggregate = event.aggregate && typeof event.aggregate === "object" && !Array.isArray(event.aggregate)
    ? event.aggregate as Record<string, unknown>
    : null;
  const loopRunId = typeof payload.loopRunId === "string"
    ? payload.loopRunId
    : typeof event.aggregateId === "string"
      ? event.aggregateId
      : aggregate && typeof aggregate.id === "string"
        ? aggregate.id
        : null;
  if (!loopRunId) return false;
  const run = await dependencies.loadRun(loopRunId);
  if (!run?.releasePlan) return false;
  if (["completed", "succeeded"].includes(run.status)) {
    await dependencies.complete({ planId: run.releasePlan.id, loopRunId: run.id });
    return true;
  }
  if (["failed", "cancelled", "canceled", "exhausted"].includes(run.status)) {
    await dependencies.fail({ planId: run.releasePlan.id, reason: `Release Loop ${run.status}` });
    return true;
  }
  return false;
}

export async function copyReleasePlan(input: { actorUserId: string; projectId: string; planId: string; commandId: string; name?: string }) {
  const source = await prisma.releasePlan.findFirst({ where: { id: input.planId, projectId: releasePlanReference("project", input.projectId) }, include: { tasks: true } });
  if (!source) throw Object.assign(new Error("Release plan not found"), { code: "not_found" });
  const snapshot = Array.isArray(source.selectedSnapshot) ? source.selectedSnapshot : [];
  const taskIds = snapshot.flatMap((item) => isSnapshotItem(item) && typeof item.taskId === "string" ? [item.taskId] : []);
  return createReleasePlan({ actorUserId: input.actorUserId, projectId: input.projectId, commandId: input.commandId, name: input.name?.trim() || `${source.name}（副本）`, taskIds });
}

/** Create a new draft from a failed plan's immutable task snapshot. */
export async function retryReleasePlan(input: { actorUserId: string; projectId: string; planId: string; commandId: string; name?: string }) {
  await assertCanWriteProject({ userId: input.actorUserId, projectId: input.projectId });
  const source = await prisma.releasePlan.findFirst({
    where: { id: input.planId, projectId: releasePlanReference("project", input.projectId), status: "failed" },
    include: { tasks: true },
  });
  if (!source) throw Object.assign(new Error("Only failed release plans can be retried"), { code: "validation_failed" });
  const planId = id(["release-plan", input.projectId, input.commandId]);
  return prisma.$transaction(async (tx) => {
    const plan = await tx.releasePlan.create({
      data: {
        id: planId,
        projectId: source.projectId,
        name: input.name?.trim() || `${source.name}（重试）`,
        status: "draft",
        selectedSnapshot: source.selectedSnapshot as Prisma.InputJsonValue,
        retryOfId: source.id,
        createdById: releasePlanReference("user", input.actorUserId),
      },
    });
    await tx.releasePlanTask.createMany({
      data: source.tasks.map((task) => ({
        id: id(["release-plan-task", planId, task.taskId]),
        releasePlanId: planId,
        taskId: task.taskId,
        milestoneId: task.milestoneId,
        stageId: task.stageId,
        taskTitle: task.taskTitle,
        status: "selected",
      })),
    });
    return plan;
  });
}

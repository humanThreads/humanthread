import type { Prisma } from "@prisma/client";
import {
  buildAccessibleProjectWhere,
  buildAccessibleTaskWhere,
  prisma,
} from "../../../../../packages/db/src/index";
import {
  getProjectListItems,
  type ProjectListItem,
} from "./workbench-projects";

export const DELIVERY_HEALTH_RANGES = ["7d", "30d", "90d"] as const;
export type DeliveryHealthRange = (typeof DELIVERY_HEALTH_RANGES)[number];

export function normalizeDeliveryHealthRange(value?: string): DeliveryHealthRange {
  return DELIVERY_HEALTH_RANGES.includes(value as DeliveryHealthRange)
    ? (value as DeliveryHealthRange)
    : "30d";
}

type SnapshotTask = {
  statusCategory: string;
  completedAt: Date | null;
  dueAt: Date | null;
  blockers: Array<{ createdAt: Date }>;
};

function median(values: number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? Math.round(sorted[middle] ?? 0)
    : Math.round(((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2);
}

function ageHours(now: Date, value: Date) {
  return Math.max(0, (now.getTime() - value.getTime()) / 3_600_000);
}

export function buildDeliveryHealthSnapshot(input: {
  now: Date;
  rangeStart: Date;
  tasks: SnapshotTask[];
  approvals: Array<{ status: string; createdAt: Date }>;
  runs: Array<{ status: string }>;
}) {
  const terminalRuns = input.runs.filter((run) =>
    ["succeeded", "failed", "timed_out", "orphaned", "cancelled"].includes(run.status),
  );
  const succeeded = terminalRuns.filter((run) => run.status === "succeeded").length;
  return {
    completedTasks: input.tasks.filter((task) => task.statusCategory === "completed" && task.completedAt && task.completedAt >= input.rangeStart && task.completedAt <= input.now).length,
    overdueTasks: input.tasks.filter((task) => task.dueAt && task.dueAt < input.now && !["completed", "cancelled"].includes(task.statusCategory)).length,
    blockerMedianAgeHours: median(input.tasks.flatMap((task) => task.blockers.map((blocker) => ageHours(input.now, blocker.createdAt)))),
    humanWaitMedianAgeHours: median(input.approvals.filter((approval) => approval.status === "pending").map((approval) => ageHours(input.now, approval.createdAt))),
    automationSuccess: terminalRuns.length === 0
      ? ({ state: "unavailable", label: "未自动化" } as const)
      : ({ state: "known", succeeded, total: terminalRuns.length, rate: Math.round(succeeded / terminalRuns.length * 100) } as const),
  };
}

export function buildDeliveryHealthTrend(input: {
  now: Date;
  range: DeliveryHealthRange;
  tasks: SnapshotTask[];
}) {
  const days = Number.parseInt(input.range, 10);
  const bucketDays = days <= 14 ? 1 : days <= 30 ? 3 : 7;
  const bucketCount = Math.ceil(days / bucketDays);
  const bucketMs = bucketDays * 86_400_000;
  const rangeStart = new Date(input.now.getTime() - days * 86_400_000);
  const completions = input.tasks.flatMap((task) => task.completedAt && task.completedAt >= rangeStart && task.completedAt <= input.now ? [task.completedAt] : []);
  const blockers = input.tasks.flatMap((task) => task.blockers.map((blocker) => blocker.createdAt).filter((createdAt) => createdAt >= rangeStart && createdAt <= input.now));

  if (completions.length + blockers.length < 2) {
    return { state: "insufficient", message: "数据不足，暂不展示趋势" } as const;
  }

  const points = Array.from({ length: bucketCount }, (_, index) => {
    const bucketStart = new Date(rangeStart.getTime() + index * bucketMs);
    return {
      label: `${bucketStart.getMonth() + 1}/${bucketStart.getDate()}`,
      completed: 0,
      blockers: 0,
    };
  });
  const bucketIndex = (value: Date) => Math.min(bucketCount - 1, Math.floor((value.getTime() - rangeStart.getTime()) / bucketMs));
  for (const completedAt of completions) points[bucketIndex(completedAt)]!.completed += 1;
  for (const createdAt of blockers) points[bucketIndex(createdAt)]!.blockers += 1;

  return { state: "ready", points } as const;
}

export interface DeliveryHealthReportData {
  range: DeliveryHealthRange;
  generatedAt: Date;
  metrics: ReturnType<typeof buildDeliveryHealthSnapshot>;
  trend: { state: "ready"; points: Array<{ label: string; completed: number; blockers: number }> } | { state: "insufficient"; message: string };
  projects: ProjectListItem[];
  availableProjects: ProjectListItem[];
  insights: Array<{ label: string; count: number; href: string; tone: "default" | "danger" | "warning" }>;
}

export async function countAccessibleTasksAwaitingAcceptance(input: {
  userId: string;
  spaceId?: string;
}) {
  return prisma.task.count({
    where: {
      AND: [
        buildAccessibleTaskWhere({
          userId: input.userId,
          ...(input.spaceId ? { spaceId: input.spaceId } : {}),
        }),
        { statusCategory: "in_review" },
      ],
    },
  });
}

export async function getDeliveryHealthReport(input: {
  userId: string;
  spaceKey?: string;
  spaceId?: string;
  companyId?: string;
  ownerType?: "company" | "personal";
  projectId?: string;
  range?: DeliveryHealthRange;
  now?: Date;
}): Promise<DeliveryHealthReportData> {
  const now = input.now ?? new Date();
  const range = normalizeDeliveryHealthRange(input.range);
  const days = Number.parseInt(range, 10);
  const rangeStart = new Date(now.getTime() - days * 86_400_000);
  const taskWhere: Prisma.TaskWhereInput = {
    AND: [
      buildAccessibleTaskWhere({ userId: input.userId, ...(input.spaceId ? { spaceId: input.spaceId } : {}) }),
      ...(input.projectId ? [{ projectId: input.projectId }] : []),
    ],
  };
  const projectWhere: Prisma.ProjectWhereInput = {
    AND: [
      buildAccessibleProjectWhere({ userId: input.userId, ...(input.companyId ? { companyId: input.companyId } : {}), ...(input.ownerType ? { ownerType: input.ownerType } : {}) }),
      ...(input.spaceId ? [{ spaceId: input.spaceId }] : []),
      ...(input.projectId ? [{ id: input.projectId }] : []),
    ],
  };
  const [tasks, approvals, runs, projects] = await Promise.all([
    prisma.task.findMany({ where: taskWhere, select: { statusCategory: true, completedAt: true, dueAt: true, blockers: { where: { status: "active" }, select: { createdAt: true } } } }),
    prisma.approvalRequest.findMany({ where: { project: projectWhere, OR: [{ status: "pending" }, { createdAt: { gte: rangeStart } }] }, select: { status: true, createdAt: true } }),
    prisma.agentRun.findMany({ where: { task: { is: taskWhere }, createdAt: { gte: rangeStart } }, select: { status: true } }),
    getProjectListItems({ userId: input.userId, ...(input.companyId ? { companyId: input.companyId } : {}), ...(input.ownerType ? { ownerType: input.ownerType } : {}), now }),
  ]);
  const visibleProjects = projects.filter((project) => (!input.spaceId || project.spaceId === input.spaceId) && (!input.projectId || project.id === input.projectId));
  const metrics = buildDeliveryHealthSnapshot({ now, rangeStart, tasks, approvals, runs });
  const trend = buildDeliveryHealthTrend({ now, range, tasks });
  const scope = new URLSearchParams();
  scope.set("spaceKey", input.spaceKey ?? "all");
  if (input.projectId) scope.set("project", input.projectId);
  return {
    range,
    generatedAt: now,
    metrics,
    trend,
    projects: visibleProjects,
    availableProjects: projects.filter((project) => !input.spaceId || project.spaceId === input.spaceId),
    insights: [
      { label: "处理逾期任务", count: metrics.overdueTasks, href: `/tasks?${scope.toString()}${scope.size ? "&" : ""}relation=overdue`, tone: metrics.overdueTasks ? "danger" : "default" },
      { label: "解除项目阻塞", count: visibleProjects.filter((project) => project.health === "blocked").length, href: `/projects?space=${encodeURIComponent(input.spaceKey ?? "all")}`, tone: "warning" },
      { label: "处理人工确认", count: approvals.filter((approval) => approval.status === "pending").length, href: `/agents?space=${encodeURIComponent(input.spaceKey ?? "all")}#approvals`, tone: "warning" },
    ],
  };
}

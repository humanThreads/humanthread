import type { getTaskCollection } from "../../../lib/tasks/task-read-model";
import type { ProjectHubView } from "../../../lib/workbench/workbench-projects";

export type ProjectRoadmap = ProjectHubView["roadmap"];
export type ProjectRoadmapStage = ProjectRoadmap[number];
export type ProjectRoadmapMilestone = ProjectRoadmapStage["milestones"][number];
export type ProjectTaskSummary = Pick<Awaited<ReturnType<typeof getTaskCollection>>["listRows"][number], "id" | "title" | "statusCategory" | "status" | "dueAt" | "overdue" | "version" | "assignee" | "blocker">;

export function roadmapTaskIds(roadmap: ProjectRoadmap): Set<string> {
  return new Set(roadmap.flatMap((stage) => stage.milestones.flatMap((milestone) => milestone.tasks.map((task) => task.id))));
}
export function unassignedProjectTasks(roadmap: ProjectRoadmap, projectTasks: ProjectTaskSummary[]): ProjectTaskSummary[] {
  const assignedIds = roadmapTaskIds(roadmap);
  return projectTasks.filter((task) => !assignedIds.has(task.id));
}

export function progressPercent(completed: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round(completed / total * 100)));
}

export function roadmapStatusLabel(status: string): string {
  return {
    planned: "计划中",
    active: "进行中",
    at_risk: "有风险",
    completed: "已完成",
    cancelled: "已取消",
    backlog: "待规划",
    todo: "待处理",
    in_progress: "进行中",
    in_review: "待验收",
    published: "已发布",
    releasable: "可发版",
  }[status] ?? status;
}

export function roadmapStatusTone(status: string): "default" | "success" | "warning" | "danger" | "blue" {
  if (status === "completed") return "success";
  if (status === "at_risk") return "warning";
  if (status === "cancelled") return "danger";
  if (status === "active") return "blue";
  if (status === "published") return "success";
  return "default";
}

export function roadmapProgressTone(status: string): "neutral" | "blue" | "warning" | "success" | "danger" {
  if (status === "completed") return "success";
  if (status === "at_risk") return "warning";
  if (status === "cancelled") return "danger";
  if (status === "active") return "blue";
  return "neutral";
}

export function taskProgressTone(tasks: ProjectTaskSummary[]): "neutral" | "blue" | "warning" | "success" | "danger" {
  if (tasks.some((task) => task.blocker)) return "danger";
  if (tasks.some((task) => task.overdue)) return "warning";
  if (tasks.length > 0 && tasks.every((task) => task.statusCategory === "completed")) return "success";
  if (tasks.length > 0) return "blue";
  return "neutral";
}

export function taskProgress(tasks: ProjectTaskSummary[]): { completed: number; total: number; percent: number } {
  const completed = tasks.filter((task) => task.statusCategory === "completed").length;
  return { completed, total: tasks.length, percent: progressPercent(completed, tasks.length) };
}

export function taskHref(_projectId: string, taskId: string): string {
  return `/tasks/${encodeURIComponent(taskId)}`;
}

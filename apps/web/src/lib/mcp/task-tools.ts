import { randomUUID } from "node:crypto";
import {
  addUserTaskBlocker,
  addUserTaskComment,
  addUserTaskLabel,
  addUserTaskMember,
  archiveUserTask,
  assignUserTask,
  changeUserTaskStatus,
  createUserTaskReminder,
  createUserTask,
  dispatchUserTaskToAgent,
  rejectUserTask,
  removeUserTaskLabel,
  removeUserTaskMember,
  removeUserTaskReminder,
  resolveUserTaskBlocker,
  restoreUserTask,
  updateUserTaskContent,
  updateUserTaskFields,
  updateUserTaskSchedule,
} from "../tasks/task-commands";
import { submitTaskAcceptanceEvidence } from "../tasks/task-acceptance-evidence";
import { assignTaskBranch } from "../tasks/task-branch-command";
import type { TaskAcceptanceEvidenceStatus } from "@humanthread/orchestration-core";
import { getTaskCollection, getTaskDetailView } from "../tasks/task-read-model";
import { parseTaskQuery } from "../tasks/task-query";
import { listTaskLabelDefinitions } from "../tasks/task-settings";
import { listTaskAgentProfiles } from "../orchestration/agent-read-model";

const taskKeyGuide = {
  taskId: "tasks[].id",
  shortId: "tasks[].shortId",
  expectedVersion: "tasks[].version",
  projectId: "tasks[].project.id",
  startAt: "tasks[].startAt",
  dueAt: "tasks[].dueAt",
};

type Dependencies = Partial<{
  getTaskCollection: typeof getTaskCollection;
  getTaskDetailView: typeof getTaskDetailView;
  createUserTask: typeof createUserTask;
  updateUserTaskContent: typeof updateUserTaskContent;
  addUserTaskComment: typeof addUserTaskComment;
  changeUserTaskStatus: typeof changeUserTaskStatus;
  rejectUserTask: typeof rejectUserTask;
  dispatchUserTaskToAgent: typeof dispatchUserTaskToAgent;
  submitTaskAcceptanceEvidence: typeof submitTaskAcceptanceEvidence;
  updateUserTaskFields: typeof updateUserTaskFields;
  updateUserTaskSchedule: typeof updateUserTaskSchedule;
  assignUserTask: typeof assignUserTask;
  addUserTaskMember: typeof addUserTaskMember;
  removeUserTaskMember: typeof removeUserTaskMember;
  addUserTaskBlocker: typeof addUserTaskBlocker;
  resolveUserTaskBlocker: typeof resolveUserTaskBlocker;
  archiveUserTask: typeof archiveUserTask;
  restoreUserTask: typeof restoreUserTask;
  createUserTaskReminder: typeof createUserTaskReminder;
  removeUserTaskReminder: typeof removeUserTaskReminder;
  addUserTaskLabel: typeof addUserTaskLabel;
  removeUserTaskLabel: typeof removeUserTaskLabel;
  listTaskLabelDefinitions: typeof listTaskLabelDefinitions;
  listTaskAgentProfiles: typeof listTaskAgentProfiles;
  assignTaskBranch: typeof assignTaskBranch;
}>;

type TaskMutationArguments = {
  taskId?: string;
  shortId?: string;
  commandId?: string;
  expectedVersion: number;
};

async function resolveTaskMutationTarget(
  input: TaskMutationArguments & { actorUserId: string },
  dependencies: Pick<Required<Dependencies>, "getTaskDetailView">,
) {
  if (Boolean(input.taskId) === Boolean(input.shortId)) {
    throw Object.assign(new Error("Provide exactly one of taskId or shortId"), { code: "validation_failed" });
  }
  if (input.taskId) {
    return {
      taskId: input.taskId,
      expectedVersion: input.expectedVersion,
      commandId: input.commandId ?? randomUUID(),
    };
  }
  const shortId = input.shortId;
  if (!shortId) {
    throw Object.assign(new Error("Provide exactly one of taskId or shortId"), { code: "validation_failed" });
  }
  const detail = await dependencies.getTaskDetailView({ userId: input.actorUserId, shortId });
  if (!detail?.task?.id) {
    throw Object.assign(new Error("Task not found"), { code: "task_not_found" });
  }
  return {
    taskId: detail.task.id,
    expectedVersion: input.expectedVersion,
    commandId: input.commandId ?? randomUUID(),
  };
}

export type McpTaskToolRequest =
  | { tool: "list_tasks"; actorUserId: string; arguments: { spaceId?: string; search?: string; relation?: string; status?: string[]; assignee?: string[]; priority?: number[]; project?: string[]; dateFrom?: string; dateTo?: string; group?: string; sort?: string; view?: string; shortId?: string; timeZone?: string } }
  | { tool: "list_task_labels"; actorUserId: string; arguments: { spaceId: string } }
  | { tool: "list_task_agent_profiles"; actorUserId: string; arguments: { taskId: string } }
  | { tool: "get_task"; actorUserId: string; arguments: { taskId?: string; shortId?: string } }
  | { tool: "create_task"; actorUserId: string; arguments: { commandId: string; spaceId: string; title: string; contentMarkdown?: string; projectId?: string; milestoneId?: string; assigneeUserId?: string; visibility?: "private" | "project" | "company"; priority?: number; startAt?: string; dueAt?: string; recurrenceRule?: string | null; loopBinding?: { bindingId: string; bindingType: "task" | "project" } | null; acceptanceMode?: "none" | "human" | "automated" | "hybrid"; requiredChecks?: string[]; customFields?: Record<string, unknown> } }
  | { tool: "update_task"; actorUserId: string; arguments: TaskMutationArguments & { title?: string; contentMarkdown?: string; priority?: number; projectId?: string | null; customFields?: Record<string, unknown>; startAt?: string | null; dueAt?: string | null; recurrenceRule?: string | null; loopBinding?: { bindingId: string; bindingType: "task" | "project" } | null } }
  | { tool: "add_task_comment"; actorUserId: string; arguments: { commandId: string; taskId: string; expectedVersion: number; contentMarkdown: string } }
  | { tool: "change_task_status"; actorUserId: string; arguments: { commandId: string; taskId: string; expectedVersion: number; command: "move_to_todo" | "start" | "complete" | "submit_for_review" | "accept" | "reject" | "cancel" | "reopen"; reason?: string } }
  | { tool: "cancel_task"; actorUserId: string; arguments: TaskMutationArguments & { reason?: string } }
  | { tool: "update_task_schedule"; actorUserId: string; arguments: TaskMutationArguments & { startAt?: string | null; dueAt?: string | null; recurrenceRule?: string | null; loopBinding?: { bindingId: string; bindingType: "task" | "project" } | null } }
  | { tool: "assign_task"; actorUserId: string; arguments: { commandId: string; taskId: string; expectedVersion: number; assigneeUserId: string } }
  | { tool: "manage_task_member"; actorUserId: string; arguments: { commandId: string; taskId: string; expectedVersion: number; action: "add" | "remove"; userId: string; role?: "participant" | "follower" | undefined } }
  | { tool: "manage_task_blocker"; actorUserId: string; arguments: { commandId: string; taskId: string; expectedVersion: number; action: "add" | "resolve"; reason?: string | undefined; ownerUserId?: string | undefined; blockerId?: string | undefined } }
  | { tool: "set_task_archived"; actorUserId: string; arguments: { commandId: string; taskId: string; expectedVersion: number; archived: boolean } }
  | { tool: "manage_task_reminder"; actorUserId: string; arguments: { commandId: string; taskId: string; expectedVersion: number; action: "create" | "remove"; remindAt?: string | undefined; reminderId?: string | undefined } }
  | { tool: "manage_task_label"; actorUserId: string; arguments: { commandId: string; taskId: string; expectedVersion: number; action: "add" | "remove"; labelId: string } }
  | { tool: "submit_task_acceptance_evidence"; actorUserId: string; arguments: { commandId: string; taskId: string; expectedVersion: number; checkKey: string; status: TaskAcceptanceEvidenceStatus; summary: string; evidenceMarkdown?: string; startedAt?: Date; finishedAt?: Date } }
  | { tool: "dispatch_task_to_agent"; actorUserId: string; arguments: { commandId: string; taskId: string; expectedVersion: number; agentProfileId: string } }
  | { tool: "assign_task_branch"; actorUserId: string; arguments: { commandId: string; taskId: string; expectedVersion: number } };

export async function dispatchMcpTaskTool(request: McpTaskToolRequest, overrides: Dependencies = {}) {
  const dependencies = {
    getTaskCollection, getTaskDetailView, createUserTask, updateUserTaskContent,
    addUserTaskComment, changeUserTaskStatus, rejectUserTask, dispatchUserTaskToAgent,
    submitTaskAcceptanceEvidence, updateUserTaskFields, updateUserTaskSchedule, assignTaskBranch,
    assignUserTask, addUserTaskMember, removeUserTaskMember, addUserTaskBlocker,
    resolveUserTaskBlocker, archiveUserTask, restoreUserTask, createUserTaskReminder,
    removeUserTaskReminder, addUserTaskLabel, removeUserTaskLabel,
    listTaskLabelDefinitions,
    listTaskAgentProfiles,
    ...overrides,
  };
  const actor = { type: "user" as const, id: request.actorUserId };
  switch (request.tool) {
    case "list_tasks": {
      const collection = await dependencies.getTaskCollection({
        userId: request.actorUserId,
        ...(request.arguments.spaceId ? { spaceId: request.arguments.spaceId } : {}),
        query: parseTaskQuery({
          ...(request.arguments.search ? { search: request.arguments.search } : {}),
          ...(request.arguments.relation ? { relation: request.arguments.relation } : {}),
          ...(request.arguments.status ? { status: request.arguments.status } : {}),
          ...(request.arguments.assignee ? { assignee: request.arguments.assignee } : {}),
          ...(request.arguments.priority ? { priority: request.arguments.priority.map(String) } : {}),
          ...(request.arguments.project ? { project: request.arguments.project } : {}),
          ...(request.arguments.dateFrom ? { dateFrom: request.arguments.dateFrom } : {}),
          ...(request.arguments.dateTo ? { dateTo: request.arguments.dateTo } : {}),
          ...(request.arguments.group ? { group: request.arguments.group } : {}),
          ...(request.arguments.sort ? { sort: request.arguments.sort } : {}),
          ...(request.arguments.view ? { view: request.arguments.view } : {}),
          ...(request.arguments.shortId ? { shortId: request.arguments.shortId } : {}),
        }),
        timeZone: request.arguments.timeZone ?? "Asia/Shanghai",
      });
      return { tasks: collection.listRows, total: collection.total, keyGuide: taskKeyGuide };
    }
    case "list_task_labels":
      return {
        labels: await dependencies.listTaskLabelDefinitions({ userId: request.actorUserId, spaceId: request.arguments.spaceId }),
        keyGuide: { labelId: "labels[].id" },
      };
    case "list_task_agent_profiles":
      return {
        agentProfiles: await dependencies.listTaskAgentProfiles({ userId: request.actorUserId, taskId: request.arguments.taskId }),
        keyGuide: { agentProfileId: "agentProfiles[].id" },
      };
    case "get_task": {
      if (Boolean(request.arguments.taskId) === Boolean(request.arguments.shortId)) {
        throw Object.assign(new Error("Provide exactly one of taskId or shortId"), { code: "validation_failed" });
      }
      const detail = await dependencies.getTaskDetailView({
        userId: request.actorUserId,
        ...(request.arguments.taskId ? { taskId: request.arguments.taskId } : {}),
        ...(request.arguments.shortId ? { shortId: request.arguments.shortId } : {}),
      });
      if (!detail) throw Object.assign(new Error("Task not found"), { code: "task_not_found" });
      return {
        detail,
        keyGuide: {
          taskId: "detail.task.id",
          shortId: "detail.task.shortId",
          expectedVersion: "detail.task.version",
          projectId: "detail.task.project.id",
          assigneeUserId: "detail.task.assignee.id",
          memberUserId: "detail.task.members[].user.id",
          blockerId: "detail.task.blockers[].id",
          reminderId: "detail.task.reminders[].id",
          labelId: "detail.task.labelAssignments[].label.id",
          commentId: "detail.task.comments[].id",
          attachmentId: "detail.task.attachments[].id",
          childTaskId: "detail.task.childTasks[].id",
          predecessorDependencyId: "detail.task.predecessorDependencies[].id",
          successorDependencyId: "detail.task.successorDependencies[].id",
          documentId: "detail.task.documentLinks[].document.id",
          agentRunId: "detail.task.agentRuns[].id",
          loopRunId: "detail.task.loopRuns[].id",
          startAt: "detail.task.startAt",
          dueAt: "detail.task.dueAt",
        },
      };
    }
    case "create_task": {
      const result = await dependencies.createUserTask({
        actor, commandId: request.arguments.commandId,
        correlationId: `mcp:task:create:${request.arguments.commandId}`,
        payload: {
          spaceId: request.arguments.spaceId, title: request.arguments.title,
          ...(request.arguments.contentMarkdown !== undefined ? { contentMarkdown: request.arguments.contentMarkdown } : {}),
          ...(request.arguments.projectId ? { projectId: request.arguments.projectId } : {}),
          ...(request.arguments.milestoneId ? { milestoneId: request.arguments.milestoneId } : {}),
          ...(request.arguments.assigneeUserId ? { assigneeUserId: request.arguments.assigneeUserId } : {}),
          ...(request.arguments.visibility ? { visibility: request.arguments.visibility } : {}),
          ...(request.arguments.priority !== undefined ? { priority: request.arguments.priority } : {}),
          ...(request.arguments.startAt ? { startAt: new Date(request.arguments.startAt) } : {}),
          ...(request.arguments.dueAt ? { dueAt: new Date(request.arguments.dueAt) } : {}),
          ...(request.arguments.recurrenceRule !== undefined ? { recurrenceRule: request.arguments.recurrenceRule } : {}),
          ...(request.arguments.loopBinding !== undefined ? { loopBinding: request.arguments.loopBinding } : {}),
          ...(request.arguments.acceptanceMode ? { acceptanceMode: request.arguments.acceptanceMode } : {}),
          ...(request.arguments.requiredChecks ? { acceptancePolicy: { requiredChecks: request.arguments.requiredChecks } } : {}),
          ...(request.arguments.customFields ? { customFields: request.arguments.customFields } : {}),
        },
      });
      return { result };
    }
    case "update_task": {
      const target = await resolveTaskMutationTarget({ ...request.arguments, actorUserId: request.actorUserId }, dependencies);
      const usesFieldCommand = request.arguments.title !== undefined
        || request.arguments.priority !== undefined
        || request.arguments.projectId !== undefined
        || request.arguments.customFields !== undefined;
      const usesScheduleCommand = request.arguments.startAt !== undefined || request.arguments.dueAt !== undefined || request.arguments.recurrenceRule !== undefined || request.arguments.loopBinding !== undefined;
      if (request.arguments.contentMarkdown === undefined && !usesFieldCommand && !usesScheduleCommand) {
        throw Object.assign(new Error("At least one Task field is required"), { code: "validation_failed" });
      }
      if (usesScheduleCommand && (request.arguments.contentMarkdown !== undefined || usesFieldCommand)) {
        throw Object.assign(new Error("Schedule fields cannot be combined with other Task fields"), { code: "validation_failed" });
      }
      if (usesScheduleCommand) {
        const result = await dependencies.updateUserTaskSchedule({
          actor,
          commandId: target.commandId,
          correlationId: `mcp:task:${target.taskId}`,
          taskId: target.taskId,
          expectedVersion: target.expectedVersion,
          ...(request.arguments.startAt !== undefined ? { startAt: request.arguments.startAt ? new Date(request.arguments.startAt) : null } : {}),
          ...(request.arguments.dueAt !== undefined ? { dueAt: request.arguments.dueAt ? new Date(request.arguments.dueAt) : null } : {}),
          ...(request.arguments.recurrenceRule !== undefined ? { recurrenceRule: request.arguments.recurrenceRule } : {}),
          ...(request.arguments.loopBinding !== undefined ? { loopBinding: request.arguments.loopBinding } : {}),
        });
        return { result };
      }
      const result = usesFieldCommand
        ? await dependencies.updateUserTaskFields({
            actor, commandId: target.commandId, correlationId: `mcp:task:${target.taskId}`,
            taskId: target.taskId, expectedVersion: target.expectedVersion,
            ...(request.arguments.title !== undefined ? { title: request.arguments.title } : {}),
            ...(request.arguments.contentMarkdown !== undefined ? { contentMarkdown: request.arguments.contentMarkdown } : {}),
            ...(request.arguments.priority !== undefined ? { priority: request.arguments.priority } : {}),
            ...(request.arguments.projectId !== undefined ? { projectId: request.arguments.projectId } : {}),
            ...(request.arguments.customFields !== undefined ? { customFields: request.arguments.customFields } : {}),
          })
        : await dependencies.updateUserTaskContent({
            actor, commandId: target.commandId, correlationId: `mcp:task:${target.taskId}`,
            taskId: target.taskId, expectedVersion: target.expectedVersion,
            contentMarkdown: request.arguments.contentMarkdown!,
          });
      return { result };
    }
    case "add_task_comment": {
      const result = await dependencies.addUserTaskComment({
        actor, commandId: request.arguments.commandId, correlationId: `mcp:task:${request.arguments.taskId}`,
        taskId: request.arguments.taskId, expectedVersion: request.arguments.expectedVersion,
        contentMarkdown: request.arguments.contentMarkdown,
      });
      return { result };
    }
    case "assign_task": {
      const result = await dependencies.assignUserTask({
        actor, commandId: request.arguments.commandId, correlationId: `mcp:task:${request.arguments.taskId}`,
        taskId: request.arguments.taskId, expectedVersion: request.arguments.expectedVersion,
        assigneeUserId: request.arguments.assigneeUserId,
      });
      return { result };
    }
    case "manage_task_member": {
      if (request.arguments.action === "add" && !request.arguments.role) {
        throw Object.assign(new Error("role is required when adding a Task member"), { code: "validation_failed" });
      }
      const common = {
        actor, commandId: request.arguments.commandId, correlationId: `mcp:task:${request.arguments.taskId}`,
        taskId: request.arguments.taskId, expectedVersion: request.arguments.expectedVersion,
        userId: request.arguments.userId,
      };
      const result = request.arguments.action === "add"
        ? await dependencies.addUserTaskMember({ ...common, role: request.arguments.role! })
        : await dependencies.removeUserTaskMember(common);
      return { result };
    }
    case "manage_task_blocker": {
      const common = {
        actor, commandId: request.arguments.commandId, correlationId: `mcp:task:${request.arguments.taskId}`,
        taskId: request.arguments.taskId, expectedVersion: request.arguments.expectedVersion,
      };
      if (request.arguments.action === "add") {
        if (!request.arguments.reason?.trim()) throw Object.assign(new Error("reason is required when adding a blocker"), { code: "validation_failed" });
        return { result: await dependencies.addUserTaskBlocker({
          ...common,
          reason: request.arguments.reason,
          ...(request.arguments.ownerUserId ? { ownerUserId: request.arguments.ownerUserId } : {}),
        }) };
      }
      if (!request.arguments.blockerId) throw Object.assign(new Error("blockerId is required when resolving a blocker"), { code: "validation_failed" });
      return { result: await dependencies.resolveUserTaskBlocker({ ...common, blockerId: request.arguments.blockerId }) };
    }
    case "set_task_archived": {
      const command = request.arguments.archived ? dependencies.archiveUserTask : dependencies.restoreUserTask;
      const result = await command({
        actor, commandId: request.arguments.commandId, correlationId: `mcp:task:${request.arguments.taskId}`,
        taskId: request.arguments.taskId, expectedVersion: request.arguments.expectedVersion,
      });
      return { result };
    }
    case "manage_task_reminder": {
      const common = {
        actor, commandId: request.arguments.commandId, correlationId: `mcp:task:${request.arguments.taskId}`,
        taskId: request.arguments.taskId, expectedVersion: request.arguments.expectedVersion,
      };
      if (request.arguments.action === "create") {
        if (!request.arguments.remindAt) throw Object.assign(new Error("remindAt is required when creating a reminder"), { code: "validation_failed" });
        return { result: await dependencies.createUserTaskReminder({ ...common, remindAt: new Date(request.arguments.remindAt) }) };
      }
      if (!request.arguments.reminderId) throw Object.assign(new Error("reminderId is required when removing a reminder"), { code: "validation_failed" });
      return { result: await dependencies.removeUserTaskReminder({ ...common, reminderId: request.arguments.reminderId }) };
    }
    case "manage_task_label": {
      const command = request.arguments.action === "add" ? dependencies.addUserTaskLabel : dependencies.removeUserTaskLabel;
      const result = await command({
        actor, commandId: request.arguments.commandId, correlationId: `mcp:task:${request.arguments.taskId}`,
        taskId: request.arguments.taskId, expectedVersion: request.arguments.expectedVersion,
        labelId: request.arguments.labelId,
      });
      return { result };
    }
    case "change_task_status": {
      const common = {
        actor, commandId: request.arguments.commandId, correlationId: `mcp:task:${request.arguments.taskId}`,
        taskId: request.arguments.taskId, expectedVersion: request.arguments.expectedVersion,
      };
      const result = request.arguments.command === "reject"
        ? await dependencies.rejectUserTask({ ...common, reason: request.arguments.reason ?? "" })
        : await dependencies.changeUserTaskStatus({
            ...common, command: request.arguments.command,
          });
      return { result };
    }
    case "cancel_task": {
      const target = await resolveTaskMutationTarget({ ...request.arguments, actorUserId: request.actorUserId }, dependencies);
      const result = await dependencies.changeUserTaskStatus({
        actor,
        commandId: target.commandId,
        correlationId: `mcp:task:${target.taskId}`,
        taskId: target.taskId,
        expectedVersion: target.expectedVersion,
        command: "cancel",
        ...(request.arguments.reason !== undefined ? { reason: request.arguments.reason } : {}),
      });
      return { result };
    }
    case "update_task_schedule": {
      const target = await resolveTaskMutationTarget({ ...request.arguments, actorUserId: request.actorUserId }, dependencies);
      if (request.arguments.startAt === undefined && request.arguments.dueAt === undefined && request.arguments.recurrenceRule === undefined && request.arguments.loopBinding === undefined) {
        throw Object.assign(new Error("startAt or dueAt is required"), { code: "validation_failed" });
      }
      const result = await dependencies.updateUserTaskSchedule({
        actor,
        commandId: target.commandId,
        correlationId: `mcp:task:${target.taskId}`,
        taskId: target.taskId,
        expectedVersion: target.expectedVersion,
        ...(request.arguments.startAt !== undefined ? { startAt: request.arguments.startAt ? new Date(request.arguments.startAt) : null } : {}),
        ...(request.arguments.dueAt !== undefined ? { dueAt: request.arguments.dueAt ? new Date(request.arguments.dueAt) : null } : {}),
        ...(request.arguments.recurrenceRule !== undefined ? { recurrenceRule: request.arguments.recurrenceRule } : {}),
        ...(request.arguments.loopBinding !== undefined ? { loopBinding: request.arguments.loopBinding } : {}),
      });
      return { result };
    }
    case "submit_task_acceptance_evidence": {
      const result = await dependencies.submitTaskAcceptanceEvidence({
        actor,
        source: "mcp",
        commandId: request.arguments.commandId,
        correlationId: `mcp:task:${request.arguments.taskId}`,
        taskId: request.arguments.taskId,
        expectedVersion: request.arguments.expectedVersion,
        checkKey: request.arguments.checkKey,
        status: request.arguments.status,
        summary: request.arguments.summary,
        ...(request.arguments.evidenceMarkdown !== undefined ? { evidenceMarkdown: request.arguments.evidenceMarkdown } : {}),
        ...(request.arguments.startedAt !== undefined ? { startedAt: request.arguments.startedAt } : {}),
        ...(request.arguments.finishedAt !== undefined ? { finishedAt: request.arguments.finishedAt } : {}),
      });
      return { result };
    }
    case "dispatch_task_to_agent": {
      const result = await dependencies.dispatchUserTaskToAgent({
        actor, commandId: request.arguments.commandId, correlationId: `mcp:task:${request.arguments.taskId}`,
        taskId: request.arguments.taskId, expectedVersion: request.arguments.expectedVersion,
        agentProfileId: request.arguments.agentProfileId,
      });
      return { result };
    }
    case "assign_task_branch": {
      const result = await dependencies.assignTaskBranch({
        actor,
        commandId: request.arguments.commandId,
        correlationId: `mcp:task:${request.arguments.taskId}`,
        taskId: request.arguments.taskId,
        expectedVersion: request.arguments.expectedVersion,
      });
      return { result };
    }
  }
}

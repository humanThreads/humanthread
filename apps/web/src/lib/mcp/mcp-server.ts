import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  assertCanReadKnowledgeBatch,
  assertCanReadProject,
  assertCanWriteProject,
  getKnowledgeBatchProjection,
  getWorkflowInteraction,
  prepareKnowledgeJobForSubmission,
  readKnowledgeJobAccess,
  resolveProjectEnvironmentSecrets,
  submitKnowledgeBatchForIngestion,
} from "@humanthread/db";
import {
  KNOWLEDGE_BATCH_ITEM_LIMIT,
  KNOWLEDGE_ENTRY_TYPES,
} from "@humanthread/shared";
import { encryptMcpSecretEnvelope } from "./mcp-auth";
import { z } from "zod";
import {
  appendWorkbenchDocument,
  createWorkbenchDocument,
  createWorkbenchSpaceDocument,
  getWorkbenchDocument,
  listWorkbenchDocumentTargetTree,
  listProjectDocuments,
  listSpaceDocuments,
  searchWorkbenchDocuments,
  moveWorkbenchDocument,
  updateWorkbenchDocument,
} from "../workbench/workbench-documents";
import { saveWorkbenchDocumentAttachment } from "../workbench/workbench-document-attachments";
import { createDocumentAttachmentFile } from "./document-attachment-codec";
import { listWorkbenchSpaces } from "../workbench/workbench-spaces";
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
import {
  deleteTaskSavedView,
  getTaskCollection,
  getTaskDetailView,
  listTaskSavedViews,
  saveTaskView,
  updateTaskSavedView,
} from "../tasks/task-read-model";
import {
  createTaskLabelDefinition,
  createTaskStatusDefinition,
  deleteTaskLabelDefinition,
  deleteTaskStatusDefinition,
  listTaskLabelDefinitions,
  listTaskStatusDefinitions,
} from "../tasks/task-settings";
import { listTaskAgentProfiles } from "../orchestration/agent-read-model";
import { activateProject, pauseProject, resumeProject, submitProjectPlan } from "../orchestration/project-commands";
import { commandProjectRoadmap, type ProjectRoadmapAction } from "../orchestration/project-roadmap-commands";
import { createWorkbenchProject, updateWorkbenchProject } from "../workbench/workbench-project-commands";
import { deleteProjectTaskField, listProjectTaskFields, upsertProjectTaskField } from "../workbench/project-task-fields";
import { getProjectMemberView } from "../workbench/workbench-project-members";
import { getProjectHubView, getProjectListItems } from "../workbench/workbench-projects";
import {
  appendRequirementMessage,
  confirmRequirement,
  openRequirementConversation,
  requestRuntimeIntervention,
} from "../orchestration/workflow-interaction-commands";
import { dispatchMcpTaskTool } from "./task-tools";
import { dispatchMcpProjectFieldTool } from "./project-field-tools";
import { dispatchMcpProjectTool } from "./project-tools";
import { dispatchMcpTaskSettingsTool } from "./task-settings-tools";
import { dispatchMcpTaskViewTool } from "./task-view-tools";
import { dispatchMcpKnowledgeTool, type McpKnowledgeToolRequest } from "./knowledge-tools";
import {
  dispatchMcpWorkflowInteractionTool,
  resolveActiveAttemptIdentity,
} from "./workflow-interaction-tools";

interface HumanThreadMcpDependencies {
  listWorkbenchSpaces: typeof listWorkbenchSpaces;
  listProjectDocuments: typeof listProjectDocuments;
  listSpaceDocuments: typeof listSpaceDocuments;
  searchWorkbenchDocuments: typeof searchWorkbenchDocuments;
  getWorkbenchDocument: typeof getWorkbenchDocument;
  createWorkbenchDocument: typeof createWorkbenchDocument;
  createWorkbenchSpaceDocument: typeof createWorkbenchSpaceDocument;
  updateWorkbenchDocument: typeof updateWorkbenchDocument;
  appendWorkbenchDocument: typeof appendWorkbenchDocument;
  listWorkbenchDocumentTargetTree: typeof listWorkbenchDocumentTargetTree;
  moveWorkbenchDocument: typeof moveWorkbenchDocument;
  saveWorkbenchDocumentAttachment: typeof saveWorkbenchDocumentAttachment;
  getTaskCollection: typeof getTaskCollection;
  getTaskDetailView: typeof getTaskDetailView;
  createUserTask: typeof createUserTask;
  updateUserTaskContent: typeof updateUserTaskContent;
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
  createTaskLabelDefinition: typeof createTaskLabelDefinition;
  deleteTaskLabelDefinition: typeof deleteTaskLabelDefinition;
  listTaskStatusDefinitions: typeof listTaskStatusDefinitions;
  createTaskStatusDefinition: typeof createTaskStatusDefinition;
  deleteTaskStatusDefinition: typeof deleteTaskStatusDefinition;
  listTaskSavedViews: typeof listTaskSavedViews;
  saveTaskView: typeof saveTaskView;
  updateTaskSavedView: typeof updateTaskSavedView;
  deleteTaskSavedView: typeof deleteTaskSavedView;
  listProjectTaskFields: typeof listProjectTaskFields;
  upsertProjectTaskField: typeof upsertProjectTaskField;
  deleteProjectTaskField: typeof deleteProjectTaskField;
  addUserTaskComment: typeof addUserTaskComment;
  changeUserTaskStatus: typeof changeUserTaskStatus;
  rejectUserTask: typeof rejectUserTask;
  dispatchUserTaskToAgent: typeof dispatchUserTaskToAgent;
  submitTaskAcceptanceEvidence: typeof submitTaskAcceptanceEvidence;
  assignTaskBranch: typeof assignTaskBranch;
  getProjectListItems: typeof getProjectListItems;
  getProjectHubView: typeof getProjectHubView;
  getProjectMemberView: typeof getProjectMemberView;
  createWorkbenchProject: typeof createWorkbenchProject;
  updateWorkbenchProject: typeof updateWorkbenchProject;
  submitProjectPlan: typeof submitProjectPlan;
  commandProjectRoadmap: typeof commandProjectRoadmap;
  activateProject: typeof activateProject;
  pauseProject: typeof pauseProject;
  resumeProject: typeof resumeProject;
  openRequirementConversation: typeof openRequirementConversation;
  appendRequirementMessage: typeof appendRequirementMessage;
  confirmRequirement: typeof confirmRequirement;
  requestRuntimeIntervention: typeof requestRuntimeIntervention;
  getWorkflowInteraction: typeof getWorkflowInteraction;
  assertCanReadProject: typeof assertCanReadProject;
  assertCanWriteProject: typeof assertCanWriteProject;
  assertCanReadKnowledgeBatch: typeof assertCanReadKnowledgeBatch;
  readKnowledgeJobAccess: typeof readKnowledgeJobAccess;
  prepareKnowledgeJobForSubmission: typeof prepareKnowledgeJobForSubmission;
  submitKnowledgeBatchForIngestion: typeof submitKnowledgeBatchForIngestion;
  getKnowledgeBatchProjection: typeof getKnowledgeBatchProjection;
  resolveProjectEnvironmentSecrets: typeof resolveProjectEnvironmentSecrets;
  resolveActiveAttemptIdentity: typeof resolveActiveAttemptIdentity;
}

const DEFAULT_DEPENDENCIES: HumanThreadMcpDependencies = {
  listWorkbenchSpaces,
  listProjectDocuments,
  listSpaceDocuments,
  searchWorkbenchDocuments,
  getWorkbenchDocument,
  createWorkbenchDocument,
  createWorkbenchSpaceDocument,
  updateWorkbenchDocument,
  appendWorkbenchDocument,
  listWorkbenchDocumentTargetTree,
  moveWorkbenchDocument,
  saveWorkbenchDocumentAttachment,
  getTaskCollection,
  getTaskDetailView,
  createUserTask,
  updateUserTaskContent,
  updateUserTaskFields,
  updateUserTaskSchedule,
  assignUserTask,
  addUserTaskMember,
  removeUserTaskMember,
  addUserTaskBlocker,
  resolveUserTaskBlocker,
  archiveUserTask,
  restoreUserTask,
  createUserTaskReminder,
  removeUserTaskReminder,
  addUserTaskLabel,
  removeUserTaskLabel,
  listTaskLabelDefinitions,
  listTaskAgentProfiles,
  createTaskLabelDefinition,
  deleteTaskLabelDefinition,
  listTaskStatusDefinitions,
  createTaskStatusDefinition,
  deleteTaskStatusDefinition,
  listTaskSavedViews,
  saveTaskView,
  updateTaskSavedView,
  deleteTaskSavedView,
  listProjectTaskFields,
  upsertProjectTaskField,
  deleteProjectTaskField,
  addUserTaskComment,
  changeUserTaskStatus,
  rejectUserTask,
  dispatchUserTaskToAgent,
  submitTaskAcceptanceEvidence,
  assignTaskBranch,
  getProjectListItems,
  getProjectHubView,
  getProjectMemberView,
  createWorkbenchProject,
  updateWorkbenchProject,
  submitProjectPlan,
  commandProjectRoadmap,
  activateProject,
  pauseProject,
  resumeProject,
  openRequirementConversation,
  appendRequirementMessage,
  confirmRequirement,
  requestRuntimeIntervention,
  getWorkflowInteraction,
  assertCanReadProject,
  assertCanWriteProject,
  assertCanReadKnowledgeBatch,
  readKnowledgeJobAccess,
  prepareKnowledgeJobForSubmission,
  submitKnowledgeBatchForIngestion,
  getKnowledgeBatchProjection,
  resolveProjectEnvironmentSecrets,
  resolveActiveAttemptIdentity,
};

function jsonSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function toolResult(data: Record<string, unknown>) {
  const structuredContent = jsonSafe(data);

  return {
    content: [{ type: "text" as const, text: JSON.stringify(structuredContent) }],
    structuredContent,
  };
}

const mcpIdSchema = z.string().trim().min(1).max(128);
const mcpVersionSchema = z.number().int().positive();
const mcpDateSchema = z.iso.datetime({ offset: true });
const nullableMcpDateSchema = mcpDateSchema.nullable().optional();
const mcpDigestSchema = z.string().regex(/^[a-f0-9]{32}$/u);
const knowledgeGenerationModeSchema = z.enum([
  "project_initialization",
  "task_completion",
  "scheduled_update",
  "manual_update",
]);
const mcpKnowledgeItemSchema = z.object({
  stableKey: z.string().trim().min(1).max(191),
  changeType: z.enum(["create", "update", "supersede", "expire", "delete"]),
  sourceType: z.string().trim().min(1).max(32),
  entryType: z.enum(KNOWLEDGE_ENTRY_TYPES),
  scope: z.enum(["project", "space"]),
  title: z.string().trim().min(1).max(191),
  summary: z.string().max(20_000),
  bodyMarkdown: z.string().max(2_000_000),
  confidence: z.number().min(0).max(1),
  tags: z.array(z.string().trim().min(1).max(64)).max(50).default([]),
  changeSummary: z.string().trim().max(20_000).optional(),
  baseVersion: z.number().int().positive().nullable().default(null),
  validFrom: mcpDateSchema.nullable().default(null),
  validUntil: mcpDateSchema.nullable().default(null),
  evidence: z.unknown(),
  relations: z.array(z.record(z.string(), z.unknown())).max(200),
}).strict();
const roadmapActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("stage.create"), name: mcpIdSchema, status: z.string().optional(), startAt: nullableMcpDateSchema, targetAt: nullableMcpDateSchema }).strict(),
  z.object({ type: z.literal("stage.update"), stageId: mcpIdSchema, expectedNodeVersion: mcpVersionSchema, name: z.string().optional(), status: z.string().optional(), startAt: nullableMcpDateSchema, targetAt: nullableMcpDateSchema }).strict(),
  z.object({ type: z.literal("stage.reorder"), stageIds: z.array(mcpIdSchema).min(1) }).strict(),
  z.object({ type: z.literal("stage.delete"), stageId: mcpIdSchema, expectedNodeVersion: mcpVersionSchema }).strict(),
  z.object({ type: z.literal("milestone.create"), stageId: mcpIdSchema, name: mcpIdSchema, status: z.string().optional(), targetAt: nullableMcpDateSchema }).strict(),
  z.object({ type: z.literal("milestone.update"), milestoneId: mcpIdSchema, expectedNodeVersion: mcpVersionSchema, name: z.string().optional(), status: z.string().optional(), targetAt: nullableMcpDateSchema, riskSummary: z.string().nullable().optional() }).strict(),
  z.object({ type: z.literal("milestone.reorder"), stageId: mcpIdSchema, milestoneIds: z.array(mcpIdSchema).min(1) }).strict(),
  z.object({ type: z.literal("milestone.delete"), milestoneId: mcpIdSchema, expectedNodeVersion: mcpVersionSchema }).strict(),
  z.object({ type: z.literal("task.move"), taskId: mcpIdSchema, milestoneId: mcpIdSchema.nullable(), expectedTaskVersion: mcpVersionSchema }).strict(),
]);

export function createHumanThreadMcpServer(input: {
  actorUserId: string;
  credentialTransportKey: string;
  dependencies?: Partial<HumanThreadMcpDependencies>;
}) {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...input.dependencies };
  const server = new McpServer({
    name: "humanthread",
    version: "0.1.2",
  });

  server.registerTool(
    "list_spaces",
    {
      description: "List personal and company spaces accessible to the authenticated user.",
      inputSchema: {},
    },
    async () =>
      toolResult({
        spaces: await dependencies.listWorkbenchSpaces({
          userId: input.actorUserId,
        }),
      }),
  );

  const projectDependencies = {
    getProjectListItems: dependencies.getProjectListItems,
    getProjectHubView: dependencies.getProjectHubView,
    getProjectMemberView: dependencies.getProjectMemberView,
    createWorkbenchProject: dependencies.createWorkbenchProject,
    updateWorkbenchProject: dependencies.updateWorkbenchProject,
    submitProjectPlan: dependencies.submitProjectPlan,
    commandProjectRoadmap: dependencies.commandProjectRoadmap,
    activateProject: dependencies.activateProject,
    pauseProject: dependencies.pauseProject,
    resumeProject: dependencies.resumeProject,
  };

  server.registerTool("list_projects", {
    description: "List accessible Projects. Use each project's `id` as projectId and `version` as expectedVersion for mutations.",
    inputSchema: {
      search: z.string().trim().min(1).optional(),
      status: z.string().trim().min(1).optional(),
      health: z.enum(["healthy", "at_risk", "blocked", "complete", "unknown"]).optional(),
      ownerType: z.enum(["company", "personal"]).optional(),
    },
  }, async (arguments_) => toolResult(await dispatchMcpProjectTool({
    tool: "list_projects",
    actorUserId: input.actorUserId,
    arguments: {
      ...(arguments_.search ? { search: arguments_.search } : {}),
      ...(arguments_.status ? { status: arguments_.status } : {}),
      ...(arguments_.health ? { health: arguments_.health } : {}),
      ...(arguments_.ownerType ? { ownerType: arguments_.ownerType } : {}),
    },
  }, projectDependencies)));

  server.registerTool("create_project", {
    description: "Create a Project in an accessible Space. Dates use ISO-8601; the result returns projectId and version.",
    inputSchema: {
      spaceId: mcpIdSchema,
      name: z.string().trim().min(1).max(191),
      shortCode: z.string().trim().min(2).max(12).optional(),
      objective: z.string().trim().min(1).max(10_000),
      managerUserId: mcpIdSchema.optional(),
      startAt: mcpDateSchema.optional(),
      targetAt: mcpDateSchema.optional(),
    },
  }, async (arguments_) => toolResult(await dispatchMcpProjectTool({
    tool: "create_project",
    actorUserId: input.actorUserId,
    arguments: {
      spaceId: arguments_.spaceId,
      name: arguments_.name,
      ...(arguments_.shortCode ? { shortCode: arguments_.shortCode } : {}),
      objective: arguments_.objective,
      ...(arguments_.managerUserId ? { managerUserId: arguments_.managerUserId } : {}),
      ...(arguments_.startAt ? { startAt: arguments_.startAt } : {}),
      ...(arguments_.targetAt ? { targetAt: arguments_.targetAt } : {}),
    },
  }, projectDependencies)));

  server.registerTool("list_project_members", {
    description: "List active Project members. Use `members[].user.id` as managerUserId, assigneeUserId, ownerUserId, or Task member userId.",
    inputSchema: { projectId: mcpIdSchema },
  }, async ({ projectId }) => toolResult(await dispatchMcpProjectTool({
    tool: "list_project_members", actorUserId: input.actorUserId, arguments: { projectId },
  }, projectDependencies)));

  server.registerTool("get_project_roadmap", {
    description: "Read a Project delivery roadmap. Project, Stage, Milestone, and Task objects expose canonical `id` and `version` keys for later mutations.",
    inputSchema: { projectId: mcpIdSchema },
  }, async ({ projectId }) => toolResult(await dispatchMcpProjectTool({
    tool: "get_project_roadmap", actorUserId: input.actorUserId, arguments: { projectId },
  }, projectDependencies)));

  server.registerTool("create_project_roadmap", {
    description: "Submit the initial delivery roadmap for a draft Project. Use projectId and expectedVersion from list_projects/get_project_roadmap; each Stage requires a stable key.",
    inputSchema: {
      commandId: mcpIdSchema,
      projectId: mcpIdSchema,
      expectedVersion: mcpVersionSchema,
      objective: z.string().trim().min(1).max(10_000),
      stages: z.array(z.object({
        key: z.string().trim().min(1).max(96),
        name: z.string().trim().min(1).max(191),
        milestones: z.array(z.object({ name: z.string().trim().min(1).max(191) }).strict()).min(1),
      }).strict()).min(1),
    },
  }, async (arguments_) => toolResult(await dispatchMcpProjectTool({
    tool: "create_project_roadmap", actorUserId: input.actorUserId, arguments: arguments_,
  }, projectDependencies)));

  server.registerTool("update_project_roadmap", {
    description: "Apply one delivery roadmap mutation. Use project expectedVersion plus stageId/milestoneId and their expectedNodeVersion values returned by get_project_roadmap.",
    inputSchema: {
      commandId: mcpIdSchema,
      projectId: mcpIdSchema,
      expectedVersion: mcpVersionSchema,
      action: roadmapActionSchema,
    },
  }, async (arguments_) => toolResult(await dispatchMcpProjectTool({
    tool: "update_project_roadmap", actorUserId: input.actorUserId, arguments: { ...arguments_, action: arguments_.action as ProjectRoadmapAction },
  }, projectDependencies)));

  server.registerTool("update_project", {
    description: "Update the Project short code using projectId and the current Project version.",
    inputSchema: { projectId: mcpIdSchema, expectedVersion: mcpVersionSchema, shortCode: z.string().trim().min(2).max(12) },
  }, async (arguments_) => toolResult(await dispatchMcpProjectTool({
    tool: "update_project", actorUserId: input.actorUserId, arguments: arguments_,
  }, projectDependencies)));

  server.registerTool("change_project_status", {
    description: "Activate, pause, or resume a Project using projectId and its current version.",
    inputSchema: { commandId: mcpIdSchema, projectId: mcpIdSchema, expectedVersion: mcpVersionSchema, command: z.enum(["activate", "pause", "resume"]) },
  }, async (arguments_) => toolResult(await dispatchMcpProjectTool({
    tool: "change_project_status", actorUserId: input.actorUserId, arguments: arguments_,
  }, projectDependencies)));

  server.registerTool("get_project_environment_secrets", {
    description: "按项目权限和变量白名单读取项目环境凭证。仅返回调用方明确请求的变量，禁止读取其他项目或未列出的变量。",
    inputSchema: {
      projectId: mcpIdSchema,
      names: z.array(z.string().trim().min(1).max(191)).min(1).max(100),
    },
  }, async ({ projectId, names }) => {
    const secrets = await dependencies.resolveProjectEnvironmentSecrets({
      projectId,
      names,
      actorUserId: input.actorUserId,
    });
    return toolResult({
      envelope: {
        algorithm: "AES-256-GCM",
        keyDerivation: "SHA-256(humanthread:mcp-envelope:<bearer-token-sha256>)",
        values: Object.fromEntries(Object.entries(secrets).map(([name, value]) => [name, encryptMcpSecretEnvelope(value, input.credentialTransportKey!)])),
      },
    });
  });

  server.registerTool(
    "list_documents",
    {
      description: "List root or project documents in an accessible target.",
      inputSchema: {
        spaceId: z.string().min(1),
        projectId: z.string().min(1).optional(),
      },
    },
    async ({ spaceId, projectId }) =>
      toolResult({
        documents: projectId
          ? await dependencies.listProjectDocuments({
              projectId,
              userId: input.actorUserId,
            })
          : await dependencies.listSpaceDocuments({
              spaceId,
              userId: input.actorUserId,
            }),
      }),
  );

  server.registerTool(
    "list_document_tree",
    {
      description: "List the real directory and document tree for one accessible Space or project target.",
      inputSchema: {
        spaceId: z.string().min(1),
        projectId: z.string().min(1).optional(),
      },
    },
    async ({ spaceId, projectId }) =>
      toolResult({
        tree: await dependencies.listWorkbenchDocumentTargetTree({
          userId: input.actorUserId,
          spaceId,
          ...(projectId ? { projectId } : {}),
        }),
      }),
  );

  server.registerTool(
    "search_documents",
    {
      description: "Search document title, path, and Markdown in one accessible target.",
      inputSchema: {
        spaceId: z.string().min(1),
        projectId: z.string().min(1).optional(),
        query: z.string().min(1),
      },
    },
    async ({ spaceId, projectId, query }) =>
      toolResult({
        documents: await dependencies.searchWorkbenchDocuments({
          userId: input.actorUserId,
          spaceId,
          ...(projectId ? { projectId } : {}),
          query,
        }),
      }),
  );

  server.registerTool(
    "get_document",
    {
      description: "Read one accessible document including Markdown content and version.",
      inputSchema: { documentId: z.string().min(1) },
    },
    async ({ documentId }) =>
      toolResult({
        document: await dependencies.getWorkbenchDocument({
          documentId,
          userId: input.actorUserId,
        }),
      }),
  );

  server.registerTool(
    "create_document",
    {
      description: "Create a root or project Markdown document, resolving parent directories from its target-relative path.",
      inputSchema: {
        spaceId: z.string().min(1),
        projectId: z.string().min(1).optional(),
        title: z.string().min(1),
        path: z.string().min(1),
        contentMarkdown: z.string(),
      },
    },
    async ({ spaceId, projectId, title, path, contentMarkdown }) =>
      toolResult({
        document: projectId
          ? await dependencies.createWorkbenchDocument({
              spaceId,
              projectId,
              userId: input.actorUserId,
              title,
              path,
              contentMarkdown,
              source: "mcp",
            })
          : await dependencies.createWorkbenchSpaceDocument({
              spaceId,
              userId: input.actorUserId,
              title,
              path,
              contentMarkdown,
              source: "mcp",
            }),
      }),
  );

  server.registerTool(
    "move_document",
    {
      description: "Move or rename an accessible document to a target-relative Markdown path without creating a revision.",
      inputSchema: {
        documentId: z.string().min(1),
        targetPath: z.string().min(1),
      },
    },
    async ({ documentId, targetPath }) =>
      toolResult({
        document: await dependencies.moveWorkbenchDocument({
          userId: input.actorUserId,
          documentId,
          targetPath,
          sortOrder: 0,
        }),
      }),
  );

  server.registerTool(
    "update_document",
    {
      description: "Replace document Markdown using expected-version optimistic locking.",
      inputSchema: {
        documentId: z.string().min(1),
        expectedVersion: z.number().int().positive(),
        title: z.string().min(1),
        contentMarkdown: z.string(),
      },
    },
    async ({ documentId, expectedVersion, title, contentMarkdown }) =>
      toolResult({
        document: await dependencies.updateWorkbenchDocument({
          documentId,
          userId: input.actorUserId,
          expectedVersion,
          title,
          contentMarkdown,
          source: "mcp",
        }),
      }),
  );

  server.registerTool(
    "append_document",
    {
      description: "Append Markdown using expected-version optimistic locking.",
      inputSchema: {
        documentId: z.string().min(1),
        expectedVersion: z.number().int().positive(),
        title: z.string().min(1),
        contentMarkdown: z.string(),
      },
    },
    async ({ documentId, expectedVersion, title, contentMarkdown }) =>
      toolResult({
        document: await dependencies.appendWorkbenchDocument({
          documentId,
          userId: input.actorUserId,
          expectedVersion,
          title,
          contentMarkdown,
          source: "mcp",
        }),
      }),
  );

  server.registerTool(
    "upload_document_attachment",
    {
      description: "Upload a binary document attachment from base64 content and return its protected Markdown URL. Use this for diagrams and images that must be embedded into a document.",
      inputSchema: {
        documentId: z.string().min(1),
        fileName: z.string().trim().min(1).max(255),
        mimeType: z.string().trim().min(1).max(191),
        contentBase64: z.string().min(1),
      },
    },
    async ({ documentId, fileName, mimeType, contentBase64 }) =>
      toolResult({
        attachment: await dependencies.saveWorkbenchDocumentAttachment({
          userId: input.actorUserId,
          documentId,
          file: createDocumentAttachmentFile({ fileName, mimeType, contentBase64 }),
        }),
      }),
  );

  server.registerTool(
    "submit_knowledge_batch",
    {
      description: "Submit a platform-validated knowledge candidate batch for one accessible Project Job.",
      inputSchema: {
        projectId: mcpIdSchema,
        jobId: mcpIdSchema,
        submissionId: z.string().trim().min(1).max(191),
        commandId: z.string().trim().min(1).max(128).optional(),
        templateDigest: mcpDigestSchema,
        sourceSnapshot: z.record(z.string(), z.unknown()),
        items: z.array(mcpKnowledgeItemSchema).max(KNOWLEDGE_BATCH_ITEM_LIMIT),
      },
    },
    async (arguments_) => {
      await dependencies.assertCanWriteProject({
        userId: input.actorUserId,
        projectId: arguments_.projectId,
      });
      const job = await dependencies.readKnowledgeJobAccess({
        userId: input.actorUserId,
        projectId: arguments_.projectId,
        jobId: arguments_.jobId,
      });
      if (!job) {
        throw Object.assign(new Error("Knowledge job not found"), { code: "not_found" });
      }
      const batch = await dependencies.submitKnowledgeBatchForIngestion({
        commandId: arguments_.commandId ?? arguments_.submissionId,
        jobId: arguments_.jobId,
        actorDigest: input.actorUserId,
        submissionId: arguments_.submissionId,
        templateDigest: arguments_.templateDigest,
        sourceSnapshot: arguments_.sourceSnapshot,
        items: arguments_.items,
      });
      return toolResult({ batch });
    },
  );

  server.registerTool(
    "get_knowledge_job",
    {
      description: "Read one KnowledgeJob from an accessible Project.",
      inputSchema: {
        projectId: mcpIdSchema,
        jobId: mcpIdSchema,
      },
    },
    async ({ projectId, jobId }) => {
      const job = await dependencies.readKnowledgeJobAccess({
        userId: input.actorUserId,
        projectId,
        jobId,
      });
      if (!job) {
        throw Object.assign(new Error("Knowledge job not found"), { code: "not_found" });
      }
      return toolResult({ job });
    },
  );

  server.registerTool(
    "prepare_knowledge_job",
    {
      description: "Prepare a submittable Knowledge Job in the same project knowledge base. Omit mode to repair the initialization Job, or pass mode plus dedupeIdentity to create a follow-up batch Job. Returns the exact jobId and templateDigest required for batch submission. Safe to call repeatedly.",
      inputSchema: {
        projectId: mcpIdSchema,
        mode: knowledgeGenerationModeSchema.optional(),
        dedupeIdentity: z.string().trim().min(1).max(191).optional(),
        title: z.string().trim().min(1).max(191).optional(),
      },
    },
    async ({ projectId, mode, dedupeIdentity, title }) => {
      await dependencies.assertCanWriteProject({
        userId: input.actorUserId,
        projectId,
      });
      const job = await dependencies.prepareKnowledgeJobForSubmission({
        projectId,
        actorUserId: input.actorUserId,
        ...(mode === undefined ? {} : { mode }),
        ...(dedupeIdentity === undefined ? {} : { dedupeIdentity }),
        ...(title === undefined ? {} : { title }),
      });
      return toolResult({ job });
    },
  );

  server.registerTool(
    "get_knowledge_batch_progress",
    {
      description: "Read platform receiving and processing progress for one accessible knowledge batch.",
      inputSchema: {
        projectId: mcpIdSchema,
        batchId: mcpIdSchema,
      },
    },
    async ({ projectId, batchId }) => {
      await dependencies.assertCanReadKnowledgeBatch({
        userId: input.actorUserId,
        projectId,
        batchId,
      });
      const batch = await dependencies.getKnowledgeBatchProjection(batchId);
      if (!batch) {
        throw Object.assign(new Error("Knowledge batch not found"), { code: "not_found" });
      }
      return toolResult({ batch });
    },
  );

  const knowledgeQueryDependencies = {
    assertCanReadProject: dependencies.assertCanReadProject,
  };

  server.registerTool("search_knowledge", {
    description: "Search published project knowledge (entries, relations, sources, and architecture views) through the platform index. Returns entryId plus source and architecture references.",
    inputSchema: {
      projectId: mcpIdSchema,
      query: z.string().trim().min(1).max(2_000),
      limit: z.number().int().min(1).max(50).optional(),
      entryType: z.string().trim().min(1).max(32).optional(),
    },
  }, async (arguments_) => toolResult(await dispatchMcpKnowledgeTool({
    tool: "search_knowledge",
    actorUserId: input.actorUserId,
    arguments: {
      projectId: arguments_.projectId,
      query: arguments_.query,
      ...(arguments_.limit === undefined ? {} : { limit: arguments_.limit }),
      ...(arguments_.entryType ? { entryType: arguments_.entryType } : {}),
    },
  } as McpKnowledgeToolRequest, knowledgeQueryDependencies as never)));

  server.registerTool("get_knowledge_entry", {
    description: "Read one published knowledge entry and its version history from an accessible Project.",
    inputSchema: { projectId: mcpIdSchema, entryId: mcpIdSchema },
  }, async (arguments_) => toolResult(await dispatchMcpKnowledgeTool({
    tool: "get_knowledge_entry",
    actorUserId: input.actorUserId,
    arguments: { projectId: arguments_.projectId, entryId: arguments_.entryId },
  } as McpKnowledgeToolRequest, knowledgeQueryDependencies as never)));

  server.registerTool("get_knowledge_neighborhood", {
    description: "Read the incoming and outgoing knowledge relations for one entry in an accessible Project.",
    inputSchema: { projectId: mcpIdSchema, entryId: mcpIdSchema },
  }, async (arguments_) => toolResult(await dispatchMcpKnowledgeTool({
    tool: "get_knowledge_neighborhood",
    actorUserId: input.actorUserId,
    arguments: { projectId: arguments_.projectId, entryId: arguments_.entryId },
  } as McpKnowledgeToolRequest, knowledgeQueryDependencies as never)));

  server.registerTool("get_architecture_view", {
    description: "Read one published architecture view. When nodeKey is provided, returns that node's upstream, downstream, related nodes, and linked knowledge.",
    inputSchema: { projectId: mcpIdSchema, viewId: mcpIdSchema, nodeKey: z.string().trim().min(1).max(191).optional() },
  }, async (arguments_) => toolResult(await dispatchMcpKnowledgeTool({
    tool: "get_architecture_view",
    actorUserId: input.actorUserId,
    arguments: {
      projectId: arguments_.projectId,
      viewId: arguments_.viewId,
      ...(arguments_.nodeKey ? { nodeKey: arguments_.nodeKey } : {}),
    },
  } as McpKnowledgeToolRequest, knowledgeQueryDependencies as never)));

  const interactionDependencies = {
    openRequirementConversation: dependencies.openRequirementConversation,
    appendRequirementMessage: dependencies.appendRequirementMessage,
    confirmRequirement: dependencies.confirmRequirement,
    requestRuntimeIntervention: dependencies.requestRuntimeIntervention,
    getWorkflowInteraction: dependencies.getWorkflowInteraction,
    assertCanReadProject: dependencies.assertCanReadProject,
    resolveActiveAttemptIdentity: dependencies.resolveActiveAttemptIdentity,
  };
  const interactionMessageSchema = {
    body: z.string().max(20_000),
    answers: z.record(z.string(), z.array(z.string())).optional(),
    attachmentIds: z.array(z.string().min(1)).max(20).optional(),
    mentionedUserIds: z.array(z.string().min(1)).max(50).optional(),
  };

  server.registerTool("open_workflow_interaction", {
    description: "Open or recover a requirement conversation for the active Loop node. A new conversation pauses execution; an existing confirmed conversation returns its messages and decision for checkpoint continuation.",
    inputSchema: {
      commandId: z.string().min(1),
      loopNodeAttemptId: z.string().min(1),
      ...interactionMessageSchema,
    },
  }, async (arguments_) => toolResult(await dispatchMcpWorkflowInteractionTool({
    tool: "open_workflow_interaction",
    actorUserId: input.actorUserId,
    arguments: {
      commandId: arguments_.commandId,
      loopNodeAttemptId: arguments_.loopNodeAttemptId,
      body: arguments_.body,
      ...(arguments_.answers !== undefined ? { answers: arguments_.answers } : {}),
      ...(arguments_.attachmentIds !== undefined ? { attachmentIds: arguments_.attachmentIds } : {}),
      ...(arguments_.mentionedUserIds !== undefined ? { mentionedUserIds: arguments_.mentionedUserIds } : {}),
    },
  }, interactionDependencies)));

  server.registerTool("append_workflow_interaction_message", {
    description: "Append an Agent message to an open requirement conversation. The server assigns message order so concurrent participants do not block each other.",
    inputSchema: {
      interactionId: z.string().min(1),
      loopRunId: z.string().min(1),
      commandId: z.string().min(1),
      ...interactionMessageSchema,
    },
  }, async (arguments_) => toolResult(await dispatchMcpWorkflowInteractionTool({
    tool: "append_workflow_interaction_message",
    actorUserId: input.actorUserId,
    arguments: {
      interactionId: arguments_.interactionId,
      loopRunId: arguments_.loopRunId,
      commandId: arguments_.commandId,
      body: arguments_.body,
      ...(arguments_.answers !== undefined ? { answers: arguments_.answers } : {}),
      ...(arguments_.attachmentIds !== undefined ? { attachmentIds: arguments_.attachmentIds } : {}),
      ...(arguments_.mentionedUserIds !== undefined ? { mentionedUserIds: arguments_.mentionedUserIds } : {}),
    },
  }, interactionDependencies)));

  server.registerTool("request_workflow_intervention", {
    description: "Request one runtime intervention for the authenticated Agent's active Loop Attempt; duplicate requests recover the same intervention.",
    inputSchema: {
      commandId: z.string().min(1),
      loopNodeAttemptId: z.string().min(1),
      reason: z.string().trim().min(1).max(20_000),
      evidence: z.unknown().optional(),
    },
  }, async (arguments_) => toolResult(await dispatchMcpWorkflowInteractionTool({
    tool: "request_workflow_intervention",
    actorUserId: input.actorUserId,
    arguments: {
      commandId: arguments_.commandId,
      loopNodeAttemptId: arguments_.loopNodeAttemptId,
      reason: arguments_.reason,
      ...(arguments_.evidence === undefined ? {} : { evidence: arguments_.evidence }),
    },
  }, interactionDependencies)));

  server.registerTool("confirm_workflow_interaction", {
    description: "Confirm a requirement conversation as the authenticated human and resume its Loop node.",
    inputSchema: {
      interactionId: z.string().min(1),
      loopRunId: z.string().min(1).optional(),
      commandId: z.string().min(1),
      expectedVersion: z.number().int().positive(),
      reason: z.string().max(4_000).optional(),
    },
  }, async (arguments_) => toolResult(await dispatchMcpWorkflowInteractionTool({
    tool: "confirm_workflow_interaction",
    actorUserId: input.actorUserId,
    arguments: {
      interactionId: arguments_.interactionId,
      commandId: arguments_.commandId,
      expectedVersion: arguments_.expectedVersion,
      ...(arguments_.loopRunId !== undefined ? { loopRunId: arguments_.loopRunId } : {}),
      ...(arguments_.reason !== undefined ? { reason: arguments_.reason } : {}),
    },
  }, interactionDependencies)));

  server.registerTool("get_workflow_interaction", {
    description: "Read the compact authorized state and latest message of a workflow interaction.",
    inputSchema: { interactionId: z.string().min(1) },
  }, async (arguments_) => toolResult(await dispatchMcpWorkflowInteractionTool({
    tool: "get_workflow_interaction",
    actorUserId: input.actorUserId,
    arguments: arguments_,
  }, interactionDependencies)));

  const taskDependencies = {
    getTaskCollection: dependencies.getTaskCollection,
    getTaskDetailView: dependencies.getTaskDetailView,
    createUserTask: dependencies.createUserTask,
    updateUserTaskContent: dependencies.updateUserTaskContent,
    updateUserTaskFields: dependencies.updateUserTaskFields,
    updateUserTaskSchedule: dependencies.updateUserTaskSchedule,
    assignUserTask: dependencies.assignUserTask,
    addUserTaskMember: dependencies.addUserTaskMember,
    removeUserTaskMember: dependencies.removeUserTaskMember,
    addUserTaskBlocker: dependencies.addUserTaskBlocker,
    resolveUserTaskBlocker: dependencies.resolveUserTaskBlocker,
    archiveUserTask: dependencies.archiveUserTask,
    restoreUserTask: dependencies.restoreUserTask,
    createUserTaskReminder: dependencies.createUserTaskReminder,
    removeUserTaskReminder: dependencies.removeUserTaskReminder,
    addUserTaskLabel: dependencies.addUserTaskLabel,
    removeUserTaskLabel: dependencies.removeUserTaskLabel,
    listTaskLabelDefinitions: dependencies.listTaskLabelDefinitions,
    listTaskAgentProfiles: dependencies.listTaskAgentProfiles,
    addUserTaskComment: dependencies.addUserTaskComment,
    changeUserTaskStatus: dependencies.changeUserTaskStatus,
    rejectUserTask: dependencies.rejectUserTask,
    dispatchUserTaskToAgent: dependencies.dispatchUserTaskToAgent,
    submitTaskAcceptanceEvidence: dependencies.submitTaskAcceptanceEvidence,
    assignTaskBranch: dependencies.assignTaskBranch,
  };

  const projectFieldDependencies = {
    listProjectTaskFields: dependencies.listProjectTaskFields,
    upsertProjectTaskField: dependencies.upsertProjectTaskField,
    deleteProjectTaskField: dependencies.deleteProjectTaskField,
  };

  const taskSettingsDependencies = {
    createTaskLabelDefinition: dependencies.createTaskLabelDefinition,
    deleteTaskLabelDefinition: dependencies.deleteTaskLabelDefinition,
    listTaskStatusDefinitions: dependencies.listTaskStatusDefinitions,
    createTaskStatusDefinition: dependencies.createTaskStatusDefinition,
    deleteTaskStatusDefinition: dependencies.deleteTaskStatusDefinition,
  };

  server.registerTool("list_tasks", {
    description: "List user-visible Tasks. Each Task exposes `id` (taskId), `shortId`, `version` (expectedVersion), `startAt`, and `dueAt` in ISO-8601 form or null.",
    inputSchema: {
      spaceId: z.string().min(1).optional(),
      search: z.string().trim().min(1).optional(),
      relation: z.enum(["all", "assigned", "created", "participating", "following", "overdue", "blocked", "completed"]).optional(),
      status: z.array(z.enum(["backlog", "todo", "in_progress", "in_review", "completed", "cancelled"])).optional(),
      assignee: z.array(mcpIdSchema).optional(),
      priority: z.array(z.number().int().min(0).max(3)).optional(),
      project: z.array(z.string().min(1)).optional(),
      dateFrom: z.iso.date().optional(),
      dateTo: z.iso.date().optional(),
      group: z.enum(["status", "assignee", "priority", "project"]).optional(),
      sort: z.enum(["updated_desc", "due_asc", "priority_desc", "created_desc"]).optional(),
      view: z.enum(["list", "board", "calendar"]).optional(),
      shortId: z.string().min(1).optional(),
      timeZone: z.string().min(1).optional(),
    },
  }, async (arguments_) => toolResult(await dispatchMcpTaskTool({
    tool: "list_tasks", actorUserId: input.actorUserId, arguments: {
      ...(arguments_.spaceId ? { spaceId: arguments_.spaceId } : {}),
      ...(arguments_.search ? { search: arguments_.search } : {}),
      ...(arguments_.relation ? { relation: arguments_.relation } : {}),
      ...(arguments_.status ? { status: arguments_.status } : {}),
      ...(arguments_.assignee ? { assignee: arguments_.assignee } : {}),
      ...(arguments_.priority ? { priority: arguments_.priority } : {}),
      ...(arguments_.project ? { project: arguments_.project } : {}),
      ...(arguments_.dateFrom ? { dateFrom: arguments_.dateFrom } : {}),
      ...(arguments_.dateTo ? { dateTo: arguments_.dateTo } : {}),
      ...(arguments_.group ? { group: arguments_.group } : {}),
      ...(arguments_.sort ? { sort: arguments_.sort } : {}),
      ...(arguments_.view ? { view: arguments_.view } : {}),
      ...(arguments_.shortId ? { shortId: arguments_.shortId } : {}),
      ...(arguments_.timeZone ? { timeZone: arguments_.timeZone } : {}),
    },
  }, taskDependencies)));

  server.registerTool("list_task_labels", {
    description: "List active Task labels in one Space. Use `labels[].id` as labelId for manage_task_label.",
    inputSchema: { spaceId: mcpIdSchema },
  }, async ({ spaceId }) => toolResult(await dispatchMcpTaskTool({
    tool: "list_task_labels", actorUserId: input.actorUserId, arguments: { spaceId },
  }, taskDependencies)));

  server.registerTool("list_task_agent_profiles", {
    description: "List active Agent Profiles available for a Task. Use `agentProfiles[].id` as agentProfileId for dispatch_task_to_agent.",
    inputSchema: { taskId: mcpIdSchema },
  }, async ({ taskId }) => toolResult(await dispatchMcpTaskTool({
    tool: "list_task_agent_profiles", actorUserId: input.actorUserId, arguments: { taskId },
  }, taskDependencies)));

  server.registerTool("get_task", {
    description: "Read one Task by exactly one key: taskId (`id`) or shortId. The result includes `version`, `startAt`, `dueAt`, collaboration records, and mutation capabilities.",
    inputSchema: {
      taskId: z.string().min(1).optional(),
      shortId: z.string().min(1).optional(),
    },
  }, async (arguments_) => toolResult(await dispatchMcpTaskTool({
    tool: "get_task", actorUserId: input.actorUserId, arguments: {
      ...(arguments_.taskId ? { taskId: arguments_.taskId } : {}),
      ...(arguments_.shortId ? { shortId: arguments_.shortId } : {}),
    },
  }, taskDependencies)));

  server.registerTool("create_task", {
    description: "Create a Task. Use projectId/stage milestoneId from get_project_roadmap; startAt and dueAt are ISO-8601 timestamps.",
    inputSchema: {
      commandId: z.string().min(1), spaceId: z.string().min(1), title: z.string().min(1),
      contentMarkdown: z.string().optional(), projectId: z.string().min(1).optional(), milestoneId: z.string().min(1).optional(), assigneeUserId: z.string().min(1).optional(),
      visibility: z.enum(["private", "project", "company"]).optional(),
      priority: z.number().int().min(0).max(3).optional(),
      startAt: mcpDateSchema.optional(),
      dueAt: mcpDateSchema.optional(),
      recurrenceRule: z.string().trim().max(512).nullable().optional(),
      loopBinding: z.object({ bindingId: mcpIdSchema, bindingType: z.enum(["task", "project"]) }).nullable().optional(),
      acceptanceMode: z.enum(["none", "human", "automated", "hybrid"]).optional(),
      requiredChecks: z.array(z.string().trim().min(1).max(96)).max(32).optional(),
      customFields: z.record(z.string(), z.unknown()).optional(),
    },
  }, async (arguments_) => toolResult(await dispatchMcpTaskTool({
    tool: "create_task", actorUserId: input.actorUserId, arguments: {
      commandId: arguments_.commandId,
      spaceId: arguments_.spaceId,
      title: arguments_.title,
      ...(arguments_.contentMarkdown !== undefined ? { contentMarkdown: arguments_.contentMarkdown } : {}),
      ...(arguments_.projectId ? { projectId: arguments_.projectId } : {}),
      ...(arguments_.milestoneId ? { milestoneId: arguments_.milestoneId } : {}),
      ...(arguments_.assigneeUserId ? { assigneeUserId: arguments_.assigneeUserId } : {}),
      ...(arguments_.visibility ? { visibility: arguments_.visibility } : {}),
      ...(arguments_.priority !== undefined ? { priority: arguments_.priority } : {}),
      ...(arguments_.startAt ? { startAt: arguments_.startAt } : {}),
      ...(arguments_.dueAt ? { dueAt: arguments_.dueAt } : {}),
      ...(arguments_.recurrenceRule !== undefined ? { recurrenceRule: arguments_.recurrenceRule } : {}),
      ...(arguments_.loopBinding !== undefined ? { loopBinding: arguments_.loopBinding } : {}),
      ...(arguments_.acceptanceMode ? { acceptanceMode: arguments_.acceptanceMode } : {}),
      ...(arguments_.requiredChecks ? { requiredChecks: arguments_.requiredChecks } : {}),
      ...(arguments_.customFields ? { customFields: arguments_.customFields } : {}),
    },
  }, taskDependencies)));

  server.registerTool("list_project_task_fields", {
    description: "List active custom task fields configured for an accessible Project.",
    inputSchema: { projectId: z.string().min(1) },
  }, async ({ projectId }) => toolResult(await dispatchMcpProjectFieldTool({
    tool: "list_project_task_fields",
    actorUserId: input.actorUserId,
    arguments: { projectId },
  }, projectFieldDependencies)));

  server.registerTool("upsert_project_task_field", {
    description: "Create or update a typed custom task field for a Project.",
    inputSchema: {
      projectId: z.string().min(1),
      field: z.object({
        key: z.string().min(2).max(64),
        name: z.string().min(1).max(191),
        type: z.enum(["text", "number", "date", "boolean", "select", "user"]),
        required: z.boolean().optional(),
        options: z.array(z.string().min(1).max(191)).optional(),
        sortOrder: z.number().int().optional(),
        isActive: z.boolean().optional(),
      }),
    },
  }, async ({ projectId, field }) => toolResult(await dispatchMcpProjectFieldTool({
    tool: "upsert_project_task_field",
    actorUserId: input.actorUserId,
    arguments: { projectId, field: {
      key: field.key,
      name: field.name,
      type: field.type,
      ...(field.required !== undefined ? { required: field.required } : {}),
      ...(field.options !== undefined ? { options: field.options } : {}),
      ...(field.sortOrder !== undefined ? { sortOrder: field.sortOrder } : {}),
      ...(field.isActive !== undefined ? { isActive: field.isActive } : {}),
    } },
  }, projectFieldDependencies)));

  server.registerTool("delete_project_task_field", {
    description: "Deactivate a custom task field from an accessible Project. Use fieldId from list_project_task_fields.",
    inputSchema: { projectId: mcpIdSchema, fieldId: mcpIdSchema },
  }, async ({ projectId, fieldId }) => toolResult(await dispatchMcpProjectFieldTool({
    tool: "delete_project_task_field",
    actorUserId: input.actorUserId,
    arguments: { projectId, fieldId },
  }, projectFieldDependencies)));

  server.registerTool("create_task_label_definition", {
    description: "Create a reusable Task label in a Space. The server generates labelId when omitted.",
    inputSchema: {
      spaceId: mcpIdSchema,
      name: z.string().trim().min(1).max(191),
      color: z.string().regex(/^#[0-9a-f]{6}$/iu),
      id: mcpIdSchema.optional(),
    },
  }, async (arguments_) => toolResult(await dispatchMcpTaskSettingsTool({
    tool: "create_task_label_definition",
    actorUserId: input.actorUserId,
    arguments: {
      spaceId: arguments_.spaceId,
      name: arguments_.name,
      color: arguments_.color,
      ...(arguments_.id !== undefined ? { id: arguments_.id } : {}),
    },
  }, taskSettingsDependencies)));

  server.registerTool("delete_task_label_definition", {
    description: "Delete an unused Task label from a Space. Use labelId from list_task_labels.",
    inputSchema: { spaceId: mcpIdSchema, labelId: mcpIdSchema },
  }, async (arguments_) => toolResult(await dispatchMcpTaskSettingsTool({
    tool: "delete_task_label_definition",
    actorUserId: input.actorUserId,
    arguments: arguments_,
  }, taskSettingsDependencies)));

  server.registerTool("list_task_status_definitions", {
    description: "List active custom Task statuses for a Space or Project. Use definitions[].id for deletion.",
    inputSchema: { spaceId: mcpIdSchema, projectId: mcpIdSchema.optional() },
  }, async (arguments_) => toolResult(await dispatchMcpTaskSettingsTool({
    tool: "list_task_status_definitions",
    actorUserId: input.actorUserId,
    arguments: {
      spaceId: arguments_.spaceId,
      ...(arguments_.projectId !== undefined ? { projectId: arguments_.projectId } : {}),
    },
  }, taskSettingsDependencies)));

  server.registerTool("create_task_status_definition", {
    description: "Create a custom Task status in a Space or Project. The server generates definitionId when omitted.",
    inputSchema: {
      spaceId: mcpIdSchema,
      projectId: mcpIdSchema.optional(),
      key: z.string().trim().min(1).max(96),
      name: z.string().trim().min(1).max(191),
      category: z.enum(["backlog", "todo", "in_progress", "in_review", "completed", "cancelled"]),
      color: z.string().regex(/^#[0-9a-f]{6}$/iu),
      sortOrder: z.number().int(),
      id: mcpIdSchema.optional(),
    },
  }, async (arguments_) => toolResult(await dispatchMcpTaskSettingsTool({
    tool: "create_task_status_definition",
    actorUserId: input.actorUserId,
    arguments: {
      spaceId: arguments_.spaceId,
      ...(arguments_.projectId !== undefined ? { projectId: arguments_.projectId } : {}),
      key: arguments_.key,
      name: arguments_.name,
      category: arguments_.category,
      color: arguments_.color,
      sortOrder: arguments_.sortOrder,
      ...(arguments_.id !== undefined ? { id: arguments_.id } : {}),
    },
  }, taskSettingsDependencies)));

  server.registerTool("delete_task_status_definition", {
    description: "Delete an unused custom Task status. Use definitionId from list_task_status_definitions.",
    inputSchema: { spaceId: mcpIdSchema, definitionId: mcpIdSchema },
  }, async (arguments_) => toolResult(await dispatchMcpTaskSettingsTool({
    tool: "delete_task_status_definition",
    actorUserId: input.actorUserId,
    arguments: arguments_,
  }, taskSettingsDependencies)));

  const taskQuerySchema = z.object({
    search: z.string().trim().min(1).optional(),
    relation: z.enum(["all", "assigned", "created", "participating", "following", "overdue", "blocked", "completed"]).optional(),
    status: z.array(z.enum(["backlog", "todo", "in_progress", "in_review", "completed", "cancelled"])).optional(),
    assignee: z.array(mcpIdSchema).optional(),
    priority: z.array(z.number().int().min(0).max(3)).optional(),
    project: z.array(mcpIdSchema).optional(),
    dateFrom: z.iso.date().optional(),
    dateTo: z.iso.date().optional(),
    group: z.enum(["status", "assignee", "priority", "project"]).optional(),
    sort: z.enum(["updated_desc", "due_asc", "priority_desc", "created_desc"]).optional(),
    view: z.enum(["list", "board", "calendar"]).optional(),
  }).strict();

  const normalizeTaskViewQuery = (query: z.infer<typeof taskQuerySchema>) => ({
    ...(query.search !== undefined ? { search: query.search } : {}),
    ...(query.relation !== undefined ? { relation: query.relation } : {}),
    ...(query.status !== undefined ? { status: query.status } : {}),
    ...(query.assignee !== undefined ? { assignee: query.assignee } : {}),
    ...(query.priority !== undefined ? { priority: query.priority } : {}),
    ...(query.project !== undefined ? { project: query.project } : {}),
    ...(query.dateFrom !== undefined ? { dateFrom: query.dateFrom } : {}),
    ...(query.dateTo !== undefined ? { dateTo: query.dateTo } : {}),
    ...(query.group !== undefined ? { group: query.group } : {}),
    ...(query.sort !== undefined ? { sort: query.sort } : {}),
    ...(query.view !== undefined ? { view: query.view } : {}),
  });

  const taskViewDependencies = {
    listTaskSavedViews: dependencies.listTaskSavedViews,
    saveTaskView: dependencies.saveTaskView,
    updateTaskSavedView: dependencies.updateTaskSavedView,
    deleteTaskSavedView: dependencies.deleteTaskSavedView,
  };

  server.registerTool("list_task_saved_views", {
    description: "List the authenticated user's saved Task views. Use views[].id as viewId for updates or deletion.",
    inputSchema: {},
  }, async () => toolResult(await dispatchMcpTaskViewTool({
    tool: "list_task_saved_views", actorUserId: input.actorUserId, arguments: {},
  }, taskViewDependencies)));

  server.registerTool("create_task_saved_view", {
    description: "Create a saved Task view. The server generates viewId when omitted and normalizes the query defaults.",
    inputSchema: { name: z.string().trim().min(1).max(191), query: taskQuerySchema, id: mcpIdSchema.optional() },
  }, async (arguments_) => toolResult(await dispatchMcpTaskViewTool({
    tool: "create_task_saved_view", actorUserId: input.actorUserId, arguments: {
      name: arguments_.name,
      query: normalizeTaskViewQuery(arguments_.query),
      ...(arguments_.id !== undefined ? { id: arguments_.id } : {}),
    },
  }, taskViewDependencies)));

  server.registerTool("update_task_saved_view", {
    description: "Update a saved Task view using viewId from list_task_saved_views.",
    inputSchema: { viewId: mcpIdSchema, name: z.string().trim().min(1).max(191), query: taskQuerySchema },
  }, async (arguments_) => toolResult(await dispatchMcpTaskViewTool({
    tool: "update_task_saved_view", actorUserId: input.actorUserId, arguments: {
      viewId: arguments_.viewId,
      name: arguments_.name,
      query: normalizeTaskViewQuery(arguments_.query),
    },
  }, taskViewDependencies)));

  server.registerTool("delete_task_saved_view", {
    description: "Delete a saved Task view using viewId from list_task_saved_views.",
    inputSchema: { viewId: mcpIdSchema },
  }, async (arguments_) => toolResult(await dispatchMcpTaskViewTool({
    tool: "delete_task_saved_view", actorUserId: input.actorUserId, arguments: arguments_,
  }, taskViewDependencies)));

  server.registerTool("update_task", {
    description: "Update a Task using exactly one of taskId or shortId and the current version. Supports title, Markdown, priority, Project assignment, custom fields, startAt, and dueAt. commandId is optional; the server generates one when omitted. Do not combine schedule fields with other fields.",
    inputSchema: {
      commandId: mcpIdSchema.optional(), taskId: mcpIdSchema.optional(), shortId: mcpIdSchema.optional(), expectedVersion: mcpVersionSchema,
      title: z.string().trim().min(1).max(191).optional(), contentMarkdown: z.string().optional(), priority: z.number().int().min(0).max(3).optional(), projectId: mcpIdSchema.nullable().optional(), customFields: z.record(z.string(), z.unknown()).optional(),
      startAt: nullableMcpDateSchema, dueAt: nullableMcpDateSchema,
      recurrenceRule: z.string().trim().max(512).nullable().optional(),
      loopBinding: z.object({ bindingId: mcpIdSchema, bindingType: z.enum(["task", "project"]) }).nullable().optional(),
    },
  }, async (arguments_) => toolResult(await dispatchMcpTaskTool({
    tool: "update_task", actorUserId: input.actorUserId, arguments: {
      ...(arguments_.commandId !== undefined ? { commandId: arguments_.commandId } : {}),
      ...(arguments_.taskId !== undefined ? { taskId: arguments_.taskId } : {}),
      ...(arguments_.shortId !== undefined ? { shortId: arguments_.shortId } : {}),
      expectedVersion: arguments_.expectedVersion,
      ...(arguments_.title !== undefined ? { title: arguments_.title } : {}),
      ...(arguments_.contentMarkdown !== undefined ? { contentMarkdown: arguments_.contentMarkdown } : {}),
      ...(arguments_.priority !== undefined ? { priority: arguments_.priority } : {}),
      ...(arguments_.projectId !== undefined ? { projectId: arguments_.projectId } : {}),
      ...(arguments_.customFields !== undefined ? { customFields: arguments_.customFields } : {}),
      ...(arguments_.startAt !== undefined ? { startAt: arguments_.startAt } : {}),
      ...(arguments_.dueAt !== undefined ? { dueAt: arguments_.dueAt } : {}),
      ...(arguments_.recurrenceRule !== undefined ? { recurrenceRule: arguments_.recurrenceRule } : {}),
      ...(arguments_.loopBinding !== undefined ? { loopBinding: arguments_.loopBinding } : {}),
    },
  }, taskDependencies)));

  server.registerTool("update_task_schedule", {
    description: "Set or clear Task schedule fields using exactly one of taskId or shortId and the current version. `startAt` and `dueAt` are ISO-8601 timestamps; pass null to clear either field. commandId is optional.",
    inputSchema: {
      commandId: mcpIdSchema.optional(),
      taskId: mcpIdSchema.optional(),
      shortId: mcpIdSchema.optional(),
      expectedVersion: mcpVersionSchema,
      startAt: nullableMcpDateSchema,
      dueAt: nullableMcpDateSchema,
      recurrenceRule: z.string().trim().max(512).nullable().optional(),
      loopBinding: z.object({ bindingId: mcpIdSchema, bindingType: z.enum(["task", "project"]) }).nullable().optional(),
    },
  }, async (arguments_) => toolResult(await dispatchMcpTaskTool({
    tool: "update_task_schedule", actorUserId: input.actorUserId, arguments: {
      ...(arguments_.commandId !== undefined ? { commandId: arguments_.commandId } : {}),
      ...(arguments_.taskId !== undefined ? { taskId: arguments_.taskId } : {}),
      ...(arguments_.shortId !== undefined ? { shortId: arguments_.shortId } : {}),
      expectedVersion: arguments_.expectedVersion,
      ...(arguments_.startAt !== undefined ? { startAt: arguments_.startAt } : {}),
      ...(arguments_.dueAt !== undefined ? { dueAt: arguments_.dueAt } : {}),
      ...(arguments_.recurrenceRule !== undefined ? { recurrenceRule: arguments_.recurrenceRule } : {}),
      ...(arguments_.loopBinding !== undefined ? { loopBinding: arguments_.loopBinding } : {}),
    },
  }, taskDependencies)));

  server.registerTool("assign_task", {
    description: "Assign a Task to one Space member using taskId and the current Task version.",
    inputSchema: { commandId: mcpIdSchema, taskId: mcpIdSchema, expectedVersion: mcpVersionSchema, assigneeUserId: mcpIdSchema },
  }, async (arguments_) => toolResult(await dispatchMcpTaskTool({
    tool: "assign_task", actorUserId: input.actorUserId, arguments: arguments_,
  }, taskDependencies)));

  server.registerTool("manage_task_member", {
    description: "Add or remove a Task collaborator. `role` is required for add; use participant or follower.",
    inputSchema: {
      commandId: mcpIdSchema, taskId: mcpIdSchema, expectedVersion: mcpVersionSchema,
      action: z.enum(["add", "remove"]), userId: mcpIdSchema, role: z.enum(["participant", "follower"]).optional(),
    },
  }, async (arguments_) => toolResult(await dispatchMcpTaskTool({
    tool: "manage_task_member", actorUserId: input.actorUserId, arguments: arguments_,
  }, taskDependencies)));

  server.registerTool("manage_task_blocker", {
    description: "Add or resolve a Task blocker. Add requires `reason`; resolve requires blockerId returned by get_task or a prior add result.",
    inputSchema: {
      commandId: mcpIdSchema, taskId: mcpIdSchema, expectedVersion: mcpVersionSchema,
      action: z.enum(["add", "resolve"]), reason: z.string().trim().min(1).optional(), ownerUserId: mcpIdSchema.optional(), blockerId: mcpIdSchema.optional(),
    },
  }, async (arguments_) => toolResult(await dispatchMcpTaskTool({
    tool: "manage_task_blocker", actorUserId: input.actorUserId, arguments: arguments_,
  }, taskDependencies)));

  server.registerTool("set_task_archived", {
    description: "Archive or restore a Task without changing its business status.",
    inputSchema: { commandId: mcpIdSchema, taskId: mcpIdSchema, expectedVersion: mcpVersionSchema, archived: z.boolean() },
  }, async (arguments_) => toolResult(await dispatchMcpTaskTool({
    tool: "set_task_archived", actorUserId: input.actorUserId, arguments: arguments_,
  }, taskDependencies)));

  server.registerTool("manage_task_reminder", {
    description: "Create or remove the authenticated user's Task reminder. Create requires remindAt; remove requires reminderId from get_task.",
    inputSchema: {
      commandId: mcpIdSchema, taskId: mcpIdSchema, expectedVersion: mcpVersionSchema,
      action: z.enum(["create", "remove"]), remindAt: mcpDateSchema.optional(), reminderId: mcpIdSchema.optional(),
    },
  }, async (arguments_) => toolResult(await dispatchMcpTaskTool({
    tool: "manage_task_reminder", actorUserId: input.actorUserId, arguments: arguments_,
  }, taskDependencies)));

  server.registerTool("manage_task_label", {
    description: "Add or remove a Space label using labelId, taskId, and the current Task version.",
    inputSchema: {
      commandId: mcpIdSchema, taskId: mcpIdSchema, expectedVersion: mcpVersionSchema,
      action: z.enum(["add", "remove"]), labelId: mcpIdSchema,
    },
  }, async (arguments_) => toolResult(await dispatchMcpTaskTool({
    tool: "manage_task_label", actorUserId: input.actorUserId, arguments: arguments_,
  }, taskDependencies)));

  server.registerTool("add_task_comment", {
    description: "Add a Markdown comment to a user-visible Task.",
    inputSchema: {
      commandId: z.string().min(1), taskId: z.string().min(1), expectedVersion: z.number().int().positive(), contentMarkdown: z.string().min(1),
    },
  }, async (arguments_) => toolResult(await dispatchMcpTaskTool({
    tool: "add_task_comment", actorUserId: input.actorUserId, arguments: arguments_,
  }, taskDependencies)));

  server.registerTool("change_task_status", {
    description: "Change Task business status through TaskPolicy and acceptance rules.",
    inputSchema: {
      commandId: z.string().min(1), taskId: z.string().min(1), expectedVersion: z.number().int().positive(),
      command: z.enum(["move_to_todo", "start", "complete", "submit_for_review", "accept", "reject", "cancel", "reopen"]),
      reason: z.string().optional(),
    },
  }, async (arguments_) => toolResult(await dispatchMcpTaskTool({
    tool: "change_task_status", actorUserId: input.actorUserId, arguments: {
      commandId: arguments_.commandId,
      taskId: arguments_.taskId,
      expectedVersion: arguments_.expectedVersion,
      command: arguments_.command,
      ...(arguments_.reason !== undefined ? { reason: arguments_.reason } : {}),
    },
  }, taskDependencies)));

  server.registerTool("cancel_task", {
    description: "Cancel a Task explicitly using exactly one of taskId or shortId and the current version from get_task/list_tasks. commandId is optional; the server generates one when omitted. reason is recorded in Task activity.",
    inputSchema: {
      commandId: mcpIdSchema.optional(),
      taskId: mcpIdSchema.optional(),
      shortId: mcpIdSchema.optional(),
      expectedVersion: mcpVersionSchema,
      reason: z.string().trim().max(4_000).optional(),
    },
  }, async (arguments_) => toolResult(await dispatchMcpTaskTool({
    tool: "cancel_task", actorUserId: input.actorUserId, arguments: {
      ...(arguments_.commandId !== undefined ? { commandId: arguments_.commandId } : {}),
      ...(arguments_.taskId !== undefined ? { taskId: arguments_.taskId } : {}),
      ...(arguments_.shortId !== undefined ? { shortId: arguments_.shortId } : {}),
      expectedVersion: arguments_.expectedVersion,
      ...(arguments_.reason !== undefined ? { reason: arguments_.reason } : {}),
    },
  }, taskDependencies)));

  server.registerTool("submit_task_acceptance_evidence", {
    description: "Record durable evidence for one required Task acceptance check without completing the Task.",
    inputSchema: {
      commandId: z.string().trim().min(1).max(128),
      taskId: z.string().trim().min(1).max(128),
      expectedVersion: z.number().int().positive(),
      checkKey: z.string().trim().min(1).max(96),
      status: z.enum(["passed", "failed", "inconclusive", "skipped"]),
      summary: z.string().trim().min(1).max(2_000),
      evidenceMarkdown: z.string().trim().max(10_000).optional(),
      startedAt: z.iso.datetime().transform((value) => new Date(value)).optional(),
      finishedAt: z.iso.datetime().transform((value) => new Date(value)).optional(),
    },
  }, async (arguments_) => toolResult(await dispatchMcpTaskTool({
    tool: "submit_task_acceptance_evidence",
    actorUserId: input.actorUserId,
    arguments: {
      commandId: arguments_.commandId,
      taskId: arguments_.taskId,
      expectedVersion: arguments_.expectedVersion,
      checkKey: arguments_.checkKey,
      status: arguments_.status,
      summary: arguments_.summary,
      ...(arguments_.evidenceMarkdown !== undefined ? { evidenceMarkdown: arguments_.evidenceMarkdown } : {}),
      ...(arguments_.startedAt !== undefined ? { startedAt: arguments_.startedAt } : {}),
      ...(arguments_.finishedAt !== undefined ? { finishedAt: arguments_.finishedAt } : {}),
    },
  }, taskDependencies)));

  server.registerTool("dispatch_task_to_agent", {
    description: "Request an Agent execution candidate without completing the business Task.",
    inputSchema: {
      commandId: z.string().min(1), taskId: z.string().min(1), expectedVersion: z.number().int().positive(), agentProfileId: z.string().min(1),
    },
  }, async (arguments_) => toolResult(await dispatchMcpTaskTool({
    tool: "dispatch_task_to_agent", actorUserId: input.actorUserId, arguments: arguments_,
  }, taskDependencies)));

  if (process.env.HUMANTHREAD_DEVELOPMENT_MODES === "true") {
    server.registerTool("assign_task_branch", {
      description: "Assign the deterministic platform Task branch using persisted Task identity.",
      inputSchema: {
        commandId: z.string().min(1),
        taskId: z.string().min(1),
        expectedVersion: z.number().int().positive(),
      },
    }, async (arguments_) => toolResult(await dispatchMcpTaskTool({
      tool: "assign_task_branch",
      actorUserId: input.actorUserId,
      arguments: {
        commandId: arguments_.commandId,
        taskId: arguments_.taskId,
        expectedVersion: arguments_.expectedVersion,
      },
    }, taskDependencies)));
  }

  return server;
}

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHumanThreadMcpServer } from "./mcp-server";

const closeCallbacks: Array<() => Promise<void>> = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(closeCallbacks.splice(0).map((close) => close()));
});

async function connectServer(
  dependencies: Parameters<typeof createHumanThreadMcpServer>[0]["dependencies"],
  credentialTransportKey?: string,
) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createHumanThreadMcpServer({
    actorUserId: "user_1",
    credentialTransportKey: credentialTransportKey ?? "test-transport-key",
    ...(dependencies ? { dependencies } : {}),
  });
  const client = new Client({ name: "humanthread-test", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  closeCallbacks.push(async () => {
    await client.close();
    await server.close();
  });
  return client;
}

describe("HumanThread MCP server", () => {
  it("registers the standard space and document tools", async () => {
    const client = await connectServer({
      listWorkbenchSpaces: vi.fn().mockResolvedValue([]),
    });
    const result = await client.listTools();

    expect(result.tools.map((tool) => tool.name)).toEqual([
      "list_spaces",
      "list_projects",
      "create_project",
      "list_project_members",
      "get_project_roadmap",
      "create_project_roadmap",
      "update_project_roadmap",
      "update_project",
      "change_project_status",
      "get_project_environment_secrets",
      "list_documents",
      "list_document_tree",
      "search_documents",
      "get_document",
      "create_document",
      "move_document",
      "update_document",
      "append_document",
      "upload_document_attachment",
      "submit_knowledge_batch",
      "get_knowledge_job",
      "prepare_knowledge_job",
      "get_knowledge_batch_progress",
      "search_knowledge",
      "get_knowledge_entry",
      "get_knowledge_neighborhood",
      "get_architecture_view",
      "open_workflow_interaction",
      "append_workflow_interaction_message",
      "request_workflow_intervention",
      "confirm_workflow_interaction",
      "get_workflow_interaction",
      "list_tasks",
      "list_task_labels",
      "list_task_agent_profiles",
      "get_task",
      "create_task",
      "list_project_task_fields",
      "upsert_project_task_field",
      "delete_project_task_field",
      "create_task_label_definition",
      "delete_task_label_definition",
      "list_task_status_definitions",
      "create_task_status_definition",
      "delete_task_status_definition",
      "list_task_saved_views",
      "create_task_saved_view",
      "update_task_saved_view",
      "delete_task_saved_view",
      "update_task",
      "update_task_schedule",
      "assign_task",
      "manage_task_member",
      "manage_task_blocker",
      "set_task_archived",
      "manage_task_reminder",
      "manage_task_label",
      "add_task_comment",
      "change_task_status",
      "cancel_task",
      "submit_task_acceptance_evidence",
      "dispatch_task_to_agent",
    ]);
    const changeStatus = result.tools.find((tool) => tool.name === "change_task_status");
    expect(changeStatus?.inputSchema).not.toHaveProperty("properties.acceptancePassed");
    const schedule = result.tools.find((tool) => tool.name === "update_task_schedule");
    expect(schedule?.inputSchema).toHaveProperty("properties.dueAt");
    const tasks = result.tools.find((tool) => tool.name === "list_tasks");
    expect(tasks?.inputSchema).toHaveProperty("properties.view");
    const roadmap = result.tools.find((tool) => tool.name === "update_project_roadmap");
    expect(roadmap?.inputSchema).toHaveProperty("properties.action");
    const updateTask = result.tools.find((tool) => tool.name === "update_task");
    expect(updateTask?.inputSchema).toHaveProperty("properties.dueAt");
    expect(updateTask?.inputSchema).toHaveProperty("properties.shortId");
    expect(schedule?.inputSchema).toHaveProperty("properties.shortId");
    const cancel = result.tools.find((tool) => tool.name === "cancel_task");
    expect(cancel?.inputSchema).toHaveProperty("properties.shortId");
    const openInteraction = result.tools.find((tool) => tool.name === "open_workflow_interaction");
    expect(openInteraction?.description).toContain("recover");
    expect(openInteraction?.description).toContain("confirmed");
  });

  it("submits and reads knowledge only through project-scoped adapters", async () => {
    const assertCanWriteProject = vi.fn().mockResolvedValue({
      projectId: "project_1",
      role: "maintainer",
    });
    const readKnowledgeJobAccess = vi.fn().mockResolvedValue({
      id: "job_1",
      projectDigest: "b".repeat(32),
      taskId: "task_1",
      mode: "task_completion",
      status: "awaiting_submission",
      templateVersionId: "b".repeat(32),
      policyVersion: 1,
      dedupeKey: "knowledge-job:task_1",
      sourceSnapshot: {},
      failureCode: null,
      failureMessage: null,
      version: 1,
      createdAt: new Date("2026-09-20T00:00:00.000Z"),
      updatedAt: new Date("2026-09-20T00:00:00.000Z"),
    });
    const submitKnowledgeBatchForIngestion = vi.fn().mockResolvedValue({
      id: "batch_1",
      jobId: "job_1",
      status: "received",
      failedStage: null,
      progress: 0,
      processedChunks: 0,
      totalChunks: 0,
      retryCount: 0,
      failureClass: null,
      failureMessage: null,
      receivedAt: new Date("2026-09-20T10:00:00.000Z"),
      updatedAt: new Date("2026-09-20T10:00:00.000Z"),
    });
    const assertCanReadKnowledgeBatch = vi.fn().mockResolvedValue({ id: "batch_1" });
    const getKnowledgeBatchProjection = vi.fn().mockResolvedValue({
      id: "batch_1",
      jobId: "job_1",
      status: "policy_evaluating",
      failedStage: null,
      progress: 10,
      processedChunks: 0,
      totalChunks: 0,
      retryCount: 0,
      failureClass: null,
      failureMessage: null,
      receivedAt: new Date("2026-09-20T10:00:00.000Z"),
      updatedAt: new Date("2026-09-20T10:00:00.000Z"),
    });
    const client = await connectServer({
      listWorkbenchSpaces: vi.fn().mockResolvedValue([]),
      assertCanWriteProject,
      readKnowledgeJobAccess,
      submitKnowledgeBatchForIngestion,
      assertCanReadKnowledgeBatch,
      getKnowledgeBatchProjection,
    } as never);

    const tools = await client.listTools();
    const submitTool = tools.tools.find((tool) => tool.name === "submit_knowledge_batch");
    expect(submitTool?.inputSchema).toHaveProperty("properties.projectId");
    expect(submitTool?.inputSchema).toHaveProperty("properties.items.maxItems", 500);
    expect(submitTool?.inputSchema).toHaveProperty("properties.items.items.properties.tags");
    expect(submitTool?.inputSchema).toHaveProperty("properties.items.items.properties.changeSummary");
    expect(tools.tools.find((tool) => tool.name === "get_knowledge_job")?.inputSchema)
      .toHaveProperty("properties.projectId");
    expect(tools.tools.find((tool) => tool.name === "get_knowledge_batch_progress")?.inputSchema)
      .toHaveProperty("properties.projectId");

    const submitted = await client.callTool({
      name: "submit_knowledge_batch",
      arguments: {
        projectId: "project_1",
        jobId: "job_1",
        submissionId: "submission_1",
        templateDigest: "a".repeat(32),
        sourceSnapshot: {},
        items: [],
      },
    });
    const jobRead = await client.callTool({
      name: "get_knowledge_job",
      arguments: { projectId: "project_1", jobId: "job_1" },
    });
    const progress = await client.callTool({
      name: "get_knowledge_batch_progress",
      arguments: { projectId: "project_1", batchId: "batch_1" },
    });

    expect(assertCanWriteProject).toHaveBeenCalledWith({
      userId: "user_1",
      projectId: "project_1",
    });
    expect(readKnowledgeJobAccess).toHaveBeenCalledWith({
      userId: "user_1",
      projectId: "project_1",
      jobId: "job_1",
    });
    expect(submitKnowledgeBatchForIngestion).toHaveBeenCalledWith({
      commandId: "submission_1",
      jobId: "job_1",
      actorDigest: "user_1",
      submissionId: "submission_1",
      templateDigest: "a".repeat(32),
      sourceSnapshot: {},
      items: [],
    });
    expect(assertCanReadKnowledgeBatch).toHaveBeenCalledWith({
      userId: "user_1",
      projectId: "project_1",
      batchId: "batch_1",
    });
    expect(getKnowledgeBatchProjection).toHaveBeenCalledWith("batch_1");
    expect(submitted.structuredContent).toMatchObject({ batch: { id: "batch_1" } });
    expect(jobRead.structuredContent).toMatchObject({ job: { id: "job_1" } });
    expect(progress.structuredContent).toMatchObject({ batch: { id: "batch_1", progress: 10 } });
  });

  it("prepares a knowledge job so a stale project can submit a batch", async () => {
    const assertCanWriteProject = vi.fn().mockResolvedValue({ projectId: "project_1", role: "maintainer" });
    const prepareKnowledgeJobForSubmission = vi.fn().mockResolvedValue({
      jobId: "d".repeat(32),
      taskId: "e".repeat(32),
      projectDigest: "f".repeat(32),
      mode: "project_initialization",
      status: "worker_running",
      templateVersionId: "c".repeat(32),
      templateDigest: "8".repeat(32),
      sourceSnapshot: { observedAt: "2026-09-23T00:00:00.000Z", sourceRefs: [] },
      sourceSnapshotDigest: "9".repeat(32),
      policyVersion: 1,
      repaired: true,
      duplicate: false,
    });
    const client = await connectServer({
      listWorkbenchSpaces: vi.fn().mockResolvedValue([]),
      assertCanWriteProject,
      prepareKnowledgeJobForSubmission,
    } as never);

    const tools = await client.listTools();
    const prepareTool = tools.tools.find((tool) => tool.name === "prepare_knowledge_job");
    expect(prepareTool?.inputSchema).toHaveProperty("properties.projectId");

    const prepared = await client.callTool({
      name: "prepare_knowledge_job",
      arguments: { projectId: "project_1" },
    });

    expect(assertCanWriteProject).toHaveBeenCalledWith({ userId: "user_1", projectId: "project_1" });
    expect(prepareKnowledgeJobForSubmission).toHaveBeenCalledWith({
      projectId: "project_1",
      actorUserId: "user_1",
    });
    expect(prepared.structuredContent).toMatchObject({
      job: { jobId: "d".repeat(32), templateDigest: "8".repeat(32), status: "worker_running" },
    });
  });

  it("prepares a follow-up knowledge Job in the same project knowledge base", async () => {
    const assertCanWriteProject = vi.fn().mockResolvedValue({ projectId: "project_1", role: "maintainer" });
    const prepareKnowledgeJobForSubmission = vi.fn().mockResolvedValue({
      jobId: "7".repeat(32),
      taskId: "6".repeat(32),
      projectDigest: "f".repeat(32),
      mode: "manual_update",
      status: "worker_running",
      templateVersionId: "5".repeat(32),
      templateDigest: "4".repeat(32),
      sourceSnapshot: { observedAt: "2026-09-24T00:00:00.000Z", sourceRefs: [] },
      sourceSnapshotDigest: "3".repeat(32),
      policyVersion: 1,
      repaired: true,
      duplicate: false,
    });
    const client = await connectServer({
      listWorkbenchSpaces: vi.fn().mockResolvedValue([]),
      assertCanWriteProject,
      prepareKnowledgeJobForSubmission,
    } as never);

    const prepared = await client.callTool({
      name: "prepare_knowledge_job",
      arguments: {
        projectId: "project_1",
        mode: "manual_update",
        dedupeIdentity: "medical-finance-military-materials-advantages",
        title: "补交领域知识",
      },
    });

    expect(prepareKnowledgeJobForSubmission).toHaveBeenCalledWith({
      projectId: "project_1",
      actorUserId: "user_1",
      mode: "manual_update",
      dedupeIdentity: "medical-finance-military-materials-advantages",
      title: "补交领域知识",
    });
    expect(prepared.structuredContent).toMatchObject({
      job: { jobId: "7".repeat(32), mode: "manual_update", duplicate: false },
    });
  });

  it("registers a runtime intervention request tool", async () => {
    const client = await connectServer({
      listWorkbenchSpaces: vi.fn().mockResolvedValue([]),
      requestRuntimeIntervention: vi.fn().mockResolvedValue({ interactionId: "runtime_interaction_1", status: "open", version: 1 }),
      resolveActiveAttemptIdentity: vi.fn().mockResolvedValue({ agentRunId: "agent_run_1", loopRunId: "loop_run_1", loopNodeRunId: "node_run_1", loopNodeAttemptId: "attempt_1" }),
    });
    const result = await client.listTools();
    expect(result.tools.find((tool) => tool.name === "request_workflow_intervention")?.description).toContain("intervention");
  });

  it("calls Project roadmap tools with discoverable IDs and versions", async () => {
    const getProjectHubView = vi.fn().mockResolvedValue({
      project: { id: "project_1", version: 4 },
      roadmap: [{ id: "stage_1", version: 2, milestones: [] }],
      health: {},
      taskSummary: {},
    });
    const commandProjectRoadmap = vi.fn().mockResolvedValue({ projectId: "project_1", version: 5 });
    const client = await connectServer({
      listWorkbenchSpaces: vi.fn().mockResolvedValue([]),
      getProjectHubView,
      commandProjectRoadmap,
    } as never);

    const read = await client.callTool({ name: "get_project_roadmap", arguments: { projectId: "project_1" } });
    await client.callTool({
      name: "update_project_roadmap",
      arguments: {
        commandId: "cmd_stage",
        projectId: "project_1",
        expectedVersion: 4,
        action: { type: "stage.create", name: "发布", targetAt: "2026-08-31T12:00:00.000Z" },
      },
    });

    expect(read.structuredContent).toMatchObject({ keys: { stageId: "roadmap[].id", milestoneId: "roadmap[].milestones[].id" } });
    expect(commandProjectRoadmap).toHaveBeenCalledWith(expect.objectContaining({ action: expect.objectContaining({ type: "stage.create" }) }));
  });

  it("routes project fields, Agent Profiles, settings, and saved views through injected services", async () => {
    const listProjectTaskFields = vi.fn().mockResolvedValue([{ id: "field_1" }]);
    const deleteProjectTaskField = vi.fn().mockResolvedValue({ fieldId: "field_1", isActive: false });
    const listTaskAgentProfiles = vi.fn().mockResolvedValue([{ id: "agent_profile_1" }]);
    const createTaskLabelDefinition = vi.fn().mockResolvedValue({ id: "label_1" });
    const saveTaskView = vi.fn().mockResolvedValue({ id: "view_1" });
    const client = await connectServer({
      listWorkbenchSpaces: vi.fn().mockResolvedValue([]),
      listProjectTaskFields,
      deleteProjectTaskField,
      listTaskAgentProfiles,
      createTaskLabelDefinition,
      saveTaskView,
    } as never);

    await client.callTool({ name: "list_project_task_fields", arguments: { projectId: "project_1" } });
    await client.callTool({ name: "delete_project_task_field", arguments: { projectId: "project_1", fieldId: "field_1" } });
    await client.callTool({ name: "list_task_agent_profiles", arguments: { taskId: "task_1" } });
    await client.callTool({ name: "create_task_label_definition", arguments: { spaceId: "space_1", name: "发布", color: "#0969da" } });
    await client.callTool({ name: "create_task_saved_view", arguments: { name: "逾期", query: { relation: "overdue" } } });

    expect(listProjectTaskFields).toHaveBeenCalledWith({ userId: "user_1", projectId: "project_1" });
    expect(deleteProjectTaskField).toHaveBeenCalledWith({ userId: "user_1", projectId: "project_1", fieldId: "field_1" });
    expect(listTaskAgentProfiles).toHaveBeenCalledWith({ userId: "user_1", taskId: "task_1" });
    expect(createTaskLabelDefinition).toHaveBeenCalledWith(expect.objectContaining({ userId: "user_1", spaceId: "space_1" }));
    expect(saveTaskView).toHaveBeenCalledWith(expect.objectContaining({ userId: "user_1", name: "逾期" }));
  });

  it("reads only explicitly requested project environment secrets through the authenticated actor", async () => {
    const resolveProjectEnvironmentSecrets = vi.fn().mockResolvedValue({ HT_GIT_TOKEN: "secret-value" });
    const client = await connectServer({
      listWorkbenchSpaces: vi.fn().mockResolvedValue([]),
      resolveProjectEnvironmentSecrets,
    } as never, "transport-key");

    const result = await client.callTool({
      name: "get_project_environment_secrets",
      arguments: { projectId: "project_1", names: ["HT_GIT_TOKEN"] },
    });

    expect(resolveProjectEnvironmentSecrets).toHaveBeenCalledWith({
      projectId: "project_1",
      names: ["HT_GIT_TOKEN"],
      actorUserId: "user_1",
    });
    expect(result.structuredContent).toMatchObject({ envelope: { algorithm: "AES-256-GCM" } });
    expect(result.structuredContent).not.toEqual({ secrets: { HT_GIT_TOKEN: "secret-value" } });
  });

  it("registers dedicated Task cancellation and deadline tools", async () => {
    const changeUserTaskStatus = vi.fn().mockResolvedValue({ taskId: "task_1", statusCategory: "cancelled", version: 3 });
    const updateUserTaskSchedule = vi.fn().mockResolvedValue({ taskId: "task_2", dueAt: new Date("2026-08-31T12:00:00.000Z"), version: 4 });
    const client = await connectServer({
      listWorkbenchSpaces: vi.fn().mockResolvedValue([]),
      changeUserTaskStatus,
      updateUserTaskSchedule,
    } as never);

    await client.callTool({ name: "cancel_task", arguments: { commandId: "cmd_cancel", taskId: "task_1", expectedVersion: 2, reason: "停止交付" } });
    await client.callTool({ name: "update_task_schedule", arguments: { commandId: "cmd_due", taskId: "task_2", expectedVersion: 3, dueAt: "2026-08-31T12:00:00.000Z" } });

    expect(changeUserTaskStatus).toHaveBeenCalledWith(expect.objectContaining({ command: "cancel", reason: "停止交付" }));
    expect(updateUserTaskSchedule).toHaveBeenCalledWith(expect.objectContaining({ dueAt: new Date("2026-08-31T12:00:00.000Z") }));
  });

  it("routes natural Task schedule and cancellation arguments through MCP", async () => {
    const getTaskDetailView = vi.fn().mockResolvedValue({
      task: { id: "task_1", shortId: "HT100001", version: 2 },
      capabilities: { edit: true },
    });
    const updateUserTaskSchedule = vi.fn().mockResolvedValue({ taskId: "task_1", dueAt: new Date("2026-08-31T12:00:00.000Z"), version: 3 });
    const changeUserTaskStatus = vi.fn().mockResolvedValue({ taskId: "task_1", statusCategory: "cancelled", version: 4 });
    const client = await connectServer({
      listWorkbenchSpaces: vi.fn().mockResolvedValue([]),
      getTaskDetailView,
      updateUserTaskSchedule,
      changeUserTaskStatus,
    } as never);

    await client.callTool({
      name: "update_task",
      arguments: { shortId: "HT100001", expectedVersion: 2, dueAt: "2026-08-31T12:00:00.000Z" },
    });
    await client.callTool({
      name: "cancel_task",
      arguments: { shortId: "HT100001", expectedVersion: 3, reason: "停止交付" },
    });

    expect(updateUserTaskSchedule).toHaveBeenCalledWith(expect.objectContaining({ taskId: "task_1" }));
    expect(changeUserTaskStatus).toHaveBeenCalledWith(expect.objectContaining({ taskId: "task_1", command: "cancel" }));
  });

  it("opens a workflow interaction as the authenticated credential's delegated Agent", async () => {
    const openRequirementConversation = vi.fn().mockResolvedValue({
      interactionId: "interaction_1",
      messageId: "message_1",
      sequence: 1,
      version: 1,
    });
    const resolveActiveAttemptIdentity = vi.fn().mockResolvedValue({
      agentRunId: "agent_run_1",
      loopRunId: "loop_run_1",
      loopNodeRunId: "node_run_1",
    });
    const client = await connectServer({
      listWorkbenchSpaces: vi.fn().mockResolvedValue([]),
      openRequirementConversation,
      resolveActiveAttemptIdentity,
    });

    const result = await client.callTool({
      name: "open_workflow_interaction",
      arguments: {
        commandId: "cmd_question",
        loopNodeAttemptId: "loop_attempt_1",
        body: "是否需要人工确认？",
      },
    });

    expect(openRequirementConversation).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: "user_1",
      actor: { type: "agent", id: "mcp:user_1", runId: "agent_run_1" },
      loopNodeRunId: "node_run_1",
      expectedLoopRunId: "loop_run_1",
    }));
    expect(resolveActiveAttemptIdentity).toHaveBeenCalledWith("loop_attempt_1");
    expect(result.structuredContent).toEqual(expect.objectContaining({
      interactionId: "interaction_1",
      path: "/loop-runs/loop_run_1?interaction=interaction_1",
    }));
  });

  it("appends a workflow message without exposing aggregate version locking", async () => {
    const appendRequirementMessage = vi.fn().mockResolvedValue({
      interactionId: "interaction_1",
      messageId: "message_2",
      sequence: 2,
      version: 1,
    });
    const client = await connectServer({
      listWorkbenchSpaces: vi.fn().mockResolvedValue([]),
      appendRequirementMessage,
    });

    const tools = await client.listTools();
    const appendTool = tools.tools.find((tool) => tool.name === "append_workflow_interaction_message");
    expect(appendTool?.inputSchema).not.toHaveProperty("properties.expectedVersion");

    await client.callTool({
      name: "append_workflow_interaction_message",
      arguments: {
        interactionId: "interaction_1",
        loopRunId: "loop_run_1",
        commandId: "cmd_reply",
        body: "补充现有迁移路径。",
      },
    });

    expect(appendRequirementMessage).toHaveBeenCalledWith(expect.objectContaining({
      interactionId: "interaction_1",
      commandId: "cmd_reply",
    }));
    expect(appendRequirementMessage.mock.calls[0]?.[0]).not.toHaveProperty("expectedVersion");
  });

  it("lists and moves documents through path-based tree tools", async () => {
    const listWorkbenchDocumentTargetTree = vi.fn().mockResolvedValue({
      spaceId: "space_1",
      groups: [{ key: "project:project_1", directories: [], documents: [] }],
      trash: [],
    });
    const moveWorkbenchDocument = vi.fn().mockResolvedValue({
      id: "doc_1",
      path: "需求文档/主题/设计.md",
      version: 1,
    });
    const client = await connectServer({
      listWorkbenchSpaces: vi.fn().mockResolvedValue([]),
      listWorkbenchDocumentTargetTree,
      moveWorkbenchDocument,
    });

    const listed = await client.callTool({
      name: "list_document_tree",
      arguments: { spaceId: "space_1", projectId: "project_1" },
    });
    const moved = await client.callTool({
      name: "move_document",
      arguments: { documentId: "doc_1", targetPath: "需求文档/主题/设计.md" },
    });

    expect(listWorkbenchDocumentTargetTree).toHaveBeenCalledWith({
      userId: "user_1",
      spaceId: "space_1",
      projectId: "project_1",
    });
    expect(moveWorkbenchDocument).toHaveBeenCalledWith({
      userId: "user_1",
      documentId: "doc_1",
      targetPath: "需求文档/主题/设计.md",
      sortOrder: 0,
    });
    expect(listed.structuredContent).toEqual({
      tree: expect.objectContaining({ spaceId: "space_1" }),
    });
    expect(moved.structuredContent).toEqual({
      document: expect.objectContaining({ version: 1 }),
    });
  });

  it("calls Task tools with the authenticated credential actor", async () => {
    const createUserTask = vi.fn().mockResolvedValue({ taskId: "task_1", statusCategory: "todo", version: 1 });
    const client = await connectServer({
      listWorkbenchSpaces: vi.fn().mockResolvedValue([]),
      createUserTask,
    });
    const result = await client.callTool({ name: "create_task", arguments: {
      commandId: "cmd_task_1", spaceId: "space_1", title: "发布清单", contentMarkdown: "# 验收",
    } });
    expect(createUserTask).toHaveBeenCalledWith(expect.objectContaining({ actor: { type: "user", id: "user_1" } }));
    expect(result.structuredContent).toEqual({ result: expect.objectContaining({ taskId: "task_1" }) });
  });

  it("registers and calls assign_task_branch while development modes are enabled", async () => {
    vi.stubEnv("HUMANTHREAD_DEVELOPMENT_MODES", "true");
    const assignTaskBranch = vi.fn().mockResolvedValue({ taskId: "task_1", taskBranch: "2026-HT100023", version: 4 });
    const client = await connectServer({
      listWorkbenchSpaces: vi.fn().mockResolvedValue([]),
      assignTaskBranch,
    });

    expect((await client.listTools()).tools.map((tool) => tool.name)).toContain("assign_task_branch");
    await client.callTool({
      name: "assign_task_branch",
      arguments: { commandId: "cmd_branch", taskId: "task_1", expectedVersion: 3, branch: "caller-value" },
    });
    expect(assignTaskBranch).toHaveBeenCalledWith(expect.objectContaining({
      actor: { type: "user", id: "user_1" },
      taskId: "task_1",
      expectedVersion: 3,
    }));
  });

  it("submits acceptance evidence through the authenticated MCP tool", async () => {
    const submitTaskAcceptanceEvidence = vi.fn().mockResolvedValue({
      taskId: "task_1",
      evidenceId: "evidence_1",
      version: 5,
      readiness: { ready: true },
    });
    const client = await connectServer({
      listWorkbenchSpaces: vi.fn().mockResolvedValue([]),
      submitTaskAcceptanceEvidence,
    });
    const result = await client.callTool({
      name: "submit_task_acceptance_evidence",
      arguments: {
        commandId: "cmd_evidence_1",
        taskId: "task_1",
        expectedVersion: 4,
        checkKey: "delivery",
        status: "passed",
        summary: "正式环境验收通过",
        evidenceMarkdown: "image@sha256:abc",
        finishedAt: "2026-08-01T09:05:00.000Z",
      },
    });

    expect(submitTaskAcceptanceEvidence).toHaveBeenCalledWith(expect.objectContaining({
      actor: { type: "user", id: "user_1" },
      source: "mcp",
      checkKey: "delivery",
      status: "passed",
      finishedAt: new Date("2026-08-01T09:05:00.000Z"),
    }));
    expect(result.structuredContent).toEqual({
      result: expect.objectContaining({ evidenceId: "evidence_1", readiness: { ready: true } }),
    });
  });

  it("propagates the credential actor into space discovery", async () => {
    const listWorkbenchSpaces = vi.fn().mockResolvedValue([
      { id: "space:personal:user_1", name: "Personal", type: "personal", role: "owner" },
    ]);
    const client = await connectServer({ listWorkbenchSpaces });

    const result = await client.callTool({ name: "list_spaces", arguments: {} });

    expect(listWorkbenchSpaces).toHaveBeenCalledWith({ userId: "user_1" });
    expect(result.structuredContent).toEqual({
      spaces: expect.arrayContaining([
        expect.objectContaining({ id: "space:personal:user_1" }),
      ]),
    });
  });

  it("creates a root document through the shared workbench service", async () => {
    const createWorkbenchSpaceDocument = vi.fn().mockResolvedValue({
      id: "doc_root",
      version: 1,
    });
    const client = await connectServer({
      listWorkbenchSpaces: vi.fn().mockResolvedValue([]),
      createWorkbenchSpaceDocument,
    });

    await client.callTool({
      name: "create_document",
      arguments: {
        spaceId: "space:company:company_1",
        title: "Policy",
        path: "policy.md",
        contentMarkdown: "# Policy",
      },
    });

    expect(createWorkbenchSpaceDocument).toHaveBeenCalledWith({
      spaceId: "space:company:company_1",
      userId: "user_1",
      title: "Policy",
      path: "policy.md",
      contentMarkdown: "# Policy",
      source: "mcp",
    });
  });

  it("passes the declared space into project document creation", async () => {
    const createWorkbenchDocument = vi.fn().mockResolvedValue({ id: "doc_1", version: 1 });
    const client = await connectServer({
      listWorkbenchSpaces: vi.fn().mockResolvedValue([]),
      createWorkbenchDocument,
    });

    await client.callTool({
      name: "create_document",
      arguments: {
        spaceId: "space:company:company_1",
        projectId: "project_1",
        title: "README",
        path: "README.md",
        contentMarkdown: "# README",
      },
    });

    expect(createWorkbenchDocument).toHaveBeenCalledWith(
      expect.objectContaining({ spaceId: "space:company:company_1" }),
    );
  });

  it("uploads a base64 document attachment through the shared protected service", async () => {
    const saveWorkbenchDocumentAttachment = vi.fn().mockResolvedValue({
      id: "attachment_1",
      originalName: "roadmap.xmind",
      mimeType: "application/vnd.xmind.workbook",
      byteSize: 3,
      markdownUrl: "/api/document-attachments/attachment_1",
    });
    const client = await connectServer({
      listWorkbenchSpaces: vi.fn().mockResolvedValue([]),
      saveWorkbenchDocumentAttachment,
    });

    const result = await client.callTool({
      name: "upload_document_attachment",
      arguments: {
        documentId: "doc_1",
        fileName: "roadmap.xmind",
        mimeType: "application/vnd.xmind.workbook",
        contentBase64: Buffer.from([1, 2, 3]).toString("base64"),
      },
    });

    const call = saveWorkbenchDocumentAttachment.mock.calls[0]?.[0];
    expect(call).toMatchObject({ userId: "user_1", documentId: "doc_1" });
    expect(call.file).toBeInstanceOf(File);
    expect(Buffer.from(await call.file.arrayBuffer())).toEqual(Buffer.from([1, 2, 3]));
    expect(result.structuredContent).toEqual({
      attachment: expect.objectContaining({ markdownUrl: "/api/document-attachments/attachment_1" }),
    });
  });
});

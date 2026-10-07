import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { readFileSync } from "node:fs";
import {
  createMariaDbConnectionString,
  createPrismaClient,
  createPrismaClientOptions,
  resolveDatabaseUrl,
} from "./prisma";

describe("prisma runtime client configuration", () => {
  it("stores only active LiveSession control metadata without terminal content", () => {
    const schema = readFileSync(
      new URL("../../../prisma/schema.prisma", import.meta.url),
      "utf8",
    );
    const liveSessionSchema = schema.match(/model LiveSession \{[\s\S]*?\n\}/u)?.[0] ?? "";

    expect(liveSessionSchema).toMatch(/id\s+String\s+@id\s+@db\.Char\(32\)/u);
    expect(liveSessionSchema).toMatch(/kind\s+String\s+@db\.VarChar\(16\)/u);
    expect(liveSessionSchema).toMatch(/targetType\s+String\s+@db\.VarChar\(24\)/u);
    expect(liveSessionSchema).toMatch(/targetWorkerPoolId\s+String\?\s+@db\.Char\(32\)/u);
    expect(liveSessionSchema).toMatch(/journalStatus\s+String\s+@db\.VarChar\(24\)/u);
    expect(liveSessionSchema).toMatch(/@@index\(\[ownerUserId, status, updatedAt\]\)/u);
    expect(liveSessionSchema).not.toMatch(/contentMarkdown|terminalOutput|replayPayload|transcript|messageBody/u);
  });

  it("indexes the stable Agent Run history pagination order", () => {
    const schema = readFileSync(
      new URL("../../../prisma/schema.prisma", import.meta.url),
      "utf8",
    );
    const agentRunSchema = schema.match(/model AgentRun \{[\s\S]*?\n\}/u)?.[0] ?? "";

    expect(agentRunSchema).toMatch(/@@index\(\[createdAt, id\]\)/u);
  });

  it("stores the optional Local Agent build version on Workers", () => {
    const schema = readFileSync(new URL("../../../prisma/schema.prisma", import.meta.url), "utf8");
    const workerSchema = schema.match(/model AgentWorker \{[\s\S]*?\n\}/u)?.[0] ?? "";
    expect(workerSchema).toMatch(/agentVersion\s+String\?\s+@db\.VarChar\(64\)/u);
  });

  it("persists Worker model sites and explicit Project Loop execution bindings", () => {
    const schema = readFileSync(new URL("../../../prisma/schema.prisma", import.meta.url), "utf8");
    const siteSchema = schema.match(/model WorkerModelSite \{[\s\S]*?\n\}/u)?.[0] ?? "";
    const bindingSchema = schema.match(/model ProjectLoopBinding \{[\s\S]*?\n\}/u)?.[0] ?? "";
    const projectSchema = schema.match(/model Project \{[\s\S]*?\n\}/u)?.[0] ?? "";
    const imageSourceSchema = schema.match(/model WorkerImageSource \{[\s\S]*?\n\}/u)?.[0] ?? "";
    const imageVersionSchema = schema.match(/model WorkerImageVersion \{[\s\S]*?\n\}/u)?.[0] ?? "";
    const validationSchema = schema.match(/model WorkerValidationChallenge \{[\s\S]*?\n\}/u)?.[0] ?? "";
    const sessionSchema = schema.match(/model WorkerPoolSession \{[\s\S]*?\n\}/u)?.[0] ?? "";

    expect(siteSchema).toMatch(/id\s+String\s+@id\s+@db\.Char\(32\)/u);
    expect(siteSchema).toMatch(/apiKeyEncrypted\s+String\s+@db\.Text/u);
    expect(bindingSchema).toMatch(/workerPoolId\s+String\?\s+@db\.Char\(32\)/u);
    expect(bindingSchema).toMatch(/workerRepositoryUrl\s+String\?\s+@db\.VarChar\(1024\)/u);
    expect(projectSchema).toMatch(/workerImageRepository\s+String\?\s+@db\.VarChar\(1024\)/u);
    expect(projectSchema).toMatch(/workerImageTag\s+String\?\s+@db\.VarChar\(191\)/u);
    expect(projectSchema).toMatch(/workerImageDigest\s+String\?\s+@db\.Char\(71\)/u);
    expect(projectSchema).toMatch(/workerImageVersionId\s+String\?\s+@db\.Char\(32\)/u);
    expect(projectSchema).toMatch(/workerDeploymentConfiguration\s+Json\?/u);
    expect(imageSourceSchema).toMatch(/id\s+String\s+@id\s+@db\.Char\(32\)/u);
    expect(imageSourceSchema).toMatch(/repository\s+String\s+@db\.VarChar\(767\)/u);
    expect(imageVersionSchema).toMatch(/digest\s+String\s+@unique\s+@db\.Char\(71\)/u);
    expect(validationSchema).toMatch(/id\s+String\s+@id\s+@db\.Char\(32\)/u);
    expect(validationSchema).toMatch(/@@index\(\[projectId, workerPoolId, status, expiresAt\], map: "WVC_project_pool_status_expires_idx"\)/u);
    expect(validationSchema).toMatch(/@@index\(\[workerPoolId, workerPoolSessionId, status, expiresAt\], map: "WVC_pool_session_status_expires_idx"\)/u);
    expect(sessionSchema).toMatch(/runtime\s+String\s+@default\("docker"\)\s+@db\.VarChar\(32\)/u);
    expect(sessionSchema).toMatch(/taskGroupName\s+String\?\s+@db\.VarChar\(191\)/u);
    expect(bindingSchema).toMatch(/workerStageConfigurations\s+Json\?/u);
  });

  it("scopes Worker image sources to the platform or one company", () => {
    const schema = readFileSync(new URL("../../../prisma/schema.prisma", import.meta.url), "utf8");
    const sourceSchema = schema.match(/model WorkerImageSource \{[\s\S]*?\n\}/u)?.[0] ?? "";
    const companySchema = schema.match(/model Company \{[\s\S]*?\n\}/u)?.[0] ?? "";

    expect(sourceSchema).toMatch(/ownerType\s+String\s+@default\("platform"\)\s+@db\.VarChar\(32\)/u);
    expect(sourceSchema).toMatch(/companyId\s+String\?\s+@db\.VarChar\(64\)/u);
    expect(sourceSchema).not.toMatch(/@@unique\(\[repository\]\)/u);
    expect(sourceSchema).toMatch(/@@index\(\[ownerType, companyId, status, updatedAt\], map: "WIS_scope_status_updated_idx"\)/u);
    expect(companySchema).toMatch(/workerImageSources\s+WorkerImageSource\[\]/u);
  });

  it("stores project-owned Loop group configuration separately from the template", () => {
    const schema = readFileSync(new URL("../../../prisma/schema.prisma", import.meta.url), "utf8");
    const projectSchema = schema.match(/model Project \{[\s\S]*?\n\}/u)?.[0] ?? "";
    expect(projectSchema).toMatch(/loopGroupConfig\s+Json\?/u);
  });

  it("stores project environment metadata and an independent configuration version", () => {
    const schema = readFileSync(new URL("../../../prisma/schema.prisma", import.meta.url), "utf8");
    const projectSchema = schema.match(/model Project \{[\s\S]*?\n\}/u)?.[0] ?? "";
    expect(projectSchema).toMatch(/environmentConfiguration\s+Json\?/u);
    expect(projectSchema).toMatch(/environmentConfigurationVersion\s+Int\s+@default\(1\)/u);
    expect(projectSchema).toMatch(/repositoryConfiguration\s+Json\?/u);
  });

  it("stores project environment secret material separately as encrypted ciphertext", () => {
    const schema = readFileSync(new URL("../../../prisma/schema.prisma", import.meta.url), "utf8");
    const secretSchema = schema.match(/model ProjectEnvironmentSecret \{[\s\S]*?\n\}/u)?.[0] ?? "";
    expect(secretSchema).toMatch(/id\s+String\s+@id\s+@db\.Char\(32\)/u);
    expect(secretSchema).toMatch(/projectDigest\s+String\s+@db\.Char\(32\)/u);
    expect(secretSchema).toMatch(/encryptedValue\s+String\s+@db\.Text/u);
    expect(secretSchema).toMatch(/valueFingerprint\s+String\s+@db\.Char\(64\)/u);
    expect(secretSchema).toMatch(/@@unique\(\[projectDigest, name\]\)/u);
  });

  it("persists one child LoopRun per parent node activation", () => {
    const schema = readFileSync(
      new URL("../../../prisma/schema.prisma", import.meta.url),
      "utf8",
    );
    const loopRunSchema = schema.match(/model LoopRun \{[\s\S]*?\n\}/u)?.[0] ?? "";

    expect(loopRunSchema).toMatch(/parentLoopRunId\s+String\?/u);
    expect(loopRunSchema).toMatch(/parentNodeRunId\s+String\?/u);
    expect(loopRunSchema).toMatch(/parentAttemptId\s+String\?/u);
    expect(loopRunSchema).toMatch(/parentLoopRun\s+LoopRun\?\s+@relation\("LoopRunChildren"/u);
    expect(loopRunSchema).toMatch(/childLoopRuns\s+LoopRun\[\]\s+@relation\("LoopRunChildren"\)/u);
    expect(loopRunSchema).toMatch(/@@unique\(\[parentNodeRunId\]\)/u);
    expect(loopRunSchema).toMatch(/@@index\(\[parentLoopRunId, status\]\)/u);
  });

  it("stores nullable immutable graph snapshot identity on LoopRun", () => {
    const schema = readFileSync(
      new URL("../../../prisma/schema.prisma", import.meta.url),
      "utf8",
    );
    const loopRunSchema = schema.match(/model LoopRun \{[\s\S]*?\n\}/u)?.[0] ?? "";

    expect(loopRunSchema).toMatch(/runGraphSnapshot\s+Json\?/u);
    expect(loopRunSchema).toMatch(/graphDigest\s+String\?\s+@db\.VarChar\(80\)/u);
    expect(loopRunSchema).toMatch(/snapshotVersion\s+Int\?/u);
    expect(loopRunSchema).toMatch(/@@index\(\[graphDigest, status\]\)/u);
  });

  it("exposes the user task model and compatibility fields", () => {
    const schema = readFileSync(
      new URL("../../../prisma/schema.prisma", import.meta.url),
      "utf8",
    );
    const modelNames = Prisma.dmmf.datamodel.models.map((model) => model.name);

    expect(modelNames).toEqual(
      expect.arrayContaining([
        "TaskMember",
        "TaskStatusDefinition",
        "TaskSavedView",
        "TaskBlocker",
        "TaskComment",
        "TaskActivity",
        "TaskLabel",
        "TaskLabelAssignment",
        "TaskDocumentLink",
        "TaskAttachment",
        "TaskReminder",
        "TaskWorkflowLink",
      ]),
    );

    const taskModel = Prisma.dmmf.datamodel.models.find(
      (model) => model.name === "Task",
    );
    const taskSchema = schema.match(/model Task \{[\s\S]*?\n\}/u)?.[0] ?? "";
    expect(taskModel?.fields.map((field) => field.name)).toEqual(
      expect.arrayContaining([
        "spaceId",
        "createdById",
        "statusCategory",
        "statusDefinitionId",
        "visibility",
        "contentMarkdown",
        "startAt",
        "dueAt",
        "acceptanceMode",
        "acceptanceReviewerId",
        "archivedAt",
        "recurrenceRule",
      ]),
    );
    expect(taskSchema).toMatch(/spaceId\s+String\s+@db\.VarChar\(96\)/u);
    expect(taskSchema).toMatch(/createdById\s+String\s+@db\.VarChar\(64\)/u);
    expect(taskSchema).toMatch(/statusCategory\s+String\s+@db\.VarChar\(32\)/u);
    expect(taskSchema).toMatch(/visibility\s+String\s+@db\.VarChar\(16\)/u);
    expect(taskSchema).toMatch(/contentMarkdown\s+String\s+@db\.LongText/u);
    expect(taskSchema).toMatch(/acceptanceMode\s+String\s+@db\.VarChar\(16\)/u);
    expect(taskSchema).toMatch(/space\s+Space\s+@relation/u);
    expect(taskSchema).toMatch(/createdBy\s+User\s+@relation\("TaskCreatedBy"/u);

    expect(schema).toMatch(/model TaskMember[\s\S]*@@unique\(\[taskId, userId\]\)/u);
    expect(schema).toMatch(
      /model TaskStatusDefinition[\s\S]*@@unique\(\[spaceId, scopeKey, key\]\)/u,
    );
    expect(schema).toMatch(/model TaskSavedView[\s\S]*@@unique\(\[userId, name\]\)/u);
    expect(schema).toMatch(/model TaskLabel[\s\S]*@@unique\(\[spaceId, name\]\)/u);
    expect(schema).toMatch(
      /model TaskLabelAssignment[\s\S]*@@unique\(\[taskId, labelId\]\)/u,
    );
    expect(schema).toMatch(/model TaskReminder[\s\S]*@@index\(\[status, remindAt\]\)/u);
    expect(schema).toMatch(/model TaskAttachment[\s\S]*storageKey\s+String\s+@unique/u);

    expect(schema).toMatch(/workflowInstanceId\s+String\?/u);
    expect(schema).toMatch(/projectId\s+String\?/u);
    expect(schema).toMatch(/stepTemplateId\s+String\?/u);
    expect(schema).toMatch(/workflowInstance\s+WorkflowInstance\?/u);
    expect(schema).toMatch(/project\s+Project\?/u);
    expect(schema).toMatch(/stepTemplate\s+WorkflowStepTemplate\?/u);
  });

  it("exposes company, project membership, document and MCP credential models", () => {
    const modelNames = Prisma.dmmf.datamodel.models.map((model) => model.name);

    expect(modelNames).toEqual(
      expect.arrayContaining([
        "Company",
        "CompanyMember",
        "CompanyInvitation",
        "ProjectMember",
        "Document",
        "DocumentDirectory",
        "DocumentAttachment",
        "DocumentRevision",
        "McpCredential",
      ]),
    );

    expect(modelNames).toContain("Space");
    expect(modelNames).not.toContain("ProjectDocument");

    const invitationModel = Prisma.dmmf.datamodel.models.find(
      (model) => model.name === "CompanyInvitation",
    );
    expect(invitationModel?.fields.map((field) => field.name)).toEqual(
      expect.arrayContaining([
        "companyId",
        "email",
        "role",
        "status",
        "invitedById",
        "expiresAt",
        "acceptedById",
      ]),
    );

    const documentModel = Prisma.dmmf.datamodel.models.find(
      (model) => model.name === "Document",
    );
    expect(documentModel?.fields.map((field) => field.name)).toEqual(
      expect.arrayContaining([
        "id",
        "spaceId",
        "projectId",
        "containerKey",
        "directoryId",
        "sortOrder",
        "deletedAt",
        "deletedById",
        "deletedFromPath",
        "deletedFromDirectoryId",
        "contentMarkdown",
        "version",
        "revisions",
        "attachments",
      ]),
    );

    const directoryModel = Prisma.dmmf.datamodel.models.find(
      (model) => model.name === "DocumentDirectory",
    );
    expect(directoryModel?.fields.map((field) => field.name)).toEqual(
      expect.arrayContaining([
        "spaceId",
        "projectId",
        "containerKey",
        "parentId",
        "name",
        "path",
        "sortOrder",
        "documents",
        "children",
      ]),
    );

    const attachmentModel = Prisma.dmmf.datamodel.models.find(
      (model) => model.name === "DocumentAttachment",
    );
    expect(attachmentModel?.fields.map((field) => field.name)).toEqual(
      expect.arrayContaining([
        "documentId",
        "storageKey",
        "originalName",
        "mimeType",
        "byteSize",
        "uploadedById",
        "deletedAt",
      ]),
    );

    const spaceModel = Prisma.dmmf.datamodel.models.find(
      (model) => model.name === "Space",
    );
    expect(spaceModel?.fields.map((field) => field.name)).toEqual(
      expect.arrayContaining([
        "id",
        "type",
        "ownerUserId",
        "companyId",
        "status",
        "projects",
      ]),
    );

    const projectModel = Prisma.dmmf.datamodel.models.find(
      (model) => model.name === "Project",
    );
    expect(projectModel?.fields.map((field) => field.name)).toContain("spaceId");
  });

  it("exposes immutable workflow interaction relations and activation indexes", () => {
    const schema = readFileSync(
      new URL("../../../prisma/schema.prisma", import.meta.url),
      "utf8",
    );
    const modelNames = Prisma.dmmf.datamodel.models.map((model) => model.name);
    const interactionModel = Prisma.dmmf.datamodel.models.find(
      (model) => model.name === "WorkflowInteraction",
    );

    expect(modelNames).toEqual(expect.arrayContaining([
      "WorkflowInteraction",
      "WorkflowInteractionMessage",
      "WorkflowInteractionAttachment",
      "WorkflowInteractionMention",
      "WorkflowInteractionDecision",
    ]));
    expect(interactionModel?.fields.find((field) => field.name === "messageSequence")).toMatchObject({ type: "Int" });
    expect(schema).toMatch(/messageSequence\s+Int\s+@default\(0\)/u);
    expect(schema).toMatch(
      /model WorkflowInteraction[\s\S]*@@unique\(\[loopNodeRunId, activationNo, kind\]\)/u,
    );
    expect(schema).toMatch(
      /model WorkflowInteraction[\s\S]*@@index\(\[loopRunId, status, createdAt\]\)/u,
    );
    expect(schema).toMatch(
      /model WorkflowInteraction[\s\S]*@@index\(\[projectId, taskId, createdAt\]\)/u,
    );
    expect(schema).toMatch(
      /model WorkflowInteractionMessage[\s\S]*@@unique\(\[interactionId, sequence\]\)/u,
    );
    expect(schema).toMatch(
      /model WorkflowInteractionMessage[\s\S]*@@unique\(\[interactionId, commandId\]\)/u,
    );
    expect(schema).toMatch(
      /model WorkflowInteractionDecision[\s\S]*interactionId\s+String\s+@unique/u,
    );
  });

  it("exposes durable single-use desktop Web handoff fields", () => {
    const schema = readFileSync(
      new URL("../../../prisma/schema.prisma", import.meta.url),
      "utf8",
    );
    const handoffModel = Prisma.dmmf.datamodel.models.find(
      (model) => model.name === "DesktopWebHandoff",
    );
    const handoffSchema = schema.match(
      /model DesktopWebHandoff \{[\s\S]*?\n\}/u,
    )?.[0] ?? "";

    expect(handoffModel?.fields.map((field) => field.name)).toEqual(
      expect.arrayContaining([
        "codeHash",
        "sessionId",
        "targetPath",
        "expiresAt",
        "consumedAt",
      ]),
    );
    expect(handoffSchema).toMatch(/codeHash\s+String\s+@unique/u);
    expect(handoffSchema).toMatch(/session\s+DesktopSession\s+@relation/u);
  });

  it("builds adapter-backed Prisma client options for mysql", () => {
    const options = createPrismaClientOptions(
      "mysql://user:password@127.0.0.1:3306/humanthread",
    );

    expect(options.log).toEqual(["warn", "error"]);
    expect(options.adapter).toMatchObject({
      provider: "mysql",
      adapterName: expect.any(String),
    });
  });

  it("adds explicit conservative MariaDB pool defaults", () => {
    const configured = new URL(
      createMariaDbConnectionString(
        "mysql://user:password@127.0.0.1:3306/humanthread",
      ),
    );

    expect(Object.fromEntries(configured.searchParams)).toMatchObject({
      allowPublicKeyRetrieval: "true",
      connectionLimit: "10",
      minimumIdle: "1",
      connectTimeout: "3000",
      acquireTimeout: "10000",
      initializationTimeout: "10000",
      idleTimeout: "300",
    });
  });

  it("preserves explicit pool and unrelated database URL options", () => {
    const configured = new URL(
      createMariaDbConnectionString(
        "mysql://user:password@127.0.0.1:3306/humanthread" +
          "?connectionLimit=4&minimumIdle=0&connectTimeout=7000&ssl=true",
      ),
    );

    expect(configured.searchParams.get("connectionLimit")).toBe("4");
    expect(configured.searchParams.get("minimumIdle")).toBe("0");
    expect(configured.searchParams.get("connectTimeout")).toBe("7000");
    expect(configured.searchParams.get("ssl")).toBe("true");
    expect(configured.searchParams.get("acquireTimeout")).toBe("10000");
  });

  it("preserves an explicit MariaDB public key retrieval override", () => {
    const configured = new URL(
      createMariaDbConnectionString(
        "mysql://user:password@127.0.0.1:3306/humanthread" +
          "?allowPublicKeyRetrieval=false",
      ),
    );

    expect(configured.searchParams.get("allowPublicKeyRetrieval")).toBe("false");
  });

  it("constructs a Prisma client with a MariaDB adapter", () => {
    const client = createPrismaClient(
      "mysql://user:password@127.0.0.1:3306/humanthread",
    );

    expect(client).toBeDefined();
    expect(typeof client.$disconnect).toBe("function");
  });

  it.each([
    {
      name: "mixed legacy and graph identities",
      taskId: "task_1",
      loopNodeRunId: "loop_node_run_1",
    },
    {
      name: "unscoped identities",
      taskId: null,
      loopNodeRunId: null,
    },
  ])("rejects raw AgentRun $name through the supported client", async ({
    taskId,
    loopNodeRunId,
  }) => {
    const client = createPrismaClient(
      "mysql://user:password@127.0.0.1:3306/humanthread",
    );

    try {
      await expect(
        client.agentRun.create({
          data: {
            id: `run_${taskId ?? "none"}_${loopNodeRunId ?? "none"}`,
            taskId,
            loopNodeRunId,
            attempt: 1,
            agentProfileId: "profile_1",
            status: "queued",
            inputSnapshot: {},
          },
        }),
      ).rejects.toMatchObject({ code: "invalid_agent_run_identity" });
    } finally {
      await client.$disconnect();
    }
  }, 15_000);

  it.each([
    {
      name: "mixed legacy and graph identities",
      taskId: "task_1",
      loopNodeRunId: "loop_node_run_1",
    },
    {
      name: "unscoped identities",
      taskId: null,
      loopNodeRunId: null,
    },
  ])("rejects raw AgentRun createMany $name through the supported client", async ({
    taskId,
    loopNodeRunId,
  }) => {
    const client = createPrismaClient(
      "mysql://user:password@127.0.0.1:3306/humanthread",
    );

    try {
      await expect(
        client.agentRun.createMany({
          data: {
            id: `runs_${taskId ?? "none"}_${loopNodeRunId ?? "none"}`,
            taskId,
            loopNodeRunId,
            attempt: 1,
            agentProfileId: "profile_1",
            status: "queued",
            inputSnapshot: {},
          },
        }),
      ).rejects.toMatchObject({ code: "invalid_agent_run_identity" });
    } finally {
      await client.$disconnect();
    }
  }, 15_000);

  it.each([
    { operation: "create", taskId: "task_1", loopNodeRunId: "loop_node_run_1" },
    { operation: "create", taskId: null, loopNodeRunId: null },
    { operation: "update", taskId: "task_1", loopNodeRunId: "loop_node_run_1" },
    { operation: "update", taskId: null, loopNodeRunId: null },
    { operation: "upsert", taskId: "task_1", loopNodeRunId: "loop_node_run_1" },
    { operation: "upsert", taskId: null, loopNodeRunId: null },
  ] as const)("rejects nested AgentRun $operation with task=$taskId node=$loopNodeRunId before database I/O", async ({
    operation,
    taskId,
    loopNodeRunId,
  }) => {
    const client = createPrismaClient(
      "mysql://user:password@127.0.0.1:1/humanthread?connectTimeout=100&initializationTimeout=100&acquireTimeout=100",
    );
    const id = `nested_${operation}_${taskId ?? "none"}_${loopNodeRunId ?? "none"}`;
    const agentRun = {
      id: `${id}_agent`,
      taskId,
      loopNodeRunId,
      attempt: 1,
      agentProfileId: "profile_1",
      status: "queued",
      inputSnapshot: {},
    };

    try {
      const request = operation === "create"
        ? client.loopRun.create({
            data: {
              id,
              status: "running",
              policySnapshot: {},
              budgetSnapshot: {},
              usageAggregate: {},
              agentRuns: { create: agentRun },
            },
          } as never)
        : operation === "update"
          ? client.loopRun.update({
              where: { id },
              data: { agentRuns: { create: agentRun } },
            } as never)
          : client.loopRun.upsert({
              where: { id },
              create: {
                id,
                status: "running",
                policySnapshot: {},
                budgetSnapshot: {},
                usageAggregate: {},
              },
              update: { agentRuns: { create: agentRun } },
            } as never);

      await expect(request).rejects.toMatchObject({ code: "invalid_agent_run_identity" });
    } finally {
      await client.$disconnect();
    }
  }, 15_000);

  it.each([
    {
      name: "mixed legacy and graph identities",
      taskId: "task_1",
      loopNodeRunId: "loop_node_run_1",
    },
    {
      name: "unscoped identities",
      taskId: null,
      loopNodeRunId: null,
    },
  ])("rejects raw AgentRun upsert creation for $name through the supported client", async ({
    taskId,
    loopNodeRunId,
  }) => {
    const client = createPrismaClient(
      "mysql://user:password@127.0.0.1:3306/humanthread",
    );

    try {
      await expect(
        client.agentRun.upsert({
          where: { id: `upsert_${taskId ?? "none"}_${loopNodeRunId ?? "none"}` },
          create: {
            id: `upsert_${taskId ?? "none"}_${loopNodeRunId ?? "none"}`,
            taskId,
            loopNodeRunId,
            attempt: 1,
            agentProfileId: "profile_1",
            status: "queued",
            inputSnapshot: {},
          },
          update: { status: "queued" },
        }),
      ).rejects.toMatchObject({ code: "invalid_agent_run_identity" });
    } finally {
      await client.$disconnect();
    }
  }, 15_000);

  it("rejects an empty database url", () => {
    expect(() => createPrismaClientOptions("")).toThrowError(
      "DATABASE_URL is required to initialize Prisma runtime access.",
    );
  });

  it("reads the database url from the environment", () => {
    const originalDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "mysql://env:password@127.0.0.1:3306/humanthread";

    try {
      expect(resolveDatabaseUrl()).toBe(
        "mysql://env:password@127.0.0.1:3306/humanthread",
      );
    } finally {
      if (originalDatabaseUrl) {
        process.env.DATABASE_URL = originalDatabaseUrl;
      } else {
        delete process.env.DATABASE_URL;
      }
    }
  });
});

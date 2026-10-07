import { describe, expect, it, vi } from "vitest";
import {
  archiveLoopDefinition,
  checksumGraph,
  deleteLoopDefinition,
  disableProjectTaskLoopBinding,
  activateLoopVersion,
  listPublishedLoopDefinitionsForSpace,
  publishLoopVersion,
  saveLoopDraft,
  upsertProjectWorkerExecutionResource,
  upsertProjectLoopBinding,
} from "./loop-definitions";

const issuedAt = new Date("2026-07-29T08:00:00.000Z");

const graph = {
  schemaVersion: 1,
  inputSchema: { type: "object" },
  outputSchema: { type: "object" },
  limits: { maxStages: 2, maxRepeatCount: 1 },
  nodes: [
    { key: "start", label: "Start", type: "start", offlinePolicy: "online_required" },
    { key: "end", label: "End", type: "end", offlinePolicy: "online_required" },
  ],
  edges: [
    { id: "edge_start_end", source: "start", target: "end", kind: "normal", outcome: "success" },
  ],
} as const;

const v2Graph = {
  schemaVersion: 2,
  inputSchema: { type: "object" },
  outputSchema: { type: "object" },
  limits: { maxStages: 3, maxRepeatCount: 1 },
  nodes: [
    { key: "start", label: "Start", type: "start", offlinePolicy: "online_required" },
    { key: "work", label: "Work", type: "agent_action", executionTarget: "local", promptTemplate: "Do work", offlinePolicy: "online_required" },
    { key: "end", label: "End", type: "end", offlinePolicy: "online_required" },
  ],
  edges: [
    { id: "start-work", source: "start", target: "work", kind: "normal", outcome: "success" },
    { id: "work-end", source: "work", target: "end", kind: "normal", outcome: "success" },
  ],
  routingMetadata: { work: { responsibility: "Implement the approved work and produce evidence." } },
} as const;

describe("loop definition repositories", () => {
  it("persists a same-domain Linux Worker resource on the Project", async () => {
    const fixture = createFixture();

    await upsertProjectWorkerExecutionResource({
      command: command("configure_project_worker_1"),
      projectId: "project_1",
      workerPoolId: "a".repeat(32),
      workerRepositoryUrl: "https://github.com/humanthread/disaster.git",
      workerBranchPolicy: { allowedBranches: ["2026-DS*"] },
      expectedVersion: 1,
    }, fixture.dependencies);

    expect(fixture.tx.project.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "project_1", version: 1 },
      data: expect.objectContaining({ workerPoolId: "a".repeat(32) }),
    }));
  });

  it("rejects repository changes through the legacy Worker resource command", async () => {
    const fixture = createFixture({
      repositoryConfiguration: {
        schemaVersion: 1,
        provider: "github",
        creationMode: "existing",
        privateBaseUrl: null,
        privateWebUrl: null,
        privateTokenHelpUrl: null,
        authMode: "project_token",
        verification: { status: "passed", verifiedAt: null, defaultBranch: "main", headSha: null, failureCode: null, apiChecked: false },
      },
    });

    await expect(upsertProjectWorkerExecutionResource({
      command: command("configure_project_worker_legacy_repository_1"),
      projectId: "project_1",
      workerPoolId: "a".repeat(32),
      workerRepositoryUrl: "https://git.example.com/other/repo.git",
      workerBranchPolicy: { allowedBranches: ["main"] },
      expectedVersion: 1,
    }, fixture.dependencies)).rejects.toMatchObject({ code: "repository_configuration_managed" });

    expect(fixture.tx.project.updateMany).not.toHaveBeenCalled();
  });

  it("lists published Space and platform definitions in stable order", async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: "loop_a" }]);

    await expect(listPublishedLoopDefinitionsForSpace("space_1", {
      loopDefinition: { findUnique: vi.fn(), findMany },
    } as never)).resolves.toEqual([{ id: "loop_a" }]);
    expect(findMany).toHaveBeenCalledWith({
      where: {
        latestPublishedVersionId: { not: null },
        status: { not: "archived" },
        OR: [{ spaceId: "space_1" }, { origin: "platform" }],
      },
      include: {
        versions: {
          where: { status: "published" },
          orderBy: [{ versionNumber: "asc" }, { id: "asc" }],
        },
      },
      orderBy: [{ id: "asc" }],
    });
  });

  it("persists scope and origin only when creating a draft", async () => {
    const fixture = createFixture();

    await saveLoopDraft({
      command: command("create_scoped_draft_1"),
      loopDefinitionId: "loop_definition_scoped_1",
      spaceId: "space_1",
      ownerUserId: "user_1",
      name: "Release",
      scope: "project",
      origin: "space",
      graph,
    }, fixture.dependencies);

    expect(fixture.tx.loopDefinition.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ scope: "project", origin: "space" }),
    });
  });

  it("saves incomplete v2 drafts but enforces responsibility at publication", async () => {
    const fixture = createFixture();
    const incomplete = { ...v2Graph, routingMetadata: {} };

    await saveLoopDraft({
      command: command("create_v2_draft"),
      loopDefinitionId: "loop_definition_v2",
      spaceId: "space_1",
      ownerUserId: "user_1",
      name: "Stage v2",
      graph: incomplete,
    }, fixture.dependencies);
    expect(fixture.tx.loopDefinition.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ draftGraph: expect.objectContaining({ schemaVersion: 2 }) }),
    });

    await expect(publishLoopVersion({
      command: command("publish_incomplete_v2"),
      loopDefinitionId: "loop_definition_v2",
      versionId: "loop_version_v2",
      nextVersion: 1,
      expectedDraftRevision: 1,
      graph: incomplete,
    }, fixture.dependencies)).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("publishes a complete v2 graph without weakening v1 parsing", async () => {
    const fixture = createFixture();

    await publishLoopVersion({
      command: command("publish_complete_v2"),
      loopDefinitionId: "loop_definition_v2",
      versionId: "loop_version_v2",
      nextVersion: 1,
      expectedDraftRevision: 1,
      graph: v2Graph,
    }, fixture.dependencies);

    expect(fixture.publishedVersions).toEqual([
      expect.objectContaining({ graphSchemaVersion: 2, graph: expect.objectContaining({ schemaVersion: 2 }) }),
    ]);
  });

  it("preserves validated Loop and node retry policies in the immutable published graph", async () => {
    const fixture = createFixture();
    const retryGraph = {
      ...v2Graph,
      retryPolicy: { maxRetries: 4 },
      nodes: v2Graph.nodes.map((node) => (
        node.key === "work" ? { ...node, retryPolicy: { maxRetries: 1 } } : node
      )),
    };

    await publishLoopVersion({
      command: command("publish_retry_policy_v2"),
      loopDefinitionId: "loop_definition_v2",
      versionId: "loop_version_retry_v2",
      nextVersion: 1,
      expectedDraftRevision: 1,
      graph: retryGraph,
    }, fixture.dependencies);

    expect(fixture.publishedVersions[0]?.graph).toMatchObject({
      retryPolicy: { maxRetries: 4 },
      nodes: expect.arrayContaining([
        expect.objectContaining({ key: "work", retryPolicy: { maxRetries: 1 } }),
      ]),
    });
  });

  it("does not mutate scope or origin while updating a draft", async () => {
    const fixture = createFixture();

    await saveLoopDraft({
      command: command("update_scoped_draft_1"),
      loopDefinitionId: "loop_definition_1",
      expectedDraftRevision: 1,
      name: "Release",
      scope: "project",
      origin: "platform",
      graph,
    }, fixture.dependencies);

    expect(fixture.tx.loopDefinition.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.not.objectContaining({ scope: expect.anything(), origin: expect.anything() }),
    }));
  });

  it("publishes one immutable version for a repeated command", async () => {
    const fixture = createFixture();
    const input = {
      command: command("publish_definition_1"),
      loopDefinitionId: "loop_definition_1",
      versionId: "loop_version_1",
      nextVersion: 1,
      expectedDraftRevision: 1,
      graph,
    };

    const first = await publishLoopVersion(input, fixture.dependencies);
    const repeated = await publishLoopVersion(input, fixture.dependencies);

    expect(repeated).toEqual(first);
    expect(first).toEqual({
      loopDefinitionId: "loop_definition_1",
      versionId: "loop_version_1",
      versionNumber: 1,
      checksum: "2cc436804caae7eee5b3ddb391a2262c81566c2a17203094f87a3c14d37e469c",
      maxTransitions: 4,
    });
    expect(fixture.tx.loopVersion.create).toHaveBeenCalledOnce();
    expect(fixture.tx.outboxMessage.createMany).toHaveBeenCalledOnce();
    expect(fixture.publishedVersions).toEqual([
      expect.objectContaining({
        id: "loop_version_1",
        checksum: "2cc436804caae7eee5b3ddb391a2262c81566c2a17203094f87a3c14d37e469c",
        graph,
        maxStages: 2,
        maxRepeatCount: 1,
        platformMaxTransitions: 4,
        status: "published",
      }),
    ]);
  });

  it("activates a published historical version through the Definition revision fence", async () => {
    const fixture = createFixture({
      activeVersion: {
        loopDefinitionId: "loop_definition_1",
        status: "published",
      },
      definitionLifecycle: {
        id: "loop_definition_1",
        origin: "space",
        status: "published",
        draftRevision: 3,
      },
    });

    await expect(activateLoopVersion({
      command: command("activate_loop_version_1"),
      loopDefinitionId: "loop_definition_1",
      activeVersionId: "loop_version_1",
      expectedDraftRevision: 3,
    }, fixture.dependencies)).resolves.toEqual({
      loopDefinitionId: "loop_definition_1",
      activeVersionId: "loop_version_1",
      draftRevision: 4,
    });

    expect(fixture.tx.loopDefinition.updateMany).toHaveBeenCalledWith({
      where: { id: "loop_definition_1", draftRevision: 3 },
      data: { latestPublishedVersionId: "loop_version_1", draftRevision: 4 },
    });
  });

  it("appends the first publication after the saved draft in aggregate sequence order", async () => {
    const fixture = createFixture({
      aggregateSequences: { "loop_definition:loop_definition_1": 1 },
    });

    await publishLoopVersion({
      command: command("publish_definition_after_draft_1"),
      loopDefinitionId: "loop_definition_1",
      versionId: "loop_version_1",
      nextVersion: 1,
      expectedDraftRevision: 1,
      graph,
    }, fixture.dependencies);

    expect(fixture.tx.orchestrationEvent.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        eventType: "loop.version.published",
        aggregateVersion: 2,
        sequence: 2,
        payload: expect.objectContaining({ versionNumber: 1 }),
      })],
    });
  });

  it("consumes the draft revision so another publish command cannot replace its version", async () => {
    const fixture = createFixture();
    await publishLoopVersion({
      command: command("publish_definition_1"),
      loopDefinitionId: "loop_definition_1",
      versionId: "loop_version_1",
      nextVersion: 1,
      expectedDraftRevision: 1,
      graph,
    }, fixture.dependencies);

    await expect(publishLoopVersion({
      command: command("publish_definition_2"),
      loopDefinitionId: "loop_definition_1",
      versionId: "loop_version_2",
      nextVersion: 2,
      expectedDraftRevision: 1,
      graph,
    }, fixture.dependencies)).rejects.toMatchObject({ code: "version_conflict" });

    expect(fixture.publishedVersions).toHaveLength(1);
    expect(fixture.tx.orchestrationEvent.createMany).toHaveBeenCalledOnce();
    expect(fixture.tx.outboxMessage.createMany).toHaveBeenCalledOnce();
  });

  it("rejects a publish version number that skips the current immutable sequence", async () => {
    const fixture = createFixture();

    await expect(publishLoopVersion({
      command: command("publish_definition_3"),
      loopDefinitionId: "loop_definition_1",
      versionId: "loop_version_3",
      nextVersion: 2,
      expectedDraftRevision: 1,
      graph,
    }, fixture.dependencies)).rejects.toMatchObject({ code: "validation_failed" });

    expect(fixture.publishedVersions).toEqual([]);
    expect(fixture.tx.orchestrationEvent.createMany).not.toHaveBeenCalled();
    expect(fixture.tx.outboxMessage.createMany).not.toHaveBeenCalled();
  });

  it("returns one checksum for JSON graphs whose object keys have different insertion order", () => {
    const reorderedGraph = {
      edges: graph.edges,
      nodes: graph.nodes,
      limits: { maxRepeatCount: 1, maxStages: 2 },
      outputSchema: { type: "object" },
      inputSchema: { type: "object" },
      schemaVersion: 1,
    };

    expect(checksumGraph(reorderedGraph)).toBe("2cc436804caae7eee5b3ddb391a2262c81566c2a17203094f87a3c14d37e469c");
    expect(checksumGraph(reorderedGraph)).toBe(checksumGraph(graph));
  });

  it("rejects an unsupported JavaScript value before hashing or publishing a graph", async () => {
    const fixture = createFixture();
    const graphWithUndefinedSchema = { ...graph, inputSchema: undefined };

    expect(() => checksumGraph(graphWithUndefinedSchema as never)).toThrow(/JSON value/u);

    await expect(publishLoopVersion({
      command: command("publish_definition_4"),
      loopDefinitionId: "loop_definition_1",
      versionId: "loop_version_4",
      nextVersion: 1,
      expectedDraftRevision: 1,
      graph: graphWithUndefinedSchema,
    }, fixture.dependencies)).rejects.toMatchObject({ code: "validation_failed" });

    expect(fixture.publishedVersions).toEqual([]);
    expect(fixture.tx.orchestrationEvent.createMany).not.toHaveBeenCalled();
    expect(fixture.tx.outboxMessage.createMany).not.toHaveBeenCalled();
  });

  it("rejects unsafe array shapes before canonicalizing or publishing a graph", async () => {
    const arrayWithCustomPrototype = ["schema"];
    Object.setPrototypeOf(arrayWithCustomPrototype, { custom: true });
    const arrayWithSymbol = ["schema"];
    Object.defineProperty(arrayWithSymbol, Symbol("metadata"), { value: "unsafe" });
    const arrayWithExtraProperty = ["schema"] as string[] & { metadata?: string };
    arrayWithExtraProperty.metadata = "unsafe";
    const arrayWithAccessor = ["schema"];
    Object.defineProperty(arrayWithAccessor, "0", {
      enumerable: true,
      get: () => "schema",
    });
    const arrayWithHiddenProperty = ["schema"];
    Object.defineProperty(arrayWithHiddenProperty, "metadata", { value: "unsafe" });
    const sparseArray = ["schema"];
    delete sparseArray[0];
    const cyclicArray: unknown[] = [];
    cyclicArray.push(cyclicArray);

    for (const invalidArray of [
      arrayWithCustomPrototype,
      arrayWithSymbol,
      arrayWithExtraProperty,
      arrayWithAccessor,
      arrayWithHiddenProperty,
      sparseArray,
      cyclicArray,
      [undefined],
    ]) {
      expect(() => checksumGraph({ ...graph, inputSchema: invalidArray } as never)).toThrow(/JSON value|cycles/u);
    }

    const fixture = createFixture();
    await expect(publishLoopVersion({
      command: command("publish_definition_5"),
      loopDefinitionId: "loop_definition_1",
      versionId: "loop_version_5",
      nextVersion: 1,
      expectedDraftRevision: 1,
      graph: { ...graph, inputSchema: arrayWithAccessor },
    }, fixture.dependencies)).rejects.toMatchObject({ code: "validation_failed" });

    expect(fixture.publishedVersions).toEqual([]);
    expect(fixture.tx.orchestrationEvent.createMany).not.toHaveBeenCalled();
    expect(fixture.tx.outboxMessage.createMany).not.toHaveBeenCalled();
  });

  it("rejects a stale draft revision before appending a draft event", async () => {
    const fixture = createFixture({ draftUpdateCount: 0 });

    await expect(saveLoopDraft({
      command: command("save_draft_1"),
      loopDefinitionId: "loop_definition_1",
      expectedDraftRevision: 1,
      name: "Changed name",
      description: "Changed description",
      graph,
    }, fixture.dependencies)).rejects.toMatchObject({ code: "version_conflict" });

    expect(fixture.tx.loopDefinition.updateMany).toHaveBeenCalledWith({
      where: { id: "loop_definition_1", draftRevision: 1 },
      data: expect.objectContaining({ draftRevision: 2, draftGraph: graph }),
    });
    expect(fixture.tx.orchestrationEvent.createMany).not.toHaveBeenCalled();
    expect(fixture.tx.outboxMessage.createMany).not.toHaveBeenCalled();
  });

  it("rejects a binding target that is not published without writing a binding", async () => {
    const fixture = createFixture({ activeVersion: { status: "deprecated" } });

    await expect(upsertProjectLoopBinding(bindingInput(), fixture.dependencies)).rejects.toMatchObject({
      code: "validation_failed",
    });

    expect(fixture.tx.projectLoopBinding.create).not.toHaveBeenCalled();
    expect(fixture.tx.projectLoopBinding.updateMany).not.toHaveBeenCalled();
    expect(fixture.tx.outboxMessage.createMany).not.toHaveBeenCalled();
  });

  it("persists a binding that tightens published limits", async () => {
    const fixture = createFixture({
      activeVersion: {
        status: "published",
        maxStages: 4,
        maxRepeatCount: 3,
        platformMaxTransitions: 12,
      },
    });
    const input = bindingInput({
      parameterOverrides: {
        limits: { maxStages: 3, maxRepeatCount: 2, maxTransitions: 8 },
      },
    });

    await expect(upsertProjectLoopBinding(input, fixture.dependencies)).resolves.toEqual({
      id: "binding_1",
      projectId: "project_1",
      loopDefinitionId: "loop_definition_1",
      activeVersionId: "loop_version_1",
      status: "enabled",
      version: 1,
    });

    expect(fixture.persistedBindings).toEqual([
      expect.objectContaining({
        id: "binding_1",
        activeVersionId: "loop_version_1",
        status: "enabled",
        parameterOverrides: input.parameterOverrides,
        allowedAgentProfileIds: ["profile_1"],
        allowedProviders: ["codex"],
      }),
    ]);
    expect(fixture.tx.outboxMessage.createMany).toHaveBeenCalledOnce();
  });

  it("persists only Worker stage model policy with the Loop binding", async () => {
    const fixture = createFixture();
    const workerExecution = {
      workerPoolId: "a".repeat(32),
      workerRepositoryUrl: "https://github.com/humanthread/disaster.git",
      workerBranchPolicy: { allowedBranches: ["main"] },
      workerStageConfigurations: {
        work: { siteId: "b".repeat(32), model: "configured-model", reasoningEffort: "high" },
      },
    };

    await upsertProjectLoopBinding(bindingInput(workerExecution), fixture.dependencies);

    expect(fixture.persistedBindings).toContainEqual(expect.objectContaining({
      workerStageConfigurations: workerExecution.workerStageConfigurations,
    }));
    expect(fixture.persistedBindings[0]).not.toHaveProperty("workerPoolId");
    expect(fixture.persistedBindings[0]).not.toHaveProperty("workerRepositoryUrl");
    expect(fixture.persistedBindings[0]).not.toHaveProperty("workerBranchPolicy");
  });

  it("persists a full-string Project Worker branch glob and rejects invalid policy values", async () => {
    const fixture = createFixture();
    const resource = {
      workerPoolId: "a".repeat(32),
      workerRepositoryUrl: "https://github.com/humanthread/disaster.git",
      workerBranchPolicy: { allowedBranches: ["2026-HUMANTHR*"] },
      expectedVersion: 1,
    };

    await expect(upsertProjectWorkerExecutionResource({ command: command("project_worker_branch_glob"), projectId: "project_1", ...resource }, fixture.dependencies)).resolves.toBeDefined();
    await expect(upsertProjectWorkerExecutionResource({ command: command("project_worker_invalid_branch"), projectId: "project_1", ...resource,
      workerBranchPolicy: { allowedBranches: ["feature name"] },
    }, createFixture().dependencies)).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("rejects a Worker execution configuration whose pool is not owned by the binding actor", async () => {
    const fixture = createFixture({
      workerPool: { id: "a".repeat(32), ownerUserId: "user_other", status: "active" },
      workerModelSites: [{ id: "b".repeat(32), ownerUserId: "user_1", provider: "codex", status: "active" }],
    });

    await expect(upsertProjectLoopBinding(bindingInput({
      workerPoolId: "a".repeat(32),
      workerRepositoryUrl: "https://github.com/humanthread/disaster.git",
      workerBranchPolicy: { allowedBranches: ["main"] },
      workerStageConfigurations: {
        work: { siteId: "b".repeat(32), model: "configured-model", reasoningEffort: "high" },
      },
    }), fixture.dependencies)).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("rejects a Worker execution configuration whose model site is unavailable", async () => {
    const fixture = createFixture({
      workerPool: { id: "a".repeat(32), ownerUserId: "user_1", status: "active" },
      workerModelSites: [{ id: "b".repeat(32), ownerUserId: "user_1", provider: "codex", status: "revoked" }],
    });

    await expect(upsertProjectLoopBinding(bindingInput({
      workerPoolId: "a".repeat(32),
      workerRepositoryUrl: "https://github.com/humanthread/disaster.git",
      workerBranchPolicy: { allowedBranches: ["main"] },
      workerStageConfigurations: {
        work: { siteId: "b".repeat(32), model: "configured-model", reasoningEffort: "high" },
      },
    }), fixture.dependencies)).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("accepts company Worker resources for a company project created by a different member", async () => {
    const fixture = createFixture({
      projectScope: { ownerType: "company", ownerUserId: null, companyId: "company_1" },
      workerPool: {
        id: "a".repeat(32), ownerType: "company", ownerUserId: null, companyId: "company_1", status: "active",
      },
      workerModelSites: [{
        id: "b".repeat(32), ownerType: "company", ownerUserId: null, companyId: "company_1", provider: "codex", status: "active",
      }],
    });

    await expect(upsertProjectLoopBinding(bindingInput({
      workerPoolId: "a".repeat(32),
      workerRepositoryUrl: "https://github.com/humanthread/disaster.git",
      workerBranchPolicy: { allowedBranches: ["main"] },
      workerStageConfigurations: {
        work: { siteId: "b".repeat(32), model: "configured-model", reasoningEffort: "high" },
      },
    }), fixture.dependencies)).resolves.toMatchObject({ status: "enabled" });
  });

  it("rejects Worker stage configuration for a node that is not an agent action", async () => {
    const fixture = createFixture();

    await expect(upsertProjectLoopBinding(bindingInput({
      workerPoolId: "a".repeat(32),
      workerRepositoryUrl: "https://github.com/humanthread/disaster.git",
      workerBranchPolicy: { allowedBranches: ["main"] },
      workerStageConfigurations: {
        missing_stage: { siteId: "b".repeat(32), model: "configured-model", reasoningEffort: "high" },
      },
    }), fixture.dependencies)).rejects.toMatchObject({ code: "validation_failed" });
  });

  it.each([
    ["missing", []],
    ["revoked", [bindingGrant({ status: "revoked", revokedAt: "2026-07-29T07:30:00.000Z" })]],
    ["expired", [bindingGrant({ expiresAt: issuedAt })]],
    ["cross-Project", [bindingGrant({ projectId: "project_2" })]],
  ])("rejects a %s AutomationGrant before persisting the binding", async (_case, automationGrants) => {
    const fixture = createFixture({ automationGrants });

    await expect(upsertProjectLoopBinding(bindingInput({
      automationGrantIds: ["grant_1"],
    }), fixture.dependencies)).rejects.toMatchObject({ code: "validation_failed" });

    expect(fixture.tx.projectLoopBinding.create).not.toHaveBeenCalled();
    expect(fixture.tx.outboxMessage.createMany).not.toHaveBeenCalled();
  });

  it("normalizes and persists active grants that explicitly cover the binding", async () => {
    const fixture = createFixture({ automationGrants: [bindingGrant()] });

    await expect(upsertProjectLoopBinding(bindingInput({
      automationGrantIds: ["grant_1", "grant_1"],
    }), fixture.dependencies)).resolves.toMatchObject({ id: "binding_1", version: 1 });

    expect(fixture.persistedBindings[0]?.automationGrantIds).toEqual(["grant_1"]);
  });

  it("persists the development-mode binding role", async () => {
    const fixture = createFixture();

    await upsertProjectLoopBinding(bindingInput({
      bindingRole: "milestone_release",
    }), fixture.dependencies);

    expect(fixture.persistedBindings).toEqual([
      expect.objectContaining({ bindingRole: "milestone_release" }),
    ]);
  });

  it("rejects overrides that raise published loop limits", async () => {
    const fixture = createFixture({
      activeVersion: {
        status: "published",
        maxStages: 2,
        maxRepeatCount: 1,
        platformMaxTransitions: 4,
      },
    });

    await expect(upsertProjectLoopBinding(bindingInput({
      parameterOverrides: { limits: { maxRepeatCount: 2 } },
    }), fixture.dependencies)).rejects.toMatchObject({ code: "validation_failed" });

    expect(fixture.tx.projectLoopBinding.create).not.toHaveBeenCalled();
    expect(fixture.tx.outboxMessage.createMany).not.toHaveBeenCalled();
  });

  it.each([null, [], "invalid", 1])("rejects a non-object limits override: %j", async (limits) => {
    const fixture = createFixture({
      activeVersion: {
        status: "published",
        maxStages: 4,
        maxRepeatCount: 3,
        platformMaxTransitions: 12,
      },
    });

    await expect(upsertProjectLoopBinding(bindingInput({
      parameterOverrides: { limits },
    }), fixture.dependencies)).rejects.toMatchObject({ code: "validation_failed" });

    expect(fixture.tx.projectLoopBinding.create).not.toHaveBeenCalled();
    expect(fixture.tx.orchestrationEvent.createMany).not.toHaveBeenCalled();
    expect(fixture.tx.outboxMessage.createMany).not.toHaveBeenCalled();
  });

  it("rejects conflicting top-level and nested limits even when both lower the published ceiling", async () => {
    const fixture = createFixture({
      activeVersion: {
        status: "published",
        maxStages: 4,
        maxRepeatCount: 3,
        platformMaxTransitions: 12,
      },
    });

    await expect(upsertProjectLoopBinding(bindingInput({
      parameterOverrides: {
        maxRepeatCount: 1,
        limits: { maxRepeatCount: 2 },
      },
    }), fixture.dependencies)).rejects.toMatchObject({ code: "validation_failed" });

    expect(fixture.tx.projectLoopBinding.create).not.toHaveBeenCalled();
    expect(fixture.tx.orchestrationEvent.createMany).not.toHaveBeenCalled();
    expect(fixture.tx.outboxMessage.createMany).not.toHaveBeenCalled();
  });

  it("rejects every declared limit when nested and top-level overrides disagree", async () => {
    const fixture = createFixture({
      activeVersion: {
        status: "published",
        maxStages: 2,
        maxRepeatCount: 1,
        platformMaxTransitions: 4,
      },
    });

    await expect(upsertProjectLoopBinding(bindingInput({
      parameterOverrides: {
        maxRepeatCount: 1,
        limits: { maxRepeatCount: 2 },
      },
    }), fixture.dependencies)).rejects.toMatchObject({ code: "validation_failed" });

    expect(fixture.tx.projectLoopBinding.create).not.toHaveBeenCalled();
  });

  it("disables a task-scoped binding after its completed Run history", async () => {
    const fixture = createFixture({
      activeRunStatus: "completed",
      aggregateSequences: { "loop_binding:binding_1": 2 },
    });

    await expect(disableProjectTaskLoopBinding(disableBindingInput(), fixture.dependencies)).resolves.toEqual({
      id: "binding_1",
      status: "disabled",
      version: 3,
    });

    expect(fixture.tx.loopRun.count).toHaveBeenCalledWith({
      where: {
        projectId: "project_1",
        status: { in: ["pending", "running", "waiting", "claimed", "starting", "waiting_approval"] },
        OR: [
          { bindingId: "binding_1" },
          { childLoopRuns: { some: { bindingId: "binding_1" } } },
        ],
      },
    });
    expect(fixture.tx.projectLoopBinding.updateMany).toHaveBeenCalledWith({
      where: { id: "binding_1", projectId: "project_1", status: "enabled", version: 2 },
      data: { status: "disabled", version: 3 },
    });
    expect(fixture.tx.orchestrationEvent.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        eventType: "loop.binding.disabled",
        aggregateVersion: 3,
        sequence: 3,
        payload: { projectId: "project_1" },
      })],
    });
    expect(fixture.dependencies.db.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
  });

  it.each(["pending", "running", "waiting", "claimed", "starting", "waiting_approval"])(
    "rejects disabling a task binding while a %s Run is active",
    async (_case) => {
      const fixture = createFixture({ activeRunStatus: _case });

      await expect(disableProjectTaskLoopBinding(disableBindingInput(), fixture.dependencies)).rejects.toMatchObject({
        code: "version_conflict",
      });

      expect(fixture.tx.projectLoopBinding.updateMany).not.toHaveBeenCalled();
      expect(fixture.tx.orchestrationEvent.createMany).not.toHaveBeenCalled();
    },
  );

  it("rejects disabling while an active parent Run owns a task-bound child Run", async () => {
    const fixture = createFixture({ activeParentChildRun: true });

    await expect(disableProjectTaskLoopBinding(disableBindingInput(), fixture.dependencies)).rejects.toMatchObject({
      code: "version_conflict",
    });

    expect(fixture.tx.loopRun.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        OR: [
          { bindingId: "binding_1" },
          { childLoopRuns: { some: { bindingId: "binding_1" } } },
        ],
      }),
    });
    expect(fixture.tx.projectLoopBinding.updateMany).not.toHaveBeenCalled();
  });

  it("returns the original successful result for a repeated disable command ID", async () => {
    const fixture = createFixture({ activeRunCount: 0 });
    const input = disableBindingInput({ command: command("disable_task_binding_repeat") });

    const first = await disableProjectTaskLoopBinding(input, fixture.dependencies);
    const repeated = await disableProjectTaskLoopBinding(input, fixture.dependencies);

    expect(repeated).toEqual(first);
    expect(fixture.tx.projectLoopBinding.updateMany).toHaveBeenCalledOnce();
    expect(fixture.tx.orchestrationEvent.createMany).toHaveBeenCalledOnce();
  });

  it("rejects a stale task binding version", async () => {
    const fixture = createFixture({ bindingVersion: 3, activeRunCount: 0 });

    await expect(disableProjectTaskLoopBinding(disableBindingInput({ expectedVersion: 2 }), fixture.dependencies)).rejects.toMatchObject({
      code: "version_conflict",
    });

    expect(fixture.tx.projectLoopBinding.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    ["project", undefined],
    ["task", "task_development"],
  ])("rejects a %s/template binding", async (scope, bindingRole) => {
    const fixture = createFixture({ bindingScope: scope, bindingRole, activeRunCount: 0 });

    await expect(disableProjectTaskLoopBinding(disableBindingInput(), fixture.dependencies)).rejects.toMatchObject({
      code: "validation_failed",
    });

    expect(fixture.tx.loopRun.count).not.toHaveBeenCalled();
    expect(fixture.tx.projectLoopBinding.updateMany).not.toHaveBeenCalled();
  });

  it("archives a Space definition without deleting its historical references", async () => {
    const fixture = createFixture({
      definitionLifecycle: { id: "loop_definition_1", origin: "space", status: "published", draftRevision: 3 },
      referenceCounts: { versions: 2, bindings: 1, runs: 4, receipts: 3, grants: 1 },
    });

    await expect(archiveLoopDefinition(lifecycleInput("archive_definition_1"), fixture.dependencies)).resolves.toEqual({
      id: "loop_definition_1",
      status: "archived",
      draftRevision: 4,
    });

    expect(fixture.tx.loopDefinition.updateMany).toHaveBeenCalledWith({
      where: { id: "loop_definition_1", origin: "space", draftRevision: 3 },
      data: { status: "archived", draftRevision: 4 },
    });
    expect(fixture.tx.loopDefinition.deleteMany).not.toHaveBeenCalled();
  });

  it("physically deletes only an unreferenced Space definition", async () => {
    const fixture = createFixture({
      definitionLifecycle: { id: "loop_definition_1", origin: "space", status: "draft", draftRevision: 3 },
    });

    await expect(deleteLoopDefinition(lifecycleInput("delete_definition_1"), fixture.dependencies)).resolves.toEqual({
      id: "loop_definition_1",
      deleted: true,
    });

    expect(fixture.tx.loopVersion.count).toHaveBeenCalledWith({ where: { loopDefinitionId: "loop_definition_1" } });
    expect(fixture.tx.projectLoopBinding.count).toHaveBeenCalledWith({ where: { loopDefinitionId: "loop_definition_1" } });
    expect(fixture.tx.loopRun.count).toHaveBeenCalledWith({
      where: {
        OR: [
          { loopVersion: { loopDefinitionId: "loop_definition_1" } },
          { binding: { loopDefinitionId: "loop_definition_1" } },
        ],
      },
    });
    expect(fixture.tx.triggerReceipt.count).toHaveBeenCalledWith({
      where: { binding: { loopDefinitionId: "loop_definition_1" } },
    });
    expect(fixture.tx.automationGrant.count).toHaveBeenCalledWith({
      where: { binding: { loopDefinitionId: "loop_definition_1" } },
    });
    expect(fixture.tx.loopDefinition.deleteMany).toHaveBeenCalledWith({
      where: { id: "loop_definition_1", origin: "space", draftRevision: 3 },
    });
  });

  it.each(["versions", "bindings", "runs", "receipts", "grants"] as const)(
    "rejects physical deletion when %s references remain",
    async (referenceType) => {
      const fixture = createFixture({
        definitionLifecycle: { id: "loop_definition_1", origin: "space", status: "draft", draftRevision: 3 },
        referenceCounts: { [referenceType]: 1 },
      });

      await expect(deleteLoopDefinition(lifecycleInput(`delete_referenced_${referenceType}`), fixture.dependencies)).rejects.toMatchObject({
        code: "version_conflict",
      });

      expect(fixture.tx.loopDefinition.deleteMany).not.toHaveBeenCalled();
    },
  );

  it("rejects platform lifecycle changes and stale revisions", async () => {
    const platform = createFixture({
      definitionLifecycle: { id: "loop_definition_1", origin: "platform", status: "published", draftRevision: 3 },
    });
    await expect(archiveLoopDefinition(lifecycleInput("archive_platform"), platform.dependencies)).rejects.toMatchObject({
      code: "validation_failed",
    });

    const stale = createFixture({
      definitionLifecycle: { id: "loop_definition_1", origin: "space", status: "draft", draftRevision: 4 },
    });
    await expect(deleteLoopDefinition(lifecycleInput("delete_stale"), stale.dependencies)).rejects.toMatchObject({
      code: "version_conflict",
    });
  });

  it("replays a completed physical-delete command without a second mutation", async () => {
    const fixture = createFixture({
      definitionLifecycle: { id: "loop_definition_1", origin: "space", status: "draft", draftRevision: 3 },
    });
    const input = lifecycleInput("delete_repeat");

    const first = await deleteLoopDefinition(input, fixture.dependencies);
    await expect(deleteLoopDefinition(input, fixture.dependencies)).resolves.toEqual(first);

    expect(fixture.tx.loopDefinition.deleteMany).toHaveBeenCalledOnce();
  });
});

function command(commandId: string) {
  return {
    commandId,
    correlationId: "loop_definition_1",
    actor: { type: "user" as const, id: "user_1" },
    payload: {},
    issuedAt,
  };
}

function bindingGrant(overrides: Record<string, unknown> = {}) {
  return {
    id: "grant_1",
    projectId: "project_1",
    status: "active",
    revokedAt: null,
    expiresAt: new Date("2026-07-29T09:00:00.000Z"),
    scope: {
      id: "grant_1",
      spaceId: "space_1",
      projectId: "project_1",
      bindingIds: ["binding_1"],
      nodeKeys: [],
      executionPlanes: ["local"],
      deviceIds: [],
      workerIds: [],
      agentProfileIds: [],
      providers: ["codex"],
      permission: "none",
      workspaceBindingIds: [],
      allowedRelativePathPrefixes: [],
      tools: [],
      commandCategories: [],
      operationTypes: [],
      networkTargets: [],
      recipients: [],
      credentialRefs: [],
      allowProduction: false,
      limits: { maxConcurrency: 1, maxDurationMs: 1_000, maxTokens: 0, maxCostUsd: 0, maxToolCalls: 0 },
      policyVersion: "policy_v1",
      status: "active",
      confirmedAt: "2026-07-29T07:00:00.000Z",
      expiresAt: "2026-07-29T09:00:00.000Z",
      revokedAt: null,
    },
    ...overrides,
  };
}

function bindingInput(overrides: Partial<{
  parameterOverrides: Record<string, unknown>;
  automationGrantIds: string[];
  allowedAgentProfileIds: string[];
  allowedProviders: string[];
  bindingRole: "task_development" | "milestone_release";
  workerPoolId: string;
  workerRepositoryUrl: string;
  workerBranchPolicy: Record<string, unknown>;
  workerStageConfigurations: Record<string, unknown>;
}> = {}) {
  return {
    command: command("bind_loop_1"),
    bindingId: "binding_1",
    projectId: "project_1",
    loopDefinitionId: "loop_definition_1",
    activeVersionId: "loop_version_1",
    status: "enabled" as const,
    triggerPolicy: { manual: true, taskEvents: [] },
    parameterOverrides: {},
    notificationPolicy: {},
    automationGrantIds: [],
    allowedAgentProfileIds: ["profile_1"],
    allowedProviders: ["codex"],
    createdByUserId: "user_1",
    ...overrides,
  };
}

function disableBindingInput(overrides: Partial<{
  command: ReturnType<typeof command>;
  expectedVersion: number;
}> = {}) {
  return {
    command: command("disable_task_binding_1"),
    bindingId: "binding_1",
    projectId: "project_1",
    expectedVersion: 2,
    ...overrides,
  };
}

function lifecycleInput(commandId: string) {
  return {
    command: command(commandId),
    loopDefinitionId: "loop_definition_1",
    expectedRevision: 3,
  };
}

function createFixture(input: {
  draftUpdateCount?: number;
  activeVersion?: Partial<{
    loopDefinitionId: string;
    status: string;
    maxStages: number;
    maxRepeatCount: number;
    platformMaxTransitions: number;
    graph: unknown;
  }> | null;
  automationGrants?: Array<Record<string, unknown>>;
  activeRunCount?: number;
  activeRunStatus?: string;
  activeParentChildRun?: boolean;
  bindingVersion?: number;
  bindingScope?: string;
  bindingRole?: string;
  definitionLifecycle?: { id: string; origin: string; status: string; draftRevision: number } | null;
  referenceCounts?: Partial<Record<"versions" | "bindings" | "runs" | "receipts" | "grants", number>>;
  aggregateSequences?: Record<string, number>;
  projectScope?: { ownerType: "personal" | "company"; ownerUserId: string | null; companyId: string | null };
  workerPool?: {
    id: string; ownerType: "personal" | "company"; ownerUserId: string | null; companyId: string | null; status: string;
  } | null;
  workerModelSites?: Array<{
    id: string; ownerType: "personal" | "company"; ownerUserId: string | null; companyId: string | null; provider: string; status: string;
  }>;
  repositoryConfiguration?: unknown;
} = {}) {
  const receipts = new Map<string, { status: string; result?: unknown }>();
  const aggregateSequences = new Map(Object.entries(input.aggregateSequences ?? {}));
  const publishedVersions: Array<Record<string, unknown>> = [];
  const persistedBindings: Array<Record<string, unknown>> = [];
  const definition = {
    draftRevision: input.definitionLifecycle?.draftRevision ?? 1,
    latestPublishedVersion: null as { versionNumber: number } | null,
  };
  const activeVersion = input.activeVersion === null ? null : {
    loopDefinitionId: "loop_definition_1",
    status: "published",
    maxStages: 2,
    maxRepeatCount: 1,
    platformMaxTransitions: 4,
    graph: v2Graph,
    ...input.activeVersion,
  };
  const tx = {
    commandReceipt: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const receipt = receipts.get(where.id);
        return receipt ? { id: where.id, ...receipt } : null;
      }),
      create: vi.fn(async ({ data }: { data: { id: string; status: string } }) => {
        receipts.set(data.id, { status: data.status });
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { status: string; result: unknown } }) => {
        receipts.set(where.id, { status: data.status, result: data.result });
      }),
    },
    orchestrationAggregateSequence: {
      upsert: vi.fn(async ({ where, create }: {
        where: { aggregateType_aggregateId: { aggregateType: string; aggregateId: string } };
        create: { sequence: number };
      }) => {
        const aggregate = where.aggregateType_aggregateId;
        const key = `${aggregate.aggregateType}:${aggregate.aggregateId}`;
        const sequence = (aggregateSequences.get(key) ?? create.sequence - 1) + 1;
        aggregateSequences.set(key, sequence);
        return { sequence };
      }),
    },
    orchestrationEvent: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    outboxMessage: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    loopDefinition: {
      create: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockImplementation(async () => definition),
      findFirst: vi.fn().mockResolvedValue(input.definitionLifecycle ?? {
        id: "loop_definition_1",
        origin: "space",
        status: "draft",
        draftRevision: 3,
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        if (input.draftUpdateCount !== undefined) return { count: input.draftUpdateCount, data };
        if (where.draftRevision !== definition.draftRevision) return { count: 0, data };
        if (typeof data.draftRevision === "number") definition.draftRevision = data.draftRevision;
        if (typeof data.latestPublishedVersionId === "string") {
          definition.latestPublishedVersion = { versionNumber: publishedVersions.at(-1)?.versionNumber as number };
        }
        return { count: 1, data };
      }),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    loopVersion: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        publishedVersions.push(data);
        return data;
      }),
      findUnique: vi.fn().mockResolvedValue(activeVersion),
      count: vi.fn().mockResolvedValue(input.referenceCounts?.versions ?? 0),
    },
    projectLoopBinding: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        persistedBindings.push(data);
        return data;
      }),
      findUnique: vi.fn().mockResolvedValue({
        id: "binding_1",
        projectId: "project_1",
        status: "enabled",
        version: input.bindingVersion ?? 2,
        bindingRole: input.bindingRole ?? "task_execution",
        loopDefinition: { scope: input.bindingScope ?? "task" },
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(input.referenceCounts?.bindings ?? 0),
    },
    loopRun: {
      count: vi.fn(async ({ where }: { where: {
        status?: { in?: string[] };
        OR?: Array<Record<string, unknown>>;
      } }) => {
        if (input.activeRunStatus !== undefined) {
          return where.status?.in?.includes(input.activeRunStatus) ? 1 : 0;
        }
        if (input.activeParentChildRun) {
          return where.OR?.some((branch) => (
            branch.childLoopRuns !== null
            && typeof branch.childLoopRuns === "object"
            && !Array.isArray(branch.childLoopRuns)
            && (branch.childLoopRuns as Record<string, unknown>).some !== null
            && typeof (branch.childLoopRuns as Record<string, unknown>).some === "object"
            && !Array.isArray((branch.childLoopRuns as Record<string, unknown>).some)
            && ((branch.childLoopRuns as Record<string, unknown>).some as Record<string, unknown>).bindingId === "binding_1"
          )) ? 1 : 0;
        }
        return input.activeRunCount ?? 0;
      }),
    },
    automationGrant: {
      findMany: vi.fn().mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) => (
        (input.automationGrants ?? []).filter((grant) => where.id.in.includes(String(grant.id)))
      )),
      count: vi.fn().mockResolvedValue(input.referenceCounts?.grants ?? 0),
    },
    project: {
      findUnique: vi.fn().mockResolvedValue(input.projectScope ?? {
        ownerType: "personal",
        ownerUserId: "user_1",
        companyId: null,
        workerRepositoryUrl: "https://github.com/humanthread/disaster.git",
        workerBranchPolicy: { allowedBranches: ["2026-DS*"] },
        repositoryConfiguration: input.repositoryConfiguration ?? null,
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    workerPool: {
      findFirst: vi.fn(async ({ where }: { where: {
        id: string; ownerType: string; ownerUserId: string | null; companyId: string | null; status: string;
      } }) => {
        const pool = input.workerPool ?? {
          id: "a".repeat(32),
          ownerType: "personal" as const,
          ownerUserId: "user_1",
          companyId: null,
          status: "active",
        };
        return pool !== null
          && pool.id === where.id
          && pool.ownerType === where.ownerType
          && pool.ownerUserId === where.ownerUserId
          && pool.companyId === where.companyId
          && pool.status === where.status
          ? pool
          : null;
      }),
    },
    workerModelSite: {
      findMany: vi.fn(async ({ where }: { where: {
        id: { in: string[] };
        ownerType: string;
        ownerUserId: string | null;
        companyId: string | null;
        provider: string;
        status: string;
      } }) => (input.workerModelSites ?? [{
        id: "b".repeat(32),
        ownerType: "personal" as const,
        ownerUserId: "user_1",
        companyId: null,
        provider: "codex",
        status: "active",
      }]).filter((site) => (
        where.id.in.includes(site.id)
        && site.ownerType === where.ownerType
        && site.ownerUserId === where.ownerUserId
        && site.companyId === where.companyId
        && site.provider === where.provider
        && site.status === where.status
      ))),
    },
    triggerReceipt: {
      count: vi.fn().mockResolvedValue(input.referenceCounts?.receipts ?? 0),
    },
  };

  const activeRunCount = tx.loopRun.count;
  tx.loopRun.count = vi.fn(async (args: { where: Record<string, unknown> }) => (
    "OR" in args.where && !("status" in args.where)
      ? input.referenceCounts?.runs ?? 0
      : activeRunCount(args as never)
  ));

  return {
    tx,
    dependencies: {
      db: {
        $transaction: vi.fn(async (
          callback: (value: typeof tx) => Promise<unknown>,
          _options?: { isolationLevel: "Serializable" },
        ) => callback(tx)),
      },
    },
    publishedVersions,
    persistedBindings,
  };
}

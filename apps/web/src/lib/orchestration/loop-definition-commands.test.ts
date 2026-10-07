import { describe, expect, it, vi } from "vitest";
import {
  archiveLoopDefinitionCommand,
  activateLoopVersionCommand,
  createLoopDraftCommand,
  deleteLoopDefinitionCommand,
  disableLoopBindingCommand,
  listLoopBindingsCommand,
  publishLoopDefinitionCommand,
  updateLoopDraftCommand,
  upsertLoopBindingCommand,
} from "./loop-definition-commands";

const graph = {
  schemaVersion: 1,
  inputSchema: { type: "object" },
  outputSchema: { type: "object" },
  limits: { maxStages: 2, maxRepeatCount: 1 },
  nodes: [
    { key: "start", label: "Start", type: "start" },
    { key: "end", label: "End", type: "end" },
  ],
  edges: [
    { id: "start-end", source: "start", target: "end", kind: "normal", outcome: "success" },
  ],
};

function dependencies() {
  return {
    now: () => new Date("2026-07-30T03:00:00.000Z"),
    assertCanWriteSpace: vi.fn().mockResolvedValue({ role: "owner" }),
    assertCanReadProject: vi.fn().mockResolvedValue({ role: "viewer" }),
    assertCanWriteProject: vi.fn().mockResolvedValue({ role: "maintainer" }),
    readProject: vi.fn().mockResolvedValue({ id: "project_1", spaceId: "space_1" }),
    readLoopDefinition: vi.fn().mockResolvedValue({
      id: "loop_definition_1",
      spaceId: "space_1",
      name: "Delivery loop",
      description: null,
      draftGraph: graph,
      draftRevision: 3,
      latestPublishedVersion: { versionNumber: 1 },
      scope: "project",
      versions: [{ id: "loop_version_2", graph }],
    }),
    saveLoopDraft: vi.fn().mockResolvedValue({ loopDefinitionId: "loop_definition_1", draftRevision: 1 }),
    publishLoopVersion: vi.fn().mockResolvedValue({
      loopDefinitionId: "loop_definition_1",
      versionId: "loop_version_2",
      versionNumber: 2,
      checksum: "checksum_2",
      maxTransitions: 4,
    }),
    activateLoopVersion: vi.fn().mockResolvedValue({
      loopDefinitionId: "loop_definition_1",
      activeVersionId: "loop_version_1",
      draftRevision: 4,
    }),
    upsertProjectLoopBinding: vi.fn().mockResolvedValue({
      id: "binding_1",
      projectId: "project_1",
      loopDefinitionId: "loop_definition_1",
      activeVersionId: "loop_version_2",
      status: "enabled",
      version: 1,
    }),
    disableProjectTaskLoopBinding: vi.fn().mockResolvedValue({
      id: "binding_1",
      status: "disabled",
      version: 3,
    }),
    archiveLoopDefinition: vi.fn().mockResolvedValue({
      id: "loop_definition_1",
      status: "archived",
      draftRevision: 4,
    }),
    deleteLoopDefinition: vi.fn().mockResolvedValue({ id: "loop_definition_1", deleted: true }),
    listProjectLoopBindings: vi.fn().mockResolvedValue([{ id: "binding_1" }]),
    listAgentProfiles: vi.fn().mockImplementation(async ({ ids }: { ids: string[] }) => [
      { id: "profile_codex", spaceId: "space_1", provider: "codex", status: "active" },
    ].filter((profile) => ids.includes(profile.id))),
  };
}

describe("Loop definition commands", () => {
  it("activates a historical version after authorizing the definition owner", async () => {
    const deps = dependencies();

    await activateLoopVersionCommand({
      actorUserId: "user_1",
      commandId: "activate_1",
      loopDefinitionId: "loop_definition_1",
      activeVersionId: "loop_version_1",
      expectedDraftRevision: 3,
    }, deps);

    expect(deps.assertCanWriteSpace).toHaveBeenCalledWith({ userId: "user_1", spaceId: "space_1" });
    expect(deps.activateLoopVersion).toHaveBeenCalledWith(expect.objectContaining({
      loopDefinitionId: "loop_definition_1",
      activeVersionId: "loop_version_1",
      expectedDraftRevision: 3,
      command: expect.objectContaining({ actor: { type: "user", id: "user_1" } }),
    }));
  });

  it("authorizes the Space and scopes command identity before creating a draft", async () => {
    const deps = dependencies();

    await createLoopDraftCommand({
      actorUserId: "user_1",
      commandId: "create_1",
      spaceId: "space_1",
      scope: "project",
      name: "Delivery loop",
      graph,
    }, deps);

    expect(deps.assertCanWriteSpace).toHaveBeenCalledWith({ userId: "user_1", spaceId: "space_1" });
    expect(deps.saveLoopDraft).toHaveBeenCalledWith(expect.objectContaining({
      spaceId: "space_1",
      ownerUserId: "user_1",
      scope: "project",
      origin: "space",
      command: expect.objectContaining({
        correlationId: expect.stringContaining("loop_definition"),
        actor: { type: "user", id: "user_1" },
      }),
    }));
  });

  it("rejects platform definitions before checking Space write access", async () => {
    const deps = dependencies();
    deps.readLoopDefinition.mockResolvedValue({
      id: "loop_platform_1",
      spaceId: "space_platform",
      name: "Platform release",
      description: null,
      draftGraph: graph,
      draftRevision: 3,
      latestPublishedVersion: { versionNumber: 1 },
      origin: "platform",
    });

    await expect(updateLoopDraftCommand({
      actorUserId: "user_1",
      commandId: "update_platform",
      loopDefinitionId: "loop_platform_1",
      expectedDraftRevision: 3,
      name: "Attempted update",
      graph,
    }, deps)).rejects.toMatchObject({ code: "authorization_denied" });

    expect(deps.assertCanWriteSpace).not.toHaveBeenCalled();
    expect(deps.saveLoopDraft).not.toHaveBeenCalled();
  });

  it("publishes the persisted draft graph and derives the next immutable version", async () => {
    const deps = dependencies();

    await publishLoopDefinitionCommand({
      actorUserId: "user_1",
      commandId: "publish_2",
      loopDefinitionId: "loop_definition_1",
      expectedDraftRevision: 3,
    }, deps);

    expect(deps.assertCanWriteSpace).toHaveBeenCalledWith({ userId: "user_1", spaceId: "space_1" });
    expect(deps.publishLoopVersion).toHaveBeenCalledWith(expect.objectContaining({
      loopDefinitionId: "loop_definition_1",
      expectedDraftRevision: 3,
      nextVersion: 2,
      graph,
      command: expect.objectContaining({ actor: { type: "user", id: "user_1" } }),
    }));
  });

  it("authorizes the definition Space before updating its draft revision", async () => {
    const deps = dependencies();

    await updateLoopDraftCommand({
      actorUserId: "user_1",
      commandId: "update_3",
      loopDefinitionId: "loop_definition_1",
      expectedDraftRevision: 3,
      name: "Updated loop",
      graph,
    }, deps);

    expect(deps.assertCanWriteSpace).toHaveBeenCalledWith({ userId: "user_1", spaceId: "space_1" });
    expect(deps.saveLoopDraft).toHaveBeenCalledWith(expect.objectContaining({
      loopDefinitionId: "loop_definition_1",
      expectedDraftRevision: 3,
      command: expect.objectContaining({ expectedVersion: 3 }),
    }));
  });

  it("rejects a stale draft update with the current revision before calling the repository", async () => {
    const deps = dependencies();

    await expect(updateLoopDraftCommand({
      actorUserId: "user_1",
      commandId: "update_stale",
      loopDefinitionId: "loop_definition_1",
      expectedDraftRevision: 2,
      name: "Stale loop",
      graph,
    }, deps)).rejects.toMatchObject({
      code: "version_conflict",
      currentRevision: 3,
    });

    expect(deps.saveLoopDraft).not.toHaveBeenCalled();
  });

  it("rejects publishing a stale draft before calling the repository", async () => {
    const deps = dependencies();

    await expect(publishLoopDefinitionCommand({
      actorUserId: "user_1",
      commandId: "publish_stale",
      loopDefinitionId: "loop_definition_1",
      expectedDraftRevision: 2,
    }, deps)).rejects.toMatchObject({ code: "version_conflict" });

    expect(deps.publishLoopVersion).not.toHaveBeenCalled();
  });

  it("authorizes the target Project before binding a version", async () => {
    const deps = dependencies();
    const calls: string[] = [];
    deps.assertCanWriteProject.mockImplementation(async () => { calls.push("authorize"); });
    deps.upsertProjectLoopBinding.mockImplementation(async () => {
      calls.push("persist");
      return { id: "binding_1" };
    });

    await upsertLoopBindingCommand({
      actorUserId: "user_1",
      projectId: "project_1",
      commandId: "bind_1",
      loopDefinitionId: "loop_definition_1",
      activeVersionId: "loop_version_2",
      status: "enabled",
      triggerPolicy: { manual: true, taskEvents: [] },
      parameterOverrides: {},
      notificationPolicy: {},
      automationGrantIds: [],
      allowedAgentProfileIds: ["profile_codex"],
      allowedProviders: ["codex"],
    }, deps);

    expect(calls).toEqual(["authorize", "persist"]);
    expect(deps.assertCanWriteProject).toHaveBeenCalledWith({ userId: "user_1", projectId: "project_1" });
    expect(deps.upsertProjectLoopBinding).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "project_1",
      activeVersionId: "loop_version_2",
      createdByUserId: "user_1",
      allowedAgentProfileIds: ["profile_codex"],
      allowedProviders: ["codex"],
    }));
  });

  it("updates the persisted template binding ID instead of deriving a new one", async () => {
    const deps = dependencies();
    deps.listProjectLoopBindings.mockResolvedValue([{
      id: "binding:project_1:task_development",
      projectId: "project_1",
      loopDefinitionId: "loop_definition_1",
      version: 3,
    }]);

    await upsertLoopBindingCommand({
      actorUserId: "user_1",
      projectId: "project_1",
      commandId: "bind_template_1",
      expectedVersion: 3,
      loopDefinitionId: "loop_definition_1",
      activeVersionId: "loop_version_2",
      status: "enabled",
      triggerPolicy: { manual: true, taskEvents: [] },
      parameterOverrides: {},
      notificationPolicy: {},
      automationGrantIds: [],
      allowedAgentProfileIds: ["profile_codex"],
      allowedProviders: ["codex"],
    }, deps);

    expect(deps.upsertProjectLoopBinding).toHaveBeenCalledWith(expect.objectContaining({
      bindingId: "binding:project_1:task_development",
      expectedVersion: 3,
    }));
  });

  it("updates the task-development binding when a legacy untyped binding has the same Loop", async () => {
    const deps = dependencies();
    deps.listProjectLoopBindings.mockResolvedValue([
      {
        id: "legacy-untyped-binding",
        projectId: "project_1",
        loopDefinitionId: "loop_definition_1",
        bindingRole: null,
        version: 8,
      },
      {
        id: "binding:project_1:task_development",
        projectId: "project_1",
        loopDefinitionId: "loop_definition_1",
        bindingRole: "task_development",
        version: 4,
      },
    ]);

    await upsertLoopBindingCommand({
      actorUserId: "user_1",
      projectId: "project_1",
      commandId: "bind_task_model",
      expectedVersion: 4,
      loopDefinitionId: "loop_definition_1",
      activeVersionId: "loop_version_2",
      status: "enabled",
      bindingRole: "task_development",
      triggerPolicy: { manual: false, taskEvents: [] },
      parameterOverrides: {},
      notificationPolicy: {},
      automationGrantIds: [],
      allowedAgentProfileIds: ["profile_codex"],
      allowedProviders: ["codex"],
    }, deps);

    expect(deps.upsertProjectLoopBinding).toHaveBeenCalledWith(expect.objectContaining({
      bindingId: "binding:project_1:task_development",
      bindingRole: "task_development",
      expectedVersion: 4,
    }));
  });

  it("reports the current binding version before persistence when the request is stale", async () => {
    const deps = dependencies();
    deps.listProjectLoopBindings.mockResolvedValue([{
      id: "binding:project_1:task_development",
      projectId: "project_1",
      loopDefinitionId: "loop_definition_1",
      version: 4,
    }]);

    await expect(upsertLoopBindingCommand({
      actorUserId: "user_1",
      projectId: "project_1",
      commandId: "bind_template_stale",
      expectedVersion: 3,
      loopDefinitionId: "loop_definition_1",
      activeVersionId: "loop_version_2",
      status: "enabled",
      triggerPolicy: { manual: true, taskEvents: [] },
      parameterOverrides: {},
      notificationPolicy: {},
      automationGrantIds: [],
      allowedAgentProfileIds: ["profile_codex"],
      allowedProviders: ["codex"],
    }, deps)).rejects.toMatchObject({ code: "version_conflict", currentRevision: 4 });

    expect(deps.upsertProjectLoopBinding).not.toHaveBeenCalled();
  });

  it("rejects an unavailable provider before persisting a binding", async () => {
    const deps = dependencies();
    deps.listAgentProfiles.mockResolvedValue([
      { id: "profile_claude", spaceId: "space_1", provider: "claude", status: "active" },
    ]);

    await expect(upsertLoopBindingCommand({
      actorUserId: "user_1", projectId: "project_1", commandId: "bind_claude",
      loopDefinitionId: "loop_definition_1", activeVersionId: "loop_version_2",
      status: "enabled", triggerPolicy: { manual: true, taskEvents: [] },
      parameterOverrides: {}, notificationPolicy: {}, automationGrantIds: [],
      allowedAgentProfileIds: ["profile_claude"], allowedProviders: ["claude"],
    }, deps)).rejects.toMatchObject({ code: "validation_failed" });

    expect(deps.upsertProjectLoopBinding).not.toHaveBeenCalled();
  });

  it("rejects empty execution policy for a version with local Agent nodes", async () => {
    const deps = dependencies();
    deps.readLoopDefinition.mockResolvedValue({
      id: "loop_definition_1", spaceId: "space_1", name: "Delivery loop",
      description: null, draftGraph: graph, draftRevision: 3,
      latestPublishedVersion: { versionNumber: 1 },
      versions: [{ id: "loop_version_2", graph: { ...graph, nodes: [
        graph.nodes[0],
        { key: "agent", label: "Agent", type: "agent_action", executionTarget: "local", promptTemplate: "Run" },
        graph.nodes[1],
      ] } }],
    });

    await expect(upsertLoopBindingCommand({
      actorUserId: "user_1", projectId: "project_1", commandId: "bind_empty",
      loopDefinitionId: "loop_definition_1", activeVersionId: "loop_version_2",
      status: "enabled", triggerPolicy: { manual: true, taskEvents: [] },
      parameterOverrides: {}, notificationPolicy: {}, automationGrantIds: [],
      allowedAgentProfileIds: [], allowedProviders: [],
    }, deps)).rejects.toMatchObject({ code: "validation_failed" });

    expect(deps.upsertProjectLoopBinding).not.toHaveBeenCalled();
  });

  it("allows Linux Worker bindings without Local Agent Profile or Provider", async () => {
    const deps = dependencies();
    deps.readLoopDefinition.mockResolvedValue({
      id: "loop_definition_1", spaceId: "space_1", name: "Delivery loop",
      description: null, draftGraph: graph, draftRevision: 3,
      latestPublishedVersion: { versionNumber: 1 },
      versions: [{ id: "loop_version_2", graph: { ...graph, nodes: [
        graph.nodes[0],
        { key: "agent", label: "Agent", type: "agent_action", executionTarget: "local", promptTemplate: "Run" },
        graph.nodes[1],
      ] } }],
    });

    await expect(upsertLoopBindingCommand({
      actorUserId: "user_1", projectId: "project_1", commandId: "bind_worker",
      loopDefinitionId: "loop_definition_1", activeVersionId: "loop_version_2",
      status: "enabled", triggerPolicy: { manual: true, taskEvents: [] },
      parameterOverrides: {}, notificationPolicy: {}, automationGrantIds: [],
      allowedAgentProfileIds: [], allowedProviders: [],
      workerStageConfigurations: {
        agent: { siteId: "a".repeat(32), model: "gpt-5", reasoningEffort: "medium" },
      },
    }, deps)).resolves.toMatchObject({ id: "binding_1" });

    expect(deps.upsertProjectLoopBinding).toHaveBeenCalledWith(expect.objectContaining({
      allowedAgentProfileIds: [],
      allowedProviders: [],
      workerStageConfigurations: {
        agent: { siteId: "a".repeat(32), model: "gpt-5", reasoningEffort: "medium" },
      },
    }));
  });

  it("rejects binding a Loop definition from another Space", async () => {
    const deps = dependencies();
    deps.readProject.mockResolvedValue({ id: "project_1", spaceId: "space_other" });

    await expect(upsertLoopBindingCommand({
      actorUserId: "user_1",
      projectId: "project_1",
      commandId: "bind_cross_space",
      loopDefinitionId: "loop_definition_1",
      activeVersionId: "loop_version_2",
      status: "enabled",
      triggerPolicy: { manual: true, taskEvents: [] },
      parameterOverrides: {},
      notificationPolicy: {},
      automationGrantIds: [],
      allowedAgentProfileIds: ["profile_codex"],
      allowedProviders: ["codex"],
    }, deps)).rejects.toMatchObject({ code: "validation_failed" });

    expect(deps.upsertProjectLoopBinding).not.toHaveBeenCalled();
  });

  it("allows a published platform Loop to bind outside its system Space", async () => {
    const deps = dependencies();
    deps.readProject.mockResolvedValue({ id: "project_1", spaceId: "space_project" });
    deps.listAgentProfiles.mockResolvedValue([
      { id: "profile_codex", spaceId: "space_project", provider: "codex", status: "active" },
    ]);
    deps.readLoopDefinition.mockResolvedValue({
      id: "loop_platform_1", spaceId: "space_platform", name: "Platform release",
      description: null, draftGraph: graph, draftRevision: 3,
      latestPublishedVersion: { versionNumber: 1 }, origin: "platform",
      scope: "project",
      versions: [{ id: "loop_version_2", graph }],
    });

    await expect(upsertLoopBindingCommand({
      actorUserId: "user_1", projectId: "project_1", commandId: "bind_platform",
      loopDefinitionId: "loop_platform_1", activeVersionId: "loop_version_2",
      status: "enabled", triggerPolicy: { manual: true, taskEvents: [] },
      parameterOverrides: {}, notificationPolicy: {}, automationGrantIds: [],
      allowedAgentProfileIds: ["profile_codex"], allowedProviders: ["codex"],
    }, deps)).resolves.toMatchObject({ id: "binding_1" });
  });

  it("authorizes Project reads before listing bindings", async () => {
    const deps = dependencies();

    await expect(listLoopBindingsCommand({
      actorUserId: "user_1",
      projectId: "project_1",
    }, deps)).resolves.toEqual([{ id: "binding_1" }]);

    expect(deps.assertCanReadProject).toHaveBeenCalledWith({ userId: "user_1", projectId: "project_1" });
    expect(deps.listProjectLoopBindings).toHaveBeenCalledWith("project_1");
  });

  it("authorizes Project writes before disabling a task binding", async () => {
    const deps = dependencies();
    const calls: string[] = [];
    deps.assertCanWriteProject.mockImplementation(async () => { calls.push("authorize"); });
    deps.disableProjectTaskLoopBinding.mockImplementation(async () => {
      calls.push("read_and_persist");
      return { id: "binding_1", status: "disabled", version: 3 };
    });

    await expect(disableLoopBindingCommand({
      actorUserId: "user_1",
      projectId: "project_1",
      commandId: "disable_1",
      bindingId: "binding_1",
      expectedVersion: 2,
    }, deps)).resolves.toEqual({ id: "binding_1", status: "disabled", version: 3 });

    expect(calls).toEqual(["authorize", "read_and_persist"]);
    expect(deps.disableProjectTaskLoopBinding).toHaveBeenCalledWith(expect.objectContaining({
      bindingId: "binding_1",
      projectId: "project_1",
      expectedVersion: 2,
      command: expect.objectContaining({
        actor: { type: "user", id: "user_1" },
        expectedVersion: 2,
        payload: { operation: "disable_task_loop_binding", bindingId: "binding_1" },
      }),
    }));
  });

  it("authorizes the Space before archiving a definition", async () => {
    const deps = dependencies();
    const calls: string[] = [];
    deps.assertCanWriteSpace.mockImplementation(async () => { calls.push("authorize"); });
    deps.archiveLoopDefinition.mockImplementation(async () => {
      calls.push("archive");
      return { id: "loop_definition_1", status: "archived", draftRevision: 4 };
    });

    await expect(archiveLoopDefinitionCommand({
      actorUserId: "user_1",
      commandId: "archive_1",
      loopDefinitionId: "loop_definition_1",
      expectedDraftRevision: 3,
    }, deps)).resolves.toEqual({ id: "loop_definition_1", status: "archived", draftRevision: 4 });

    expect(calls).toEqual(["authorize", "archive"]);
    expect(deps.archiveLoopDefinition).toHaveBeenCalledWith(expect.objectContaining({
      loopDefinitionId: "loop_definition_1",
      expectedRevision: 3,
      command: expect.objectContaining({
        actor: { type: "user", id: "user_1" },
        payload: { operation: "archive_loop_definition" },
      }),
    }));
  });

  it("rejects platform deletion before Space authorization", async () => {
    const deps = dependencies();
    deps.readLoopDefinition.mockResolvedValue({
      id: "loop_platform_1",
      spaceId: "space_platform",
      name: "Platform Loop",
      description: null,
      draftGraph: graph,
      draftRevision: 3,
      latestPublishedVersion: null,
      origin: "platform",
    });

    await expect(deleteLoopDefinitionCommand({
      actorUserId: "user_1",
      commandId: "delete_platform",
      loopDefinitionId: "loop_platform_1",
      expectedDraftRevision: 3,
    }, deps)).rejects.toMatchObject({ code: "authorization_denied" });

    expect(deps.assertCanWriteSpace).not.toHaveBeenCalled();
    expect(deps.deleteLoopDefinition).not.toHaveBeenCalled();
  });

  it("rejects a stale lifecycle revision before persistence", async () => {
    const deps = dependencies();

    await expect(deleteLoopDefinitionCommand({
      actorUserId: "user_1",
      commandId: "delete_stale",
      loopDefinitionId: "loop_definition_1",
      expectedDraftRevision: 2,
    }, deps)).rejects.toMatchObject({ code: "version_conflict", currentRevision: 3 });

    expect(deps.deleteLoopDefinition).not.toHaveBeenCalled();
  });
});

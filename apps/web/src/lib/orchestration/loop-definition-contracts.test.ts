import { describe, expect, it } from "vitest";
import {
  createLoopDraftRequestSchema,
  disableLoopBindingRequestSchema,
  loopBindingRequestSchema,
  projectWorkerResourceRequestSchema,
  loopDefinitionLifecycleRequestSchema,
} from "./loop-definition-contracts";

const request = {
  commandId: "bind_1",
  loopDefinitionId: "loop_1",
  activeVersionId: "version_1",
  status: "enabled",
  triggerPolicy: { manual: true, taskEvents: [] },
  parameterOverrides: {},
  notificationPolicy: {},
  automationGrantIds: [],
  allowedAgentProfileIds: ["profile_codex"],
  allowedProviders: ["codex"],
};

describe("Loop binding contracts", () => {
  it("accepts strict logical profile and provider allowlists", () => {
    expect(loopBindingRequestSchema.parse(request)).toMatchObject({
      allowedAgentProfileIds: ["profile_codex"],
      allowedProviders: ["codex"],
    });
    expect(loopBindingRequestSchema.safeParse({ ...request, localPath: "/tmp/project" }).success).toBe(false);
  });

  it("accepts only a command, binding, and required version when disabling a binding", () => {
    expect(disableLoopBindingRequestSchema.parse({
      commandId: "disable_1",
      bindingId: "binding_1",
      expectedVersion: 2,
    })).toEqual({ commandId: "disable_1", bindingId: "binding_1", expectedVersion: 2 });
    expect(disableLoopBindingRequestSchema.safeParse({
      commandId: "disable_1",
      bindingId: "binding_1",
    }).success).toBe(false);
    expect(disableLoopBindingRequestSchema.safeParse({
      commandId: "disable_1",
      bindingId: "binding_1",
      expectedVersion: 2,
      status: "disabled",
    }).success).toBe(false);
  });

  it("keeps branch policy at the Project boundary", () => {
    const workerResource = {
      commandId: "worker_resource_1",
      expectedVersion: 1,
      workerPoolId: "a".repeat(32),
      workerRepositoryUrl: "https://git.example.com/acme/project.git",
      workerBranchPolicy: { allowedBranches: ["2026-HUMANTHR*"] },
    };
    expect(projectWorkerResourceRequestSchema.safeParse(workerResource).success).toBe(true);
    expect(projectWorkerResourceRequestSchema.safeParse({
      ...workerResource,
      workerBranchPolicy: { allowedBranches: ["feature name"] },
    }).success).toBe(false);
    expect(loopBindingRequestSchema.safeParse({
      ...request,
      workerStageConfigurations: {
        work: { siteId: "b".repeat(32), model: "configured-model", reasoningEffort: "high" },
      },
      workerPoolId: "a".repeat(32),
    }).success).toBe(false);
  });
});

describe("Loop draft graph contracts", () => {
  it("accepts v2 routing metadata without relaxing the strict v1 graph", () => {
    const graph = {
      schemaVersion: 2,
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      limits: { maxStages: 3, maxRepeatCount: 1 },
      nodes: [
        { key: "start", type: "start", label: "Start" },
        { key: "work", type: "agent_action", label: "Work", executionTarget: "local", promptTemplate: "Do work" },
        { key: "end", type: "end", label: "End" },
      ],
      edges: [
        { id: "start-work", source: "start", target: "work", kind: "normal", outcome: "success" },
        { id: "work-end", source: "work", target: "end", kind: "normal", outcome: "success" },
      ],
      routingMetadata: { work: { responsibility: "Complete the work and produce evidence." } },
    };

    expect(createLoopDraftRequestSchema.parse({
      commandId: "create_v2",
      spaceId: "space_1",
      name: "V2 Loop",
      graph,
    }).graph).toEqual(graph);
    expect(createLoopDraftRequestSchema.safeParse({
      commandId: "create_v2_incomplete",
      spaceId: "space_1",
      name: "Incomplete V2 Loop",
      graph: { ...graph, routingMetadata: {} },
    }).success).toBe(true);
  });
});

describe("Loop creation contracts", () => {
  it("defaults legacy create requests to task scope", () => {
    expect(createLoopDraftRequestSchema.parse({
      commandId: "create_1",
      spaceId: "space_1",
      name: "Release",
      graph: {},
    }).scope).toBe("task");
  });

  it("accepts only archive or delete lifecycle modes", () => {
    expect(loopDefinitionLifecycleRequestSchema.parse({
      commandId: "archive_1",
      expectedRevision: 3,
      mode: "archive",
    })).toEqual({ commandId: "archive_1", expectedRevision: 3, mode: "archive" });
    expect(loopDefinitionLifecycleRequestSchema.safeParse({
      commandId: "delete_1",
      expectedRevision: 3,
      mode: "purge",
    }).success).toBe(false);
  });
});

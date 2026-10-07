import { describe, expect, it, vi } from "vitest";
import { projectPlatformLoopGraphV2, validateLoopGraph } from "../packages/orchestration-core/dist/index.js";
import { projectDevelopmentTemplateSchema } from "../packages/shared/dist/index.js";
import {
  MILESTONE_RELEASE_GRAPH,
  GELSANG_PROJECT_LOOP_GRAPH,
  PLATFORM_LOOP_ORIGIN,
  PLATFORM_LOOP_SCOPE,
  PLATFORM_LOOP_SPACE_ID,
  PLATFORM_LOOP_DEFINITIONS,
  TASK_DEVELOPMENT_GRAPH,
  TASK_DEVELOPMENT_GRAPH_V2,
  TASK_DEVELOPMENT_GRAPH_V3,
  TASK_DEVELOPMENT_GRAPH_V4,
  MILESTONE_RELEASE_GRAPH_V2,
  BRANCH_DEVELOPMENT_TEMPLATE_V2,
  BRANCH_DEVELOPMENT_TEMPLATE_V3,
  BRANCH_DEVELOPMENT_TEMPLATE_V4,
  buildPlatformLoopVersionWriteData,
  applyBranchDevelopmentV3Upgrade,
  applyBranchDevelopmentV4Upgrade,
  planBranchDevelopmentV3Upgrade,
  planBranchDevelopmentV4Upgrade,
  upgradeGelsangBindingsToV3,
} from "./development-mode-seed-data.mjs";

describe("branch-development seed data", () => {
  it("upgrades only an official v2 branch-development binding to the pinned v3 graph", () => {
    expect(planBranchDevelopmentV3Upgrade({
      id: "project_1",
      developmentTemplateKey: "branch-development",
      developmentTemplateVersion: 2,
      loopBindings: [{
        id: "binding_1",
        bindingRole: "task_development",
        loopDefinitionId: "loop_definition_branch_task_v2",
        activeVersionId: "loop_version_branch_task_v2",
      }],
    })).toEqual({ projectId: "project_1", bindingId: "binding_1" });

    for (const project of [
      {
        id: "custom_project",
        developmentTemplateKey: "custom-branch-development",
        developmentTemplateVersion: 2,
        loopBindings: [{ id: "custom_binding", bindingRole: "task_development", loopDefinitionId: "custom_definition", activeVersionId: "custom_version" }],
      },
      {
        id: "already_v3",
        developmentTemplateKey: "branch-development",
        developmentTemplateVersion: 3,
        loopBindings: [{ id: "binding_v3", bindingRole: "task_development", loopDefinitionId: "loop_definition_branch_task_v2", activeVersionId: "loop_version_branch_task_v3" }],
      },
      {
        id: "modified_binding",
        developmentTemplateKey: "branch-development",
        developmentTemplateVersion: 2,
        loopBindings: [{ id: "binding_modified", bindingRole: "task_development", loopDefinitionId: "loop_definition_branch_task_v2", activeVersionId: "user_published_v2_patch" }],
      },
    ]) {
      expect(planBranchDevelopmentV3Upgrade(project)).toBeNull();
    }
  });

  it("applies the v3 upgrade with exact compare-and-set predicates", async () => {
    const tx = {
      projectLoopBinding: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      project: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };

    await applyBranchDevelopmentV3Upgrade(tx, { projectId: "project_1", bindingId: "binding_1" });

    expect(tx.projectLoopBinding.updateMany).toHaveBeenCalledWith({
      where: {
        id: "binding_1",
        projectId: "project_1",
        bindingRole: "task_development",
        loopDefinitionId: "loop_definition_branch_task_v2",
        activeVersionId: "loop_version_branch_task_v2",
      },
      data: { activeVersionId: "loop_version_branch_task_v3", version: { increment: 1 } },
    });
    expect(tx.project.updateMany).toHaveBeenCalledWith({
      where: { id: "project_1", developmentTemplateKey: "branch-development", developmentTemplateVersion: 2 },
      data: { developmentTemplateVersion: 3, version: { increment: 1 } },
    });
  });

  it("publishes valid Gelsang, Task Development, and Milestone Release Loop graphs", () => {
    expect(validateLoopGraph(GELSANG_PROJECT_LOOP_GRAPH)).toEqual({ ok: true, maxTransitions: 42 });
    expect(validateLoopGraph(TASK_DEVELOPMENT_GRAPH)).toEqual({ ok: true, maxTransitions: 10 });
    expect(validateLoopGraph(TASK_DEVELOPMENT_GRAPH_V4)).toEqual({ ok: true, maxTransitions: 10 });
    expect(validateLoopGraph(MILESTONE_RELEASE_GRAPH)).toEqual({ ok: true, maxTransitions: 24 });
  });

  it("publishes every current platform Loop as a catalog-compatible v2 graph", () => {
    const currentLoops = PLATFORM_LOOP_DEFINITIONS.filter((loop) => loop.latest !== false);

    expect(currentLoops.map((loop) => ({
      versionId: loop.versionId,
      schemaVersion: loop.graph.schemaVersion,
    }))).toEqual([
      { versionId: "loop_version_gelsang_project_v3", schemaVersion: 2 },
      { versionId: "loop_version_branch_task_v4", schemaVersion: 2 },
      { versionId: "loop_version_branch_release_v2", schemaVersion: 2 },
    ]);
    expect(currentLoops.map((loop) => projectPlatformLoopGraphV2(loop.graph))).toHaveLength(3);

    const taskDevelop = currentLoops
      .find((loop) => loop.versionId === "loop_version_branch_task_v4")
      ?.graph.nodes.find((node) => node.key === "develop");
    expect(taskDevelop).toMatchObject({
      type: "subloop_call",
      targetLoopDefinitionId: "loop_definition_gelsang_project_v1",
      targetLoopVersionId: "loop_version_gelsang_project_v3",
    });
  });

  it("derives the persisted LoopVersion schema from the current graph", () => {
    const currentGelsang = PLATFORM_LOOP_DEFINITIONS.find((loop) => (
      loop.versionId === "loop_version_gelsang_project_v3"
    ));

    expect(buildPlatformLoopVersionWriteData(currentGelsang)).toMatchObject({
      versionNumber: 3,
      graphSchemaVersion: 2,
      graph: currentGelsang.graph,
      maxStages: 16,
      maxRepeatCount: 2,
      platformMaxTransitions: 42,
      publishedByUserId: "user_owner",
      status: "published",
    });
  });

  it("upgrades v3 bindings to the recoverable v4 graphs with compare-and-set predicates", async () => {
    const project = {
      id: "project_1",
      developmentTemplateKey: "branch-development",
      developmentTemplateVersion: 3,
      loopBindings: [{
        id: "binding_1",
        bindingRole: "task_development",
        loopDefinitionId: "loop_definition_branch_task_v2",
        activeVersionId: "loop_version_1371f7b55b9964ecee539c40b247fe6b43b6242be44a7a50e06c05097aada64b",
      }],
    };
    expect(planBranchDevelopmentV4Upgrade(project)).toEqual({
      projectId: "project_1",
      bindingId: "binding_1",
      activeVersionId: project.loopBindings[0].activeVersionId,
    });
    const tx = {
      projectLoopBinding: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      project: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    await applyBranchDevelopmentV4Upgrade(tx, planBranchDevelopmentV4Upgrade(project));
    expect(tx.projectLoopBinding.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ activeVersionId: project.loopBindings[0].activeVersionId }),
      data: { activeVersionId: "loop_version_branch_task_v4", version: { increment: 1 } },
    }));
    expect(tx.project.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ developmentTemplateVersion: 3 }),
      data: { developmentTemplateVersion: 4, version: { increment: 1 } },
    }));
  });

  it("upgrades only known Gelsang predecessor bindings", async () => {
    const tx = { projectLoopBinding: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) } };
    await upgradeGelsangBindingsToV3(tx);
    expect(tx.projectLoopBinding.updateMany).toHaveBeenCalledWith({
      where: {
        loopDefinitionId: "loop_definition_gelsang_project_v1",
        activeVersionId: { in: [
          "loop_version_gelsang_project_v1",
          "loop_version_4b3f3bd997f2b0eadff784f1d315fac0e463f526a937017620356d0d3c6e1659",
        ] },
      },
      data: { activeVersionId: "loop_version_gelsang_project_v3", version: { increment: 1 } },
    });
  });

  it("keeps manifest recovery inside the current Gelsang Loop graph", () => {
    expect(GELSANG_PROJECT_LOOP_GRAPH.nodes.find((node) => node.key === "analyze_requirement"))
      .toMatchObject({ interactionPolicy: { kind: "requirement_conversation" } });
    expect(GELSANG_PROJECT_LOOP_GRAPH.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "develop", target: "write_prd", kind: "feedback", outcome: "rework", maxTraversals: 2 }),
      expect.objectContaining({ source: "develop", target: "write_plan", kind: "feedback", outcome: "rework", maxTraversals: 2 }),
    ]));
  });

  it("publishes the Gelsang task Loop under its user-facing name", () => {
    expect(PLATFORM_LOOP_DEFINITIONS).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "Gelsang Project Loop",
        definitionId: "loop_definition_gelsang_project_v1",
        versionId: "loop_version_gelsang_project_v3",
        scope: "task",
      }),
    ]));
  });

  it("keeps Gelsang out of the project development template", () => {
    expect(BRANCH_DEVELOPMENT_TEMPLATE_V2.developmentLoopVersionId).not.toBe("loop_version_gelsang_project_v1");
    expect(BRANCH_DEVELOPMENT_TEMPLATE_V2.releaseLoopVersionId).not.toBe("loop_version_gelsang_project_v1");
    expect(PLATFORM_LOOP_DEFINITIONS.find((loop) => loop.versionId === BRANCH_DEVELOPMENT_TEMPLATE_V2.developmentLoopVersionId)).toMatchObject({ scope: "project" });
    expect(PLATFORM_LOOP_DEFINITIONS.find((loop) => loop.versionId === BRANCH_DEVELOPMENT_TEMPLATE_V2.releaseLoopVersionId)).toMatchObject({ scope: "project" });
  });

  it("requires human approval before the production release action", () => {
    const approval = MILESTONE_RELEASE_GRAPH.nodes.find((node) => node.key === "production_approval");
    const release = MILESTONE_RELEASE_GRAPH.nodes.find((node) => node.key === "release_production");
    expect(approval).toMatchObject({ type: "human_gate", executionTarget: "platform" });
    expect(release).toMatchObject({ type: "agent_action", executionTarget: "local" });
    expect(MILESTONE_RELEASE_GRAPH.edges).toContainEqual(expect.objectContaining({
      source: "production_approval",
      target: "release_production",
      outcome: "pass",
    }));
  });

  it("publishes only the current branch-development template version", () => {
    expect(projectDevelopmentTemplateSchema.parse(BRANCH_DEVELOPMENT_TEMPLATE_V4)).toMatchObject({
      key: "branch-development",
      name: "分支开发",
      version: 4,
      status: "published",
      developmentLoopVersionId: "loop_version_branch_task_v4",
      releaseLoopVersionId: "loop_version_branch_release_v2",
      spaceId: PLATFORM_LOOP_SPACE_ID,
      origin: "platform",
      kind: "branch-development",
      description: "任务分支开发和里程碑发布（Develop 固定引用可恢复任务级 Loop）",
      createdByUserId: "user_owner",
      sourceTemplateId: null,
      revision: 1,
    });
  });

  it("routes the current Task Development Loop through the task SubLoop", () => {
    expect(TASK_DEVELOPMENT_GRAPH.nodes.find((node) => node.key === "develop")).toMatchObject({
      type: "agent_action",
      executionTarget: "local",
    });
    expect(TASK_DEVELOPMENT_GRAPH_V2.nodes.find((node) => node.key === "develop")).toMatchObject({
      type: "platform_action",
      executionTarget: "platform",
      action: "task_loop.invoke",
    });
    expect(TASK_DEVELOPMENT_GRAPH_V3.nodes.find((node) => node.key === "develop")).toMatchObject({
      type: "subloop_call",
      executionTarget: "platform",
      targetLoopDefinitionId: "loop_definition_gelsang_project_v1",
      targetLoopVersionId: "loop_version_gelsang_project_v1",
    });
    expect(TASK_DEVELOPMENT_GRAPH_V4.nodes.find((node) => node.key === "develop")).toMatchObject({
      type: "subloop_call",
      executionTarget: "platform",
      targetLoopVersionId: "loop_version_gelsang_project_v3",
    });
    expect(BRANCH_DEVELOPMENT_TEMPLATE_V3).toMatchObject({
      key: "branch-development",
      version: 3,
      developmentLoopVersionId: "loop_version_branch_task_v3",
      releaseLoopVersionId: "loop_version_branch_release_v2",
    });
    expect(MILESTONE_RELEASE_GRAPH_V2.nodes.find((node) => node.key === "release_production")?.promptTemplate)
      .toMatch(/push.*production branch.*remote|remote.*production branch.*push/iu);
    const taskDevelopmentVersions = PLATFORM_LOOP_DEFINITIONS.filter((loop) => loop.definitionId === "loop_definition_branch_task_v2");
    expect(taskDevelopmentVersions).toEqual(expect.arrayContaining([
      expect.objectContaining({ versionId: "loop_version_branch_task_v2", versionNumber: 1, latest: false }),
      expect.objectContaining({
        versionId: "loop_version_branch_task_v3",
        versionNumber: 2,
        latest: false,
        previousLatestVersionIds: ["loop_version_branch_task_v2"],
      }),
      expect.objectContaining({ versionId: "loop_version_branch_task_v4", versionNumber: 4, latest: true }),
    ]));
    expect(PLATFORM_LOOP_DEFINITIONS.map((loop) => loop.definitionId)).not.toContain("loop_definition_branch_release_v1");
  });

  it("marks every seeded Loop definition as a platform-owned project resource", () => {
    expect(PLATFORM_LOOP_SCOPE).toBe("project");
    expect(PLATFORM_LOOP_ORIGIN).toBe("platform");
    expect(PLATFORM_LOOP_DEFINITIONS).toHaveLength(6);
    expect(PLATFORM_LOOP_DEFINITIONS).toEqual(expect.arrayContaining([
      expect.objectContaining({
        spaceId: PLATFORM_LOOP_SPACE_ID,
        scope: "project",
        origin: "platform",
        ownerUserId: "user_owner",
      }),
    ]));
    expect(new Set(PLATFORM_LOOP_DEFINITIONS.map((loop) => loop.definitionId)).size).toBe(3);
    expect(new Set(PLATFORM_LOOP_DEFINITIONS.filter((loop) => loop.scope === "project").map((loop) => loop.definitionId)).size).toBe(2);
    expect(PLATFORM_LOOP_DEFINITIONS.filter((loop) => loop.scope === "task")).toHaveLength(2);
    expect(PLATFORM_LOOP_DEFINITIONS.every((loop) => loop.spaceId === PLATFORM_LOOP_SPACE_ID && loop.origin === "platform")).toBe(true);
  });
});

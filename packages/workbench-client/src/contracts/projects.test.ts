import { describe, expect, it } from "vitest";

import {
  desktopProjectCollectionResponseSchema,
  desktopProjectDetailResponseSchema,
  desktopWorkspaceConfigurationMutationResponseSchema,
  workspaceConfigurationRevokeRequestSchema,
  workspaceConfigurationUpsertRequestSchema,
} from "./projects";
import { parseForwardCompatibleResponse } from "../response-compatibility";

const project = {
  id: "project_1",
  name: "Atlas",
  spaceLabel: "Acme",
  objective: "交付桌面项目工作区",
  owner: { id: "user_1", name: "Owner" },
  status: "active",
  health: "blocked",
  progress: { completed: 2, total: 4, percent: 50 },
  taskCounts: { open: 6, overdue: 2, blocked: 1 },
  nextMilestone: {
    id: "milestone_2",
    name: "Beta",
    targetAt: "2026-08-01T00:00:00.000Z",
    status: "active",
  },
  updatedAt: "2026-07-27T08:00:00.000Z",
};

describe("desktop Project contracts", () => {
  it("accepts only path-free Workspace configuration commands", () => {
    expect(workspaceConfigurationUpsertRequestSchema.parse({
      commandId: "workspace:update:1",
      expectedVersion: 2,
      status: "ready",
      pathFingerprint: "hmac-sha256:abc123",
      validatedAt: "2026-07-31T08:00:00.000Z",
    })).toEqual({
      commandId: "workspace:update:1",
      expectedVersion: 2,
      status: "ready",
      pathFingerprint: "hmac-sha256:abc123",
      validatedAt: "2026-07-31T08:00:00.000Z",
    });
    expect(workspaceConfigurationUpsertRequestSchema.safeParse({
      commandId: "workspace:update:2",
      status: "ready",
      pathFingerprint: "hmac-sha256:abc123",
      validatedAt: "2026-07-31T08:00:00.000Z",
      absolutePath: "/Users/alice/Atlas",
    }).success).toBe(false);
    expect(workspaceConfigurationRevokeRequestSchema.parse({
      commandId: "workspace:revoke:1",
      expectedVersion: 3,
    })).toEqual({ commandId: "workspace:revoke:1", expectedVersion: 3 });
  });

  it("validates a path-free Workspace mutation response", () => {
    const result = desktopWorkspaceConfigurationMutationResponseSchema.parse({
      ok: true,
      data: {
        workspace: {
          bindingId: "workspace_binding_1",
          status: "ready",
          pathFingerprint: "hmac-sha256:abc123",
          configurationVersion: 2,
          lastValidatedAt: "2026-07-31T08:00:00.000Z",
        },
      },
    });

    expect(result.data.workspace.bindingId).toBe("workspace_binding_1");
    expect(desktopWorkspaceConfigurationMutationResponseSchema.safeParse({
      ...result,
      data: {
        workspace: {
          ...result.data.workspace,
          absolutePath: "/Users/alice/Atlas",
        },
      },
    }).success).toBe(false);
  });

  it("accepts serialized project collection dates", () => {
    const result = desktopProjectCollectionResponseSchema.parse({
      ok: true,
      data: { projects: [project] },
    });

    expect(result.data.projects[0]?.updatedAt).toBe("2026-07-27T08:00:00.000Z");
  });

  it("rejects internal Space identifiers from the public desktop payload", () => {
    expect(() => desktopProjectCollectionResponseSchema.parse({
      ok: true,
      data: { projects: [{ ...project, spaceId: "space:company:company_1" }] },
    })).toThrow();
  });

  it("rejects external navigation targets", () => {
    expect(() => desktopProjectDetailResponseSchema.parse({
      ok: true,
      data: {
        detail: {
          project: {
            ...project,
            description: null,
            startAt: null,
            targetAt: null,
            visibility: "company",
            capabilities: { edit: false, manageMembers: false, changeLifecycle: false, manageRoadmap: false, nativeWorkspace: false },
          },
          health: { objectiveState: "complete", currentStageName: null, nextAction: "推进下一里程碑", blockers: 0, overdueTasks: 0 },
          taskSummary: { total: 1, open: 1, overdue: 0, blocked: 0, completed: 0 },
          resources: { documents: 0, members: 0, activities: 0, automationState: "未自动化" },
          roadmap: [],
          tasks: [{ id: "task_1", title: "Task", status: "todo", priority: 0, assigneeName: null, milestoneId: null, updatedAt: project.updatedAt, route: "https://attacker.example" }],
          documents: [], risks: [], agents: [],
          workspace: null,
        },
      },
    })).toThrow();
  });

  it("validates roadmap, resources, risks, Agents and authorized native workspace", () => {
    const result = parseForwardCompatibleResponse(desktopProjectDetailResponseSchema, {
      ok: true,
      futureEnvelopeField: "ignored",
      data: {
        futureDataField: "ignored",
        detail: {
          futureDetailField: "ignored",
          project: {
            ...project,
            futureProjectField: "ignored",
            description: "Desktop delivery",
            startAt: null,
            targetAt: "2026-09-01T00:00:00.000Z",
            visibility: "company",
            capabilities: {
              edit: true,
              manageMembers: true,
              changeLifecycle: true,
              manageRoadmap: true,
              nativeWorkspace: true,
              futureCapabilityField: true,
            },
          },
          health: {
            objectiveState: "complete",
            currentStageName: "Build",
            nextAction: "处理阻塞任务",
            blockers: 1,
            overdueTasks: 2,
          },
          taskSummary: { total: 10, open: 6, overdue: 2, blocked: 1, completed: 4 },
          resources: { documents: 1, members: 3, activities: 0, automationState: "已自动化" },
          roadmap: [{
            id: "stage_1",
            version: 3,
            sortOrder: 0,
            name: "Build",
            status: "active",
            startAt: null,
            targetAt: null,
            completedMilestones: 1,
            totalMilestones: 2,
            milestones: [{
              id: "milestone_1",
              version: 2,
              sortOrder: 0,
              name: "Alpha",
              status: "completed",
              targetAt: null,
              taskCount: 4,
              riskSummary: null,
              tasks: [{ id: "task_1", title: "实现项目中心", status: "doing", version: 4 }],
            }],
          }],
          tasks: [{
            id: "task_1",
            title: "实现项目中心",
            status: "doing",
            priority: 2,
            assigneeName: "Owner",
            milestoneId: "milestone_1",
            updatedAt: "2026-07-27T08:00:00.000Z",
            route: "/tasks?project=project_1&taskId=task_1",
          }],
          documents: [{
            id: "doc_1",
            title: "Architecture",
            path: "architecture.md",
            version: 3,
            updatedAt: "2026-07-27T08:00:00.000Z",
            route: "/documents/doc_1",
          }],
          risks: [{ id: "milestone_2", name: "Beta", status: "at_risk", summary: "依赖未确认" }],
          agents: [{
            id: "workflow_1",
            title: "Codex implementation",
            status: "active",
            currentStepKey: "implement",
            updatedAt: "2026-07-27T08:00:00.000Z",
            route: "/agents?workflow=workflow_1",
          }],
          workspace: {
            bindingId: "workspace_binding_1",
            status: "ready",
            pathFingerprint: "hmac-sha256:abc123",
            configurationVersion: 2,
            lastValidatedAt: "2026-07-31T08:00:00.000Z",
          },
        },
      },
    });

    expect(result.data.detail.project.capabilities.nativeWorkspace).toBe(true);
    expect(result.data.detail.roadmap[0]?.milestones[0]?.tasks[0]?.title).toBe("实现项目中心");
    expect(result).not.toHaveProperty("futureEnvelopeField");
    expect(result.data).not.toHaveProperty("futureDataField");
    expect(result.data.detail).not.toHaveProperty("futureDetailField");
    expect(result.data.detail.project).not.toHaveProperty("futureProjectField");
    expect(result.data.detail.project.capabilities).not.toHaveProperty("futureCapabilityField");
    expect(JSON.stringify(result)).not.toMatch(/localPath|defaultCommand|\/workspace\/atlas/u);
  });
});

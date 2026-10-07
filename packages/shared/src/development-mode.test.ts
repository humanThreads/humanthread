import { describe, expect, it } from "vitest";

import {
  branchDevelopmentConfigSchema,
  developmentTemplateOriginSchema,
  milestoneReleaseReadyEventSchema,
  milestoneReleaseSnapshotSchema,
  projectDevelopmentTemplateSchema,
  developmentTemplateIndustrySchema,
  projectLoopBindingRoleSchema,
  taskBranchAssignmentSchema,
  taskTestReportSchema,
} from "./development-mode";

const commitA = "a".repeat(40);
const commitB = "b".repeat(40);

function validTaskTestReport() {
  return {
    taskId: "task_1",
    branch: "2026-HT100001",
    commit: commitA,
    status: "passed" as const,
    requirements: [{
      requirementId: "login-timeout-fixed",
      status: "passed" as const,
      evidenceRefs: ["artifact_requirement_1"],
    }],
    checks: [{
      name: "integration-test",
      status: "passed" as const,
      evidenceRefs: ["artifact_check_1"],
    }],
  };
}

describe("project development mode contracts", () => {
  const templateFixture = {
    id: "development_template_branch_1",
    key: "branch-development",
    name: "分支开发",
    version: 1,
    status: "published" as const,
    projectConfigSchema: {},
    taskFieldSchema: {},
    developmentLoopVersionId: "loop_version_development_1",
    releaseLoopVersionId: "loop_version_release_1",
    triggerPolicy: {},
    executionPolicy: {},
  };

  it("parses platform-owned catalog metadata", () => {
    expect(developmentTemplateOriginSchema.parse("platform")).toBe("platform");
    expect(projectDevelopmentTemplateSchema.parse({
      ...templateFixture,
      spaceId: null,
      origin: "platform",
      kind: "branch-development",
      description: "任务分支开发和里程碑发布",
      createdByUserId: null,
      sourceTemplateId: null,
      revision: 1,
    })).toMatchObject({ origin: "platform", kind: "branch-development", revision: 1 });
  });

  it("accepts only the supported Loop market industries and public metadata", () => {
    expect(developmentTemplateIndustrySchema.parse("信息技术")).toBe("信息技术");
    expect(projectDevelopmentTemplateSchema.parse({
      ...templateFixture,
      spaceId: "space_1",
      origin: "space",
      kind: "branch-development",
      description: null,
      createdByUserId: "user_1",
      sourceTemplateId: null,
      revision: 1,
      isPublic: true,
      publicAt: "2026-09-12T00:00:00.000Z",
      deletedAt: null,
      industryTags: ["信息技术", "金融业"],
      starCount: 3,
    })).toMatchObject({ isPublic: true, industryTags: ["信息技术", "金融业"], starCount: 3 });
  });

  it("allows draft catalog templates without Loop versions", () => {
    expect(projectDevelopmentTemplateSchema.safeParse({
      ...templateFixture,
      status: "draft",
      spaceId: "space_1",
      origin: "space",
      kind: "branch-development",
      description: null,
      createdByUserId: "user_1",
      sourceTemplateId: null,
      revision: 2,
      developmentLoopVersionId: null,
      releaseLoopVersionId: null,
    }).success).toBe(true);
  });

  it("rejects published catalog templates without both Loop versions", () => {
    expect(projectDevelopmentTemplateSchema.safeParse({
      ...templateFixture,
      spaceId: null,
      origin: "platform",
      kind: "branch-development",
      description: null,
      createdByUserId: null,
      sourceTemplateId: null,
      revision: 1,
      developmentLoopVersionId: null,
    }).success).toBe(false);
  });

  it("normalizes the branch-development defaults", () => {
    expect(branchDevelopmentConfigSchema.parse({
      productionBranch: "main",
      stagingBranch: "staging",
      releaseAgentProfileId: "profile_release",
    })).toEqual({
      productionBranch: "main",
      stagingBranch: "staging",
      releaseAgentProfileId: "profile_release",
      taskBranchPattern: "{year}-{shortId}",
      taskBranchBase: "staging",
      taskBranchCreation: "on_first_execution",
      integrationMode: "local_merge_test_push",
      productionApprovalRequired: true,
      releaseTriggers: ["milestone.release_ready", "manual"],
    });
  });

  it("rejects identical production and staging branches", () => {
    expect(branchDevelopmentConfigSchema.safeParse({
      productionBranch: "main",
      stagingBranch: "main",
      releaseAgentProfileId: "profile_release",
    }).success).toBe(false);
  });

  it("requires a published template to reference both Loop versions", () => {
    expect(projectDevelopmentTemplateSchema.safeParse({
      id: "development_template_branch_1",
      key: "branch-development",
      name: "分支开发",
      version: 1,
      status: "published",
      spaceId: null,
      origin: "platform",
      kind: "branch-development",
      description: null,
      createdByUserId: null,
      sourceTemplateId: null,
      revision: 1,
      projectConfigSchema: {},
      taskFieldSchema: {},
      developmentLoopVersionId: "loop_version_development_1",
      releaseLoopVersionId: "loop_version_release_1",
      triggerPolicy: {},
      executionPolicy: {},
    }).success).toBe(true);
  });
});

describe("task branch and evidence contracts", () => {
  it("accepts a task branch derived from its year and short ID", () => {
    expect(taskBranchAssignmentSchema.parse({
      taskId: "task_1",
      branch: "2026-HT100001",
      year: 2026,
      shortId: "HT100001",
      assignedAt: "2026-08-03T08:00:00.000Z",
      assignedByActor: "agent:codex",
    }).branch).toBe("2026-HT100001");
  });

  it("rejects a branch that does not match its Task identity", () => {
    expect(taskBranchAssignmentSchema.safeParse({
      taskId: "task_1",
      branch: "2026-HT100002",
      year: 2026,
      shortId: "HT100001",
      assignedAt: "2026-08-03T08:00:00.000Z",
      assignedByActor: "agent:codex",
    }).success).toBe(false);
  });

  it("requires evidence for every Task requirement and check", () => {
    expect(taskTestReportSchema.safeParse(validTaskTestReport()).success).toBe(true);
    expect(taskTestReportSchema.safeParse({
      ...validTaskTestReport(),
      requirements: [],
    }).success).toBe(false);
    expect(taskTestReportSchema.safeParse({
      ...validTaskTestReport(),
      checks: [{ name: "integration-test", status: "passed", evidenceRefs: [] }],
    }).success).toBe(false);
  });

  it("rejects a passed report containing an unpassed required result", () => {
    expect(taskTestReportSchema.safeParse({
      ...validTaskTestReport(),
      requirements: [{
        requirementId: "login-timeout-fixed",
        status: "inconclusive",
        evidenceRefs: ["artifact_requirement_1"],
      }],
    }).success).toBe(false);
  });
});

describe("milestone release contracts", () => {
  it("requires every release Task to carry fixed documents, knowledge, and tests", () => {
    const result = milestoneReleaseSnapshotSchema.safeParse({
      projectId: "project_1",
      milestoneId: "milestone_1",
      milestoneVersion: 4,
      triggerType: "milestone_event",
      stagingBranch: "staging",
      tasks: [{
        taskId: "task_1",
        taskNumber: 100001,
        branch: "2026-HT100001",
        headCommit: commitA,
        taskDocument: { documentId: "document_1", version: 3 },
        knowledgeRefs: [{ path: "docs/knowledge/login.md", commit: commitA }],
        testReportRef: "artifact_test_report_1",
      }],
      stagingBaseCommit: commitB,
      productionBaseCommit: commitA,
      createdAt: "2026-08-03T08:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a release Task without knowledge references", () => {
    expect(milestoneReleaseSnapshotSchema.safeParse({
      projectId: "project_1",
      milestoneId: "milestone_1",
      milestoneVersion: 4,
      triggerType: "manual",
      stagingBranch: "staging",
      tasks: [{
        taskId: "task_1",
        taskNumber: 100001,
        branch: "2026-HT100001",
        headCommit: commitA,
        taskDocument: { documentId: "document_1", version: 3 },
        knowledgeRefs: [],
        testReportRef: "artifact_test_report_1",
      }],
      stagingBaseCommit: commitB,
      productionBaseCommit: commitA,
      createdAt: "2026-08-03T08:00:00.000Z",
    }).success).toBe(false);
  });

  it("exposes only the two development binding roles", () => {
    expect(projectLoopBindingRoleSchema.options).toEqual(["task_development", "milestone_release"]);
  });

  it("validates milestone release-ready event identity", () => {
    expect(milestoneReleaseReadyEventSchema.parse({
      projectId: "project_1",
      milestoneId: "milestone_1",
      milestoneVersion: 4,
    })).toEqual({ projectId: "project_1", milestoneId: "milestone_1", milestoneVersion: 4 });
  });
});

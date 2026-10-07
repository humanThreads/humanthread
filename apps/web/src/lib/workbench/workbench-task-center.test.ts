import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildTaskCenterRoute,
  deriveTaskCenterState,
  getTaskCenterIntentDefinition,
  getTaskCenterTemplateDefinition,
  normalizeTaskCenterIntentKey,
  normalizeTaskCenterTemplateKey,
} from "./workbench-task-center";
import { getLegacyTaskUsageSnapshot, resetLegacyTaskUsage } from "../tasks/task-rollout";

describe("workbench task center helper", () => {
  beforeEach(() => {
    resetLegacyTaskUsage();
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  it("normalizes supported template and intent keys", () => {
    expect(normalizeTaskCenterTemplateKey("requirement-review")).toBe(
      "requirement-review",
    );
    expect(normalizeTaskCenterTemplateKey("unknown")).toBeNull();
    expect(normalizeTaskCenterIntentKey("dispatch_by_owner")).toBe(
      "dispatch_by_owner",
    );
    expect(normalizeTaskCenterIntentKey("unknown")).toBeNull();
  });

  it("keeps template presets actionable for quick creation", () => {
    expect(getTaskCenterTemplateDefinition("requirement-review")).toMatchObject({
      title: "需求确认模板",
      savedView: "missing_context",
      quickCreate: {
        phase: "确认需求",
        priority: "medium",
        acceptanceCriteria: ["明确目标边界", "列出验收条件", "补齐负责人"],
        requiredDocs: ["需求说明", "验收标准"],
        agentPrerequisites: ["可选，不强依赖 Agent"],
      },
    });
  });

  it("builds task center routes that preserve saved view, template, and intent state", () => {
    expect(
      buildTaskCenterRoute({
        savedView: "agent_ready",
        filterKey: "all",
        viewKey: "owner",
        taskId: "task_1",
        spaceKey: "company_1",
        templateKey: "agent-dispatch",
        intentKey: "dispatch_by_owner",
      }),
    ).toBe(
      "/tasks?space=company_1&spaceKey=company_1&view=owner&taskId=task_1&savedView=agent_ready&template=agent-dispatch&intent=dispatch_by_owner",
    );
    expect(getTaskCenterIntentDefinition("clear_risk")).toMatchObject({
      title: "风险清理视图",
    });
  });

  it("records one legacy read when deriving the old task center projection", () => {
    deriveTaskCenterState({
      allTasks: [],
      inboxGroups: [],
      selectedTaskId: null,
      detailTaskId: null,
      savedView: null,
    });

    expect(getLegacyTaskUsageSnapshot()).toMatchObject({
      reads: 1,
      surfaces: { "workbench-task-center": 1 },
    });
  });
});

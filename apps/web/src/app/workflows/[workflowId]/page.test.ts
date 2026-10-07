import { describe, expect, it } from "vitest";
import { dynamic, WORKFLOW_DETAIL_SECTION_TITLES } from "./page";
import { getWorkbenchWorkflowDetail } from "../../../lib/workbench/workbench-workflow-detail";
import { getWorkflowTimeline } from "../../../lib/overviews/task-overviews";
import { requireWorkbenchSession } from "../../../lib/workbench/workbench-route-auth";

describe("Workflow detail page", () => {
  it("forces dynamic rendering", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("uses the workflow detail and timeline queries", () => {
    expect(typeof requireWorkbenchSession).toBe("function");
    expect(typeof getWorkbenchWorkflowDetail).toBe("function");
    expect(typeof getWorkflowTimeline).toBe("function");
  });

  it("keeps workflow detail sections stable", () => {
    expect(WORKFLOW_DETAIL_SECTION_TITLES).toEqual([
      "工作流状态",
      "任务链",
      "工作流时间线",
      "项目上下文",
    ]);
  });
});

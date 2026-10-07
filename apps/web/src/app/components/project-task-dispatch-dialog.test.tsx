// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectTaskDispatchDialog } from "./project-task-dispatch-dialog";

afterEach(cleanup);

describe("ProjectTaskDispatchDialog", () => {
  it("renders scope, acceptance, budget and agent assignment fields", () => {
    render(
      <ProjectTaskDispatchDialog
        open
        projectId="project_1"
        milestones={[{ id: "m1", name: "MVP" }]}
        profiles={[{ id: "codex", name: "Codex", provider: "codex" }]}
        onClose={() => {}}
      />,
    );
    expect(screen.getByRole("dialog", { name: "派发任务" })).toBeTruthy();
    expect(screen.getByLabelText("允许修改的路径")).toBeTruthy();
    expect(screen.getByLabelText("必需检查")).toBeTruthy();
    expect(screen.getByLabelText("最大尝试次数")).toBeTruthy();
    expect(screen.getByText("Codex · codex")).toBeTruthy();
  });
});

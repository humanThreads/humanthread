import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ProjectHubHeader } from "./project-hub-header";
import type { ProjectHubView } from "../../../lib/workbench/workbench-projects";

const project = {
  id: "project_1",
  name: "Atlas",
  health: "healthy",
  status: "active",
  spaceLabel: "研发空间",
  owner: { name: "负责人" },
  startAt: null,
  targetAt: null,
  stageProgress: { percent: 40 },
} as unknown as ProjectHubView["project"];

describe("ProjectHubHeader", () => {
  it("links to the project knowledge workspace", () => {
    const markup = renderToStaticMarkup(<ProjectHubHeader project={project} />);
    expect(markup).toContain('href="/projects/project_1/knowledge"');
    expect(markup).toContain("项目知识库");
  });

  it("links to the project scheduled task workspace", () => {
    const markup = renderToStaticMarkup(<ProjectHubHeader project={project} />);
    expect(markup).toContain('href="/projects/project_1/scheduled-tasks"');
    expect(markup).toContain("定时任务");
  });
});

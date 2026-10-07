import { describe, expect, it } from "vitest";
import {
  DEVELOPMENT_TEMPLATE_EDITOR_PAGE_TITLE,
  developmentTemplateEditorPath,
  dynamic,
  mergeDevelopmentTemplateLoopVersions,
} from "./page";

describe("Development template editor page", () => {
  it("uses a dynamic route and encodes template IDs", () => {
    expect(dynamic).toBe("force-dynamic");
    expect(DEVELOPMENT_TEMPLATE_EDITOR_PAGE_TITLE).toBe("开发模板编辑器");
    expect(developmentTemplateEditorPath("space/template 1")).toBe("/templates/development/space%2Ftemplate%201");
  });

  it("merges exact older referenced Loop versions with selectable latest versions", () => {
    const graph = {
      schemaVersion: 1,
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      limits: { maxStages: 8, maxRepeatCount: 2 },
      nodes: [
        { key: "start", label: "开始", type: "start" },
        { key: "end", label: "结束", type: "end" },
      ],
      edges: [{ id: "start-end", source: "start", target: "end", kind: "normal", outcome: "success" }],
    };
    const result = mergeDevelopmentTemplateLoopVersions({
      spaceId: "space_1",
      latestDefinitions: [{
        id: "loop_task", name: "任务开发", scope: "project", origin: "space", spaceId: "space_1",
        latestPublishedVersion: { id: "version_task_3", versionNumber: 3, status: "published", graph },
      }, {
        id: "loop_release", name: "里程碑发版", scope: "project", origin: "platform", spaceId: "platform",
        latestPublishedVersion: { id: "version_release_2", versionNumber: 2, status: "published", graph },
      }],
      referencedVersions: [{
        id: "version_task_1", versionNumber: 1, status: "published", graph,
        loopDefinition: { id: "loop_task", name: "任务开发", scope: "project", origin: "space", spaceId: "space_1" },
      }, {
        id: "version_release_2", versionNumber: 2, status: "published", graph,
        loopDefinition: { id: "loop_release", name: "里程碑发版", scope: "project", origin: "platform", spaceId: "platform" },
      }],
    });

    expect(result.map((loop) => loop.id)).toEqual([
      "version_task_3",
      "version_release_2",
      "version_task_1",
    ]);
    expect(result.find((loop) => loop.id === "version_task_1")).toMatchObject({
      versionNumber: 1,
      definition: { id: "loop_task", scope: "project" },
    });
  });
});

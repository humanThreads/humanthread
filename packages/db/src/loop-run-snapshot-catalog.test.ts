import { describe, expect, it, vi } from "vitest";
import { readPublishedLoopVersionsForProject } from "./loop-run-snapshot-catalog";

describe("readPublishedLoopVersionsForProject", () => {
  it("returns published project-visible versions as snapshot inputs", async () => {
    const db = {
      project: {
        findUnique: vi.fn().mockResolvedValue({ spaceId: "space_1" }),
      },
      loopVersion: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "project_version_1",
            loopDefinitionId: "project_definition_1",
            graph: { schemaVersion: 1, nodes: [], edges: [], limits: {} },
            loopDefinition: { scope: "project" },
          },
          {
            id: "task_version_1",
            loopDefinitionId: "task_definition_1",
            graph: { schemaVersion: 1, nodes: [], edges: [], limits: {} },
            loopDefinition: { scope: "task" },
          },
          {
            id: "unsupported_version_1",
            loopDefinitionId: "unsupported_definition_1",
            graph: {},
            loopDefinition: { scope: "workspace" },
          },
        ]),
      },
    };

    await expect(readPublishedLoopVersionsForProject("project_1", db as never)).resolves.toEqual([
      {
        loopDefinitionId: "project_definition_1",
        loopVersionId: "project_version_1",
        scope: "project",
        graph: { schemaVersion: 1, nodes: [], edges: [], limits: {} },
      },
      {
        loopDefinitionId: "task_definition_1",
        loopVersionId: "task_version_1",
        scope: "task",
        graph: { schemaVersion: 1, nodes: [], edges: [], limits: {} },
      },
    ]);
    expect(db.loopVersion.findMany).toHaveBeenCalledWith({
      where: {
        status: "published",
        loopDefinition: { OR: [{ spaceId: "space_1" }, { origin: "platform" }] },
      },
      select: {
        id: true,
        loopDefinitionId: true,
        graph: true,
        loopDefinition: { select: { scope: true } },
      },
      orderBy: [{ id: "asc" }],
    });
  });

  it("returns no versions when the Project has no migrated Space", async () => {
    const db = {
      project: { findUnique: vi.fn().mockResolvedValue({ spaceId: null }) },
      loopVersion: { findMany: vi.fn() },
    };

    await expect(readPublishedLoopVersionsForProject("project_legacy", db as never)).resolves.toEqual([]);
    expect(db.loopVersion.findMany).not.toHaveBeenCalled();
  });
});

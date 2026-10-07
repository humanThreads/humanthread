import { describe, expect, it, vi } from "vitest";
import { readProjectLoopCatalog, readProjectLoopCatalogV2 } from "./project-loop-catalog";

const graph = {
  schemaVersion: 1,
  inputSchema: { type: "object" },
  outputSchema: { type: "object" },
  limits: { maxStages: 4, maxRepeatCount: 2 },
  nodes: [
    { key: "start", label: "Start", type: "start" },
    { key: "code", label: "Code", type: "agent_action", executionTarget: "local", promptTemplate: "secret prompt", inputSchema: { type: "object" } },
    { key: "end", label: "End", type: "end" },
  ],
  edges: [
    { id: "start-code", source: "start", target: "code", kind: "normal", outcome: "success" },
    { id: "code-end", source: "code", target: "end", kind: "normal", outcome: "success" },
  ],
};

describe("readProjectLoopCatalog", () => {
  it("returns deterministic published structure and redacts local rule content", async () => {
    const catalog = await readProjectLoopCatalog({ userId: "user_1", projectId: "project_1" }, {
      assertCanReadProject: vi.fn().mockResolvedValue(undefined),
      readProject: vi.fn().mockResolvedValue({ id: "project_1", spaceId: "space_1" }),
      listBindings: vi.fn().mockResolvedValue([{
        id: "binding_1",
        loopDefinitionId: "loop_project",
        activeVersionId: "version_1",
        status: "enabled",
        bindingRole: "root",
        version: 2,
        triggerPolicy: { manual: true },
      }]),
      listDefinitions: vi.fn().mockResolvedValue([{
        id: "loop_project",
        spaceId: "space_1",
        name: "Project Loop",
        description: "A project workflow",
        scope: "project",
        origin: "space",
        latestPublishedVersionId: "version_1",
        versions: [{ id: "version_1", versionNumber: 1, graph }],
      }]),
    });

    expect(catalog?.publishedLoops.map(({ loopDefinitionId }) => loopDefinitionId)).toEqual(["loop_project"]);
    expect(catalog?.projectBindings).toEqual([expect.objectContaining({ id: "binding_1", activeVersionId: "version_1" })]);
    expect(JSON.stringify(catalog)).not.toMatch(/promptTemplate|inputSchema|outputSchema|rulesMarkdown|skillFiles|commandText/iu);
    expect(catalog?.catalogVersion).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it("returns null for a project without a migrated Space", async () => {
    await expect(readProjectLoopCatalog({ userId: "user_1", projectId: "project_1" }, {
      assertCanReadProject: vi.fn().mockResolvedValue(undefined),
      readProject: vi.fn().mockResolvedValue({ id: "project_1", spaceId: null }),
      listBindings: vi.fn(),
      listDefinitions: vi.fn(),
    })).resolves.toBeNull();
  });
});

describe("readProjectLoopCatalogV2", () => {
  it("returns routing metadata only in the explicitly versioned catalog", async () => {
    const v2Graph = {
      ...graph,
      schemaVersion: 2,
      routingMetadata: {
        code: { responsibility: "Implement the approved change and produce evidence." },
      },
    };
    const dependencies = {
      assertCanReadProject: vi.fn().mockResolvedValue(undefined),
      readProject: vi.fn().mockResolvedValue({ id: "project_1", spaceId: "space_1" }),
      listBindings: vi.fn().mockResolvedValue([]),
      listDefinitions: vi.fn().mockResolvedValue([{
        id: "loop_project",
        spaceId: "space_1",
        name: "Project Loop",
        description: null,
        scope: "project",
        origin: "space",
        latestPublishedVersionId: "version_2",
        versions: [{ id: "version_2", versionNumber: 2, graph: v2Graph }],
      }]),
    };

    const catalog = await readProjectLoopCatalogV2({ userId: "user_1", projectId: "project_1" }, dependencies);

    expect(catalog?.contractVersion).toBe(2);
    expect(catalog?.publishedLoops[0]?.publishedVersions[0]?.graph.nodes[1]).toMatchObject({
      responsibility: "Implement the approved change and produce evidence.",
      allowedRouteTargets: ["end"],
    });
  });
});

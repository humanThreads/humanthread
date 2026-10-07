import { describe, expect, it, vi } from "vitest";

import { dispatchMcpKnowledgeTool } from "./knowledge-tools";

const PROJECT_DIGEST = "a".repeat(32);

function dependencies() {
  return {
    assertCanReadProject: vi.fn(async () => ({ projectId: "project_1" })),
    knowledgeProjectDigest: vi.fn(() => PROJECT_DIGEST),
    searchIndex: vi.fn(async () => ({ items: [{ entryId: "entry_1", title: "发布门禁" }] })),
    getEntry: vi.fn(async () => ({ id: "entry_1", projectDigest: PROJECT_DIGEST, publishedVersion: 1 })),
    listVersions: vi.fn(async () => [{ id: "version_1", version: 1 }]),
    listNeighborhood: vi.fn(async () => [{ id: "relation_1", direction: "outgoing" }]),
    getArchitectureVersion: vi.fn(async () => ({
      id: "view_version_1",
      viewId: "view_1",
      manifest: {
        manifestVersion: 1,
        viewKey: "architecture.release",
        title: "发布架构",
        generatedAt: "2026-09-20T00:00:00.000Z",
        nodes: [
          { key: "web", title: "Web", kind: "service", layer: "app", summary: "入口", documentRefs: [] },
          { key: "worker", title: "Worker", kind: "service", layer: "app", summary: "执行", documentRefs: [] },
        ],
        edges: [{ key: "e1", from: "web", to: "worker", type: "calls", origin: "inferred", confidence: 0.8, summary: "", evidenceRefs: [] }],
        groups: [],
        entryNodeKeys: ["web"],
        relatedEntryKeys: [],
      },
    })),
  };
}

describe("MCP knowledge tools", () => {
  it("searches through the platform-validated project digest", async () => {
    const deps = dependencies();
    const result = await dispatchMcpKnowledgeTool({
      tool: "search_knowledge",
      actorUserId: "user_1",
      arguments: { projectId: "project_1", query: "发布门禁", limit: 5 },
    }, deps as never);

    expect(deps.assertCanReadProject).toHaveBeenCalledWith({ userId: "user_1", projectId: "project_1" });
    expect(deps.searchIndex).toHaveBeenCalledWith({ projectDigest: PROJECT_DIGEST, query: "发布门禁", limit: 5 });
    expect(result).toMatchObject({ result: { items: [expect.objectContaining({ entryId: "entry_1" })] } });
  });

  it("reads an entry only when it belongs to the authorized project", async () => {
    const deps = dependencies();
    const result = await dispatchMcpKnowledgeTool({
      tool: "get_knowledge_entry",
      actorUserId: "user_1",
      arguments: { projectId: "project_1", entryId: "entry_1" },
    }, deps as never);
    expect(result).toMatchObject({ entry: { id: "entry_1" }, versions: [expect.objectContaining({ version: 1 })] });

    deps.getEntry.mockResolvedValue({ id: "entry_1", projectDigest: "b".repeat(32), publishedVersion: 1 } as never);
    await expect(dispatchMcpKnowledgeTool({
      tool: "get_knowledge_entry",
      actorUserId: "user_1",
      arguments: { projectId: "project_1", entryId: "entry_1" },
    }, deps as never)).rejects.toMatchObject({ code: "not_found" });
  });

  it("returns knowledge relationships and architecture neighborhoods", async () => {
    const deps = dependencies();
    const neighborhood = await dispatchMcpKnowledgeTool({
      tool: "get_knowledge_neighborhood",
      actorUserId: "user_1",
      arguments: { projectId: "project_1", entryId: "entry_1" },
    }, deps as never);
    expect(neighborhood).toMatchObject({ relations: [expect.objectContaining({ id: "relation_1" })] });

    const architecture = await dispatchMcpKnowledgeTool({
      tool: "get_architecture_view",
      actorUserId: "user_1",
      arguments: { projectId: "project_1", viewId: "view_1", nodeKey: "web" },
    }, deps as never);
    expect(architecture).toMatchObject({ view: { id: "view_version_1" }, neighborhood: { node: expect.objectContaining({ key: "web" }) } });
  });

  it("rejects an architecture view that does not belong to the project", async () => {
    const deps = dependencies();
    deps.getArchitectureVersion.mockResolvedValue(null as never);
    await expect(dispatchMcpKnowledgeTool({
      tool: "get_architecture_view",
      actorUserId: "user_1",
      arguments: { projectId: "project_1", viewId: "missing" },
    }, deps as never)).rejects.toMatchObject({ code: "not_found" });
  });
});

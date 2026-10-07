import {
  architectureNeighborhood,
  assertCanReadProject,
  getKnowledgeArchitectureVersion,
  getKnowledgeEntry,
  knowledgeProjectDigest,
  listKnowledgeEntryVersions,
  listKnowledgeNeighborhood,
} from "@humanthread/db";
import { parseArchitectureManifest } from "@humanthread/shared";

import { searchProjectKnowledge } from "../knowledge/knowledge-search-client";

type Dependencies = Partial<{
  assertCanReadProject: typeof assertCanReadProject;
  knowledgeProjectDigest: typeof knowledgeProjectDigest;
  searchIndex: typeof searchProjectKnowledge;
  getEntry: typeof getKnowledgeEntry;
  listVersions: typeof listKnowledgeEntryVersions;
  listNeighborhood: typeof listKnowledgeNeighborhood;
  getArchitectureVersion: typeof getKnowledgeArchitectureVersion;
}>;

export type McpKnowledgeToolRequest =
  | { tool: "search_knowledge"; actorUserId: string; arguments: { projectId: string; query: string; limit?: number; entryType?: string } }
  | { tool: "get_knowledge_entry"; actorUserId: string; arguments: { projectId: string; entryId: string } }
  | { tool: "get_knowledge_neighborhood"; actorUserId: string; arguments: { projectId: string; entryId: string } }
  | { tool: "get_architecture_view"; actorUserId: string; arguments: { projectId: string; viewId: string; nodeKey?: string } };

export async function dispatchMcpKnowledgeTool(
  request: McpKnowledgeToolRequest,
  overrides: Dependencies = {},
) {
  const dependencies = {
    assertCanReadProject,
    knowledgeProjectDigest,
    searchIndex: searchProjectKnowledge,
    getEntry: getKnowledgeEntry,
    listVersions: listKnowledgeEntryVersions,
    listNeighborhood: listKnowledgeNeighborhood,
    getArchitectureVersion: getKnowledgeArchitectureVersion,
    ...overrides,
  };
  const { projectId } = request.arguments;
  await dependencies.assertCanReadProject({ userId: request.actorUserId, projectId });
  const projectDigest = dependencies.knowledgeProjectDigest(projectId);

  switch (request.tool) {
    case "search_knowledge": {
      const result = await dependencies.searchIndex({
        projectDigest,
        query: request.arguments.query,
        ...(request.arguments.limit === undefined ? {} : { limit: request.arguments.limit }),
        ...(request.arguments.entryType ? { entryType: request.arguments.entryType } : {}),
      });
      return { result, keyGuide: { entryId: "result.items[].entryId", viewId: "result.items[].architectureViewId" } };
    }
    case "get_knowledge_entry": {
      const entry = await dependencies.getEntry(request.arguments.entryId);
      if (!entry || entry.projectDigest !== projectDigest) throw notFound("Knowledge entry not found");
      const versions = await dependencies.listVersions(entry.id);
      return { entry, versions, keyGuide: { versionId: "versions[].id", version: "versions[].version" } };
    }
    case "get_knowledge_neighborhood": {
      const entry = await dependencies.getEntry(request.arguments.entryId);
      if (!entry || entry.projectDigest !== projectDigest) throw notFound("Knowledge entry not found");
      const relations = await dependencies.listNeighborhood(entry.id);
      return { entryId: entry.id, relations, keyGuide: { relatedEntryId: "relations[].relatedEntryId", direction: "relations[].direction" } };
    }
    case "get_architecture_view": {
      const view = await dependencies.getArchitectureVersion({ projectDigest, viewId: request.arguments.viewId });
      if (!view) throw notFound("Architecture view not found");
      if (!request.arguments.nodeKey) {
        return { view, neighborhood: null, keyGuide: { nodeKey: "view.manifest.nodes[].key", viewId: "view.id" } };
      }
      const neighborhood = architectureNeighborhood(parseArchitectureManifest(view.manifest), request.arguments.nodeKey);
      return { view, neighborhood, keyGuide: { nodeKey: "view.manifest.nodes[].key", viewId: "view.id" } };
    }
    default:
      throw validationError("Unsupported knowledge tool");
  }
}

function notFound(message: string): Error {
  return Object.assign(new Error(message), { code: "not_found" });
}

function validationError(message: string): Error {
  return Object.assign(new Error(message), { code: "validation_failed" });
}

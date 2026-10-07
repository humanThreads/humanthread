import {
  assertCanReadProject,
  listProjectLoopBindings,
  listPublishedLoopDefinitionsForSpace,
  prisma,
} from "@humanthread/db";
import {
  projectPlatformLoopGraph,
  projectPlatformLoopGraphV2,
  snapshotDigest,
} from "@humanthread/orchestration-core";
import type { LoopGraph, LoopGraphV2 } from "@humanthread/shared";

type JsonRecord = Record<string, unknown>;

export interface ProjectLoopCatalog {
  projectId: string;
  catalogVersion: `sha256:${string}`;
  projectBindings: Array<{
    id: string;
    loopDefinitionId: string;
    activeVersionId: string;
    status: string;
    bindingRole: string | null;
    version: number;
  }>;
  publishedLoops: Array<{
    loopDefinitionId: string;
    spaceId: string;
    name: string;
    description: string | null;
    scope: "project" | "task";
    origin: "platform" | "space";
    readOnly: boolean;
    latestPublishedVersionId: string | null;
    publishedVersions: Array<{
      loopVersionId: string;
      versionNumber: number;
      graph: ReturnType<typeof projectPlatformLoopGraph>;
    }>;
  }>;
}

export interface ProjectLoopCatalogV2 {
  contractVersion: 2;
  projectId: string;
  catalogVersion: `sha256:${string}`;
  projectBindings: ProjectLoopCatalog["projectBindings"];
  publishedLoops: Array<{
    loopDefinitionId: string;
    spaceId: string;
    name: string;
    description: string | null;
    scope: "project" | "task";
    origin: "platform" | "space";
    readOnly: boolean;
    latestPublishedVersionId: string | null;
    publishedVersions: Array<{
      loopVersionId: string;
      versionNumber: number;
      graph: ReturnType<typeof projectPlatformLoopGraphV2>;
    }>;
  }>;
}

interface CatalogDependencies {
  assertCanReadProject(input: { userId: string; projectId: string }): Promise<unknown>;
  readProject(input: { projectId: string }): Promise<{ id: string; spaceId: string | null } | null>;
  listBindings(input: { projectId: string }): Promise<unknown>;
  listDefinitions(input: { spaceId: string }): Promise<unknown[]>;
}

const defaultDependencies: CatalogDependencies = {
  assertCanReadProject: (input) => assertCanReadProject(input),
  readProject: ({ projectId }) => prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, spaceId: true },
  }),
  listBindings: ({ projectId }) => listProjectLoopBindings(projectId),
  listDefinitions: ({ spaceId }) => listPublishedLoopDefinitionsForSpace(spaceId),
};

export async function readProjectLoopCatalog(
  input: { userId: string; projectId: string },
  dependencies: CatalogDependencies = defaultDependencies,
): Promise<ProjectLoopCatalog | null> {
  await dependencies.assertCanReadProject(input);
  const project = await dependencies.readProject({ projectId: input.projectId });
  if (!project?.spaceId) return null;

  const [rawBindings, rawDefinitions] = await Promise.all([
    dependencies.listBindings({ projectId: input.projectId }),
    dependencies.listDefinitions({ spaceId: project.spaceId }),
  ]);
  const projectBindings = normalizeBindings(rawBindings);
  const publishedLoops = normalizeDefinitions(rawDefinitions);
  const payload = { projectId: input.projectId, projectBindings, publishedLoops };

  return {
    ...payload,
    catalogVersion: snapshotDigest(payload),
  };
}

export async function readProjectLoopCatalogV2(
  input: { userId: string; projectId: string },
  dependencies: CatalogDependencies = defaultDependencies,
): Promise<ProjectLoopCatalogV2 | null> {
  await dependencies.assertCanReadProject(input);
  const project = await dependencies.readProject({ projectId: input.projectId });
  if (!project?.spaceId) return null;

  const [rawBindings, rawDefinitions] = await Promise.all([
    dependencies.listBindings({ projectId: input.projectId }),
    dependencies.listDefinitions({ spaceId: project.spaceId }),
  ]);
  const payload = {
    contractVersion: 2 as const,
    projectId: input.projectId,
    projectBindings: normalizeBindings(rawBindings),
    publishedLoops: normalizeDefinitionsV2(rawDefinitions),
  };
  return { ...payload, catalogVersion: snapshotDigest(payload) };
}

function normalizeBindings(value: unknown): ProjectLoopCatalog["projectBindings"] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!isRecord(item)) return null;
      const version = typeof item.version === "number" && Number.isInteger(item.version) ? item.version : null;
      if (
        typeof item.id !== "string"
        || typeof item.loopDefinitionId !== "string"
        || typeof item.activeVersionId !== "string"
        || typeof item.status !== "string"
        || version === null
      ) return null;
      return {
        id: item.id,
        loopDefinitionId: item.loopDefinitionId,
        activeVersionId: item.activeVersionId,
        status: item.status,
        bindingRole: typeof item.bindingRole === "string" ? item.bindingRole : null,
        version,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((a, b) => a.id.localeCompare(b.id));
}

function normalizeDefinitions(value: unknown): ProjectLoopCatalog["publishedLoops"] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!isRecord(item)) return null;
      const scope: "project" | "task" | null = item.scope === "project"
        ? "project"
        : item.scope === "task" || item.scope === undefined || item.scope === null
          ? "task"
          : null;
      const origin: "platform" | "space" | null = item.origin === "platform"
        ? "platform"
        : item.origin === "space" || item.origin === undefined || item.origin === null
          ? "space"
          : null;
      if (
        typeof item.id !== "string"
        || typeof item.spaceId !== "string"
        || typeof item.name !== "string"
        || scope === null
        || origin === null
        || !Array.isArray(item.versions)
      ) return null;
      const publishedVersions = item.versions
        .map((version) => {
          if (!isRecord(version) || typeof version.id !== "string") return null;
          const versionNumber = typeof version.versionNumber === "number" && Number.isInteger(version.versionNumber)
            ? version.versionNumber
            : null;
          if (versionNumber === null) return null;
          try {
            return {
              loopVersionId: version.id,
              versionNumber,
              graph: projectPlatformLoopGraph(version.graph as LoopGraph),
            };
          } catch {
            return null;
          }
        })
        .filter((version): version is NonNullable<typeof version> => version !== null)
        .sort((a, b) => a.versionNumber - b.versionNumber || a.loopVersionId.localeCompare(b.loopVersionId));
      if (publishedVersions.length === 0) return null;
      const latestCandidate = typeof item.latestPublishedVersionId === "string" ? item.latestPublishedVersionId : null;
      return {
        loopDefinitionId: item.id,
        spaceId: item.spaceId,
        name: item.name,
        description: typeof item.description === "string" ? item.description : null,
        scope,
        origin,
        readOnly: origin === "platform",
        latestPublishedVersionId: publishedVersions.some(({ loopVersionId }) => loopVersionId === latestCandidate)
          ? latestCandidate
          : publishedVersions.at(-1)?.loopVersionId ?? null,
        publishedVersions,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((a, b) => a.loopDefinitionId.localeCompare(b.loopDefinitionId));
}

function normalizeDefinitionsV2(value: unknown): ProjectLoopCatalogV2["publishedLoops"] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!isRecord(item)) return null;
      const scope: "project" | "task" | null = item.scope === "project"
        ? "project"
        : item.scope === "task" || item.scope === undefined || item.scope === null
          ? "task"
          : null;
      const origin: "platform" | "space" | null = item.origin === "platform"
        ? "platform"
        : item.origin === "space" || item.origin === undefined || item.origin === null
          ? "space"
          : null;
      if (
        typeof item.id !== "string"
        || typeof item.spaceId !== "string"
        || typeof item.name !== "string"
        || scope === null
        || origin === null
        || !Array.isArray(item.versions)
      ) return null;
      const publishedVersions = item.versions
        .map((version) => {
          if (!isRecord(version) || typeof version.id !== "string") return null;
          const versionNumber = typeof version.versionNumber === "number" && Number.isInteger(version.versionNumber)
            ? version.versionNumber
            : null;
          if (versionNumber === null) return null;
          try {
            return {
              loopVersionId: version.id,
              versionNumber,
              graph: projectPlatformLoopGraphV2(version.graph as LoopGraphV2),
            };
          } catch {
            return null;
          }
        })
        .filter((version): version is NonNullable<typeof version> => version !== null)
        .sort((a, b) => a.versionNumber - b.versionNumber || a.loopVersionId.localeCompare(b.loopVersionId));
      if (publishedVersions.length === 0) return null;
      const latestCandidate = typeof item.latestPublishedVersionId === "string" ? item.latestPublishedVersionId : null;
      return {
        loopDefinitionId: item.id,
        spaceId: item.spaceId,
        name: item.name,
        description: typeof item.description === "string" ? item.description : null,
        scope,
        origin,
        readOnly: origin === "platform",
        latestPublishedVersionId: publishedVersions.some(({ loopVersionId }) => loopVersionId === latestCandidate)
          ? latestCandidate
          : publishedVersions.at(-1)?.loopVersionId ?? null,
        publishedVersions,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((a, b) => a.loopDefinitionId.localeCompare(b.loopDefinitionId));
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

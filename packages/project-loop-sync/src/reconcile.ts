import { stringify } from "yaml";

import {
  projectLoopCatalogV2Schema,
  projectLoopLockSchema,
  projectLoopLockV2Schema,
  projectLoopManifestSchema,
  projectLoopManifestV2Schema,
  type LocalFileInventory,
  type LoopSyncDiagnostic,
  type LoopSyncPlanV2,
  type MaterializedEntry,
  type ProjectLoopCatalogV2,
  type ProjectLoopLock,
  type ProjectLoopLockV2,
  type ProjectLoopManifest,
  type ProjectLoopManifestV2,
} from "./contracts";
import { detectV1Migration, readPreparedExplicitV1Migration } from "./migration";
import { createStagePackageFileGroup } from "./stage-package";

function stableNodeId(node: { key: string; nodeId?: string | undefined }): string {
  return node.nodeId ?? node.key;
}

function requiresLocalRules(node: { type: string; executionTarget?: string | undefined }): boolean {
  return node.type === "agent_action" && (node.executionTarget === "local" || node.executionTarget === "either");
}

function nodeStorageId(owners: Map<string, Set<string>>, loopId: string, nodeId: string): string {
  return (owners.get(nodeId)?.size ?? 0) > 1 ? `${loopId}::${nodeId}` : nodeId;
}

function slug(value: string): string {
  const normalized = value.normalize("NFKD").replace(/[^A-Za-z0-9_-]+/gu, "-").replace(/^-+|-+$/gu, "").toLowerCase();
  return (normalized || "loop").slice(0, 48);
}

function safeId(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]+/gu, "_").slice(0, 128);
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function v2LoopSkeleton(loop: ProjectLoopCatalogV2["publishedLoops"][number]): string {
  return stringify({
    schemaVersion: 2,
    loopId: loop.loopDefinitionId,
    scope: loop.scope,
    name: loop.name,
    latestPublishedVersionId: loop.latestPublishedVersionId,
    publishedVersions: loop.publishedVersions.map((version) => ({
      loopVersionId: version.loopVersionId,
      versionNumber: version.versionNumber,
      graph: version.graph,
    })),
  });
}

function v2NodeOwners(catalog: ProjectLoopCatalogV2): Map<string, Set<string>> {
  const owners = new Map<string, Set<string>>();
  for (const loop of catalog.publishedLoops) {
    for (const version of loop.publishedVersions) {
      for (const node of version.graph.nodes) {
        if (!requiresLocalRules(node)) continue;
        const nodeId = stableNodeId(node);
        const values = owners.get(nodeId) ?? new Set<string>();
        values.add(loop.loopDefinitionId);
        owners.set(nodeId, values);
      }
    }
  }
  return owners;
}

function migrationFiles(entry: MaterializedEntry, inventory: LocalFileInventory, fallbackPath: string): Record<string, string> | null {
  const contents = inputContents(inventory);
  for (const basePath of [entry.path, fallbackPath]) {
    const paths = inventory.files.filter((path) => path.startsWith(`${basePath}/`));
    if (paths.length === 0) continue;
    if (paths.some((path) => contents[path] === undefined)) return null;
    return Object.fromEntries(paths.map((path) => [path.slice(basePath.length + 1), contents[path]!]));
  }
  return null;
}

function inputContents(inventory: LocalFileInventory): Record<string, string> {
  return inventory.contents ?? {};
}

function backupPath(transactionId: string, source: string): string {
  const relative = source.startsWith(".humanthread/") ? source.slice(".humanthread/".length) : source;
  return `.humanthread/runtime/sync/${transactionId}/backup/${relative}`;
}

function resolveSelectedLoopCatalog(catalog: ProjectLoopCatalogV2): {
  catalog: ProjectLoopCatalogV2;
  diagnostics: LoopSyncDiagnostic[];
  blockingIssues: LoopSyncDiagnostic[];
} {
  const loopsById = new Map(catalog.publishedLoops.map((loop) => [loop.loopDefinitionId, loop]));
  const selectedVersions = new Map<string, Set<string>>();
  const diagnostics: LoopSyncDiagnostic[] = [];
  const blockingIssues: LoopSyncDiagnostic[] = [];
  const visited = new Set<string>();
  const queue = catalog.projectBindings
    .filter((binding) => binding.status === "enabled")
    .map((binding) => ({ loopId: binding.loopDefinitionId, versionId: binding.activeVersionId }));

  const reportMissing = (loopId: string, versionId: string, source?: string) => {
    const issue: LoopSyncDiagnostic = {
      code: "active_subloop_unreachable",
      loopId,
      message: source
        ? `Selected Loop dependency is unavailable: ${source} -> ${loopId}@${versionId}`
        : `Selected Loop is unavailable: ${loopId}@${versionId}`,
    };
    diagnostics.push(issue);
    blockingIssues.push(issue);
  };

  while (queue.length > 0) {
    const current = queue.shift()!;
    const visitId = `${current.loopId}::${current.versionId}`;
    if (visited.has(visitId)) continue;
    visited.add(visitId);
    const loop = loopsById.get(current.loopId);
    const version = loop?.publishedVersions.find((candidate) => candidate.loopVersionId === current.versionId);
    if (!loop || !version) {
      reportMissing(current.loopId, current.versionId);
      continue;
    }
    const versions = selectedVersions.get(current.loopId) ?? new Set<string>();
    versions.add(current.versionId);
    selectedVersions.set(current.loopId, versions);
    for (const node of version.graph.nodes) {
      if (node.type !== "subloop_call") continue;
      const targetLoop = loopsById.get(node.targetLoopDefinitionId);
      const targetVersion = targetLoop?.publishedVersions.find((candidate) => candidate.loopVersionId === node.targetLoopVersionId);
      if (!targetLoop || !targetVersion) {
        reportMissing(node.targetLoopDefinitionId, node.targetLoopVersionId, `${current.loopId}@${current.versionId}`);
        continue;
      }
      queue.push({ loopId: node.targetLoopDefinitionId, versionId: node.targetLoopVersionId });
    }
  }

  return {
    catalog: projectLoopCatalogV2Schema.parse({
      ...catalog,
      projectBindings: catalog.projectBindings.filter((binding) => (
        binding.status === "enabled"
        && selectedVersions.get(binding.loopDefinitionId)?.has(binding.activeVersionId)
      )),
      publishedLoops: catalog.publishedLoops.flatMap((loop) => {
        const versions = selectedVersions.get(loop.loopDefinitionId);
        if (!versions) return [];
        return [{ ...loop, publishedVersions: loop.publishedVersions.filter((version) => versions.has(version.loopVersionId)) }];
      }),
    }),
    diagnostics,
    blockingIssues,
  };
}

export function planProjectLoopSyncV2(input: {
  catalog: ProjectLoopCatalogV2;
  previousManifest: ProjectLoopManifest | ProjectLoopManifestV2 | null;
  previousLock: ProjectLoopLock | ProjectLoopLockV2 | null;
  inventory: LocalFileInventory;
  synchronizedAt?: string;
}): LoopSyncPlanV2 {
  const catalog = projectLoopCatalogV2Schema.parse(input.catalog);
  const selection = resolveSelectedLoopCatalog(catalog);
  const selectedCatalog = selection.catalog;
  const previousV2 = input.previousLock?.schemaVersion === 2
    ? projectLoopLockV2Schema.parse(input.previousLock)
    : null;
  const previousV1 = input.previousLock?.schemaVersion === 1
    ? projectLoopLockSchema.parse(input.previousLock)
    : null;
  if (input.previousManifest?.schemaVersion === 1) projectLoopManifestSchema.parse(input.previousManifest);
  if (input.previousManifest?.schemaVersion === 2) projectLoopManifestV2Schema.parse(input.previousManifest);
  const inventory = new Set(input.inventory.files);
  const owners = v2NodeOwners(selectedCatalog);
  const transactionId = `v1-to-v2-${safeId(selectedCatalog.projectId)}`;
  const loops: ProjectLoopLockV2["loops"] = {};
  const subloops: ProjectLoopLockV2["subloops"] = {};
  const migrations: ProjectLoopLockV2["migrations"] = { ...(previousV2?.migrations ?? {}) };
  const createDirectories = new Set<string>();
  const generatedWrites: LoopSyncPlanV2["generatedWrites"] = [];
  const projectOwnedCreates: LoopSyncPlanV2["projectOwnedCreates"] = [];
  const migrationMoves: LoopSyncPlanV2["migrationMoves"] = [];
  const diagnostics: LoopSyncDiagnostic[] = [...selection.diagnostics];
  const blockingIssues: LoopSyncDiagnostic[] = [...selection.blockingIssues];
  const seenSubloops = new Set<string>();

  for (const loop of selectedCatalog.publishedLoops) {
    const previousLoop = previousV2?.loops[loop.loopDefinitionId] ?? previousV1?.loops[loop.loopDefinitionId];
    const loopPath = previousLoop?.path ?? `.humanthread/loops/${slug(loop.name)}--${safeId(loop.loopDefinitionId)}`;
    const loopFile = `${loopPath}/loop.yaml`;
    loops[loop.loopDefinitionId] = {
      stableId: loop.loopDefinitionId,
      path: loopPath,
      materialized: true,
      expectedFiles: [loopFile],
      localContractVersion: 2,
      platformContractVersion: 2,
      state: "active",
    };
    createDirectories.add(loopPath);
    generatedWrites.push({ path: loopFile, content: v2LoopSkeleton(loop) });

    for (const version of loop.publishedVersions) {
      for (const node of version.graph.nodes) {
        if (!requiresLocalRules(node)) continue;
        const subloopId = stableNodeId(node);
        const storageId = nodeStorageId(owners, loop.loopDefinitionId, subloopId);
        if (seenSubloops.has(storageId)) continue;
        seenSubloops.add(storageId);
        const previousStage = previousV2?.subloops[storageId];
        const legacyStage = previousV1?.nodes[storageId]
          ?? Object.values(previousV1?.nodes ?? {}).find((entry) => entry.stableId === subloopId && entry.parentLoopId === loop.loopDefinitionId);
        const explicitMigration = legacyStage ? readPreparedExplicitV1Migration({
          loopId: loop.loopDefinitionId,
          subloopId,
          inventory: input.inventory,
        }) : null;
        const stagePath = previousStage?.path
          ?? explicitMigration?.stagePath
          ?? `${loopPath}/subloops/${slug(node.label)}--${safeId(subloopId)}`;
        const group = createStagePackageFileGroup({
          loopId: loop.loopDefinitionId,
          subloopId,
          path: stagePath,
          label: node.label,
        });
        const expectedFiles = group.files.map(({ path }) => path);
        let state: MaterializedEntry["state"] = "unconfigured";
        let explicitMigrationReady = false;
        if (previousStage) state = expectedFiles.every((path) => inventory.has(path)) ? previousStage.state : "missing";

        if (!previousStage && legacyStage) {
          const legacyBackup = backupPath(transactionId, legacyStage.path);
          const explicitFilesReady = explicitMigration !== null
            && explicitMigration.sourcePath === legacyStage.path
            && explicitMigration.stagePath === stagePath
            && expectedFiles.every((path) => inventory.has(path))
            && input.inventory.files.some((path) => path.startsWith(`${explicitMigration.backupPath}/`));
          if (explicitFilesReady) {
            migrations[storageId] = { fromVersion: 1, toVersion: 2, status: "completed" };
            explicitMigrationReady = true;
          } else {
            const files = migrationFiles(legacyStage, input.inventory, legacyBackup);
            const detection = files ? detectV1Migration({ files }) : {
              kind: "blocked" as const,
              code: "migration_required" as const,
              reason: "The v1 files could not be read for exact template verification",
              writes: [] as never[],
            };
            if (detection.kind === "automatic") {
              migrations[storageId] = { fromVersion: 1, toVersion: 2, status: "completed" };
              migrationMoves.push({ from: legacyStage.path, to: legacyBackup });
            } else {
              state = "migration_required";
              migrations[storageId] = { fromVersion: 1, toVersion: 2, status: "migration_required" };
              const issue: LoopSyncDiagnostic = {
                code: "migration_required",
                loopId: loop.loopDefinitionId,
                nodeId: subloopId,
                subloopId,
                message: `Local v1 stage requires manual migration: ${subloopId}. ${detection.reason}`,
              };
              diagnostics.push(issue);
              blockingIssues.push(issue);
            }
          }
        }

        subloops[storageId] = {
          stableId: subloopId,
          parentLoopId: loop.loopDefinitionId,
          path: stagePath,
          materialized: true,
          expectedFiles,
          localContractVersion: 2,
          platformContractVersion: 2,
          state,
        };
        if (!previousStage && state !== "migration_required" && !explicitMigrationReady) {
          group.directories.forEach((directory) => createDirectories.add(directory));
          projectOwnedCreates.push(...group.files);
        }
      }
    }
  }

  for (const [loopId, entry] of Object.entries(previousV2?.loops ?? {})) {
    if (!loops[loopId]) loops[loopId] = { ...entry, state: "orphaned" };
  }
  for (const [subloopId, entry] of Object.entries(previousV2?.subloops ?? {})) {
    if (!subloops[subloopId]) subloops[subloopId] = { ...entry, state: "orphaned" };
  }
  for (const [loopId, entry] of Object.entries(previousV1?.loops ?? {})) {
    if (!loops[loopId]) loops[loopId] = { ...entry, state: "orphaned" };
  }
  for (const [subloopId, entry] of Object.entries(previousV1?.nodes ?? {})) {
    if (subloops[subloopId] || !entry.parentLoopId) continue;
    subloops[subloopId] = { ...entry, parentLoopId: entry.parentLoopId, state: "orphaned" };
  }

  const manifest = projectLoopManifestV2Schema.parse({
    ...selectedCatalog,
    schemaVersion: 2,
    synchronizedAt: input.synchronizedAt ?? new Date().toISOString(),
  });
  const lock = projectLoopLockV2Schema.parse({ schemaVersion: 2, loops, subloops, migrations });
  generatedWrites.push(
    { path: ".humanthread/structure/lock.json", content: json(lock) },
    { path: ".humanthread/structure/manifest.json", content: json(manifest) },
  );

  if (blockingIssues.length > 0) {
    return {
      kind: "blocked",
      transactionId,
      manifest,
      lock,
      createDirectories: [],
      generatedWrites: [],
      projectOwnedCreates: [],
      migrationMoves: [],
      diagnostics,
      blockingIssues,
    };
  }
  return {
    kind: "ready",
    transactionId,
    manifest,
    lock,
    createDirectories: [...createDirectories].sort(),
    generatedWrites: generatedWrites.sort((left, right) => left.path.localeCompare(right.path)),
    projectOwnedCreates: projectOwnedCreates.sort((left, right) => left.path.localeCompare(right.path)),
    migrationMoves,
    diagnostics,
    blockingIssues,
  };
}

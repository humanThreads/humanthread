import { describe, expect, it, vi } from "vitest";
import {
  PLATFORM_LOOP_DEFINITIONS,
  buildPlatformLoopVersionWriteData,
} from "./development-mode-seed-data.mjs";
import {
  applyLatestPlatformLoopGraphUpdates,
  planLatestPlatformLoopGraphUpdates,
} from "./update-latest-platform-loop-graphs.mjs";

const currentLoops = PLATFORM_LOOP_DEFINITIONS.filter((loop) => loop.latest !== false);

function currentDefinitionRows() {
  return currentLoops.map((loop) => ({
    id: loop.definitionId,
    latestPublishedVersionId: loop.versionId,
    draftGraph: loop.graph,
    status: "published",
  }));
}

function currentVersionRows() {
  return currentLoops.map((loop) => ({
    id: loop.versionId,
    loopDefinitionId: loop.definitionId,
    ...buildPlatformLoopVersionWriteData(loop),
  }));
}

function reverseObjectKeys(value) {
  if (Array.isArray(value)) return value.map(reverseObjectKeys);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reverseObjectKeys(item)]));
}

describe("latest platform Loop graph updater", () => {
  it("plans updates for the three current schema-v1 rows", () => {
    const definitions = currentDefinitionRows().map((definition) => ({
      ...definition,
      draftGraph: { schemaVersion: 1 },
    }));
    const versions = currentVersionRows().map((version) => ({
      ...version,
      graphSchemaVersion: 1,
      graph: { schemaVersion: 1 },
      checksum: "legacy-checksum",
    }));

    const plan = planLatestPlatformLoopGraphUpdates({ definitions, versions });

    expect(plan.errors).toEqual([]);
    expect(plan.updates.map((update) => ({
      loopDefinitionId: update.loopDefinitionId,
      loopVersionId: update.loopVersionId,
      graphSchemaVersion: update.versionData.graphSchemaVersion,
    }))).toEqual([
      { loopDefinitionId: "loop_definition_gelsang_project_v1", loopVersionId: "loop_version_gelsang_project_v3", graphSchemaVersion: 2 },
      { loopDefinitionId: "loop_definition_branch_task_v2", loopVersionId: "loop_version_branch_task_v4", graphSchemaVersion: 2 },
      { loopDefinitionId: "loop_definition_branch_release_v2", loopVersionId: "loop_version_branch_release_v2", graphSchemaVersion: 2 },
    ]);
  });

  it("is idempotent when the current rows already match", () => {
    const plan = planLatestPlatformLoopGraphUpdates({
      definitions: currentDefinitionRows(),
      versions: currentVersionRows(),
    });

    expect(plan).toMatchObject({ errors: [], updates: [] });
  });

  it("treats database JSON key reordering as an idempotent match", () => {
    const plan = planLatestPlatformLoopGraphUpdates({
      definitions: currentDefinitionRows().map((definition) => ({
        ...definition,
        draftGraph: reverseObjectKeys(definition.draftGraph),
      })),
      versions: currentVersionRows(),
    });

    expect(plan).toMatchObject({ errors: [], updates: [] });
  });

  it("applies only exact current Definition and Version rows", async () => {
    const plan = planLatestPlatformLoopGraphUpdates({
      definitions: currentDefinitionRows().map((definition) => ({ ...definition, draftGraph: { schemaVersion: 1 } })),
      versions: currentVersionRows().map((version) => ({ ...version, graphSchemaVersion: 1, checksum: "legacy-checksum" })),
    });
    const tx = {
      loopDefinition: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      loopVersion: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };

    await applyLatestPlatformLoopGraphUpdates(tx, plan);

    expect(tx.loopVersion.updateMany).toHaveBeenCalledTimes(3);
    expect(tx.loopVersion.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        id: "loop_version_gelsang_project_v3",
        loopDefinitionId: "loop_definition_gelsang_project_v1",
      },
      data: expect.objectContaining({ graphSchemaVersion: 2 }),
    });
    expect(tx.loopDefinition.updateMany).toHaveBeenCalledTimes(3);
    expect(tx.loopDefinition.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        id: "loop_definition_gelsang_project_v1",
        latestPublishedVersionId: "loop_version_gelsang_project_v3",
      },
      data: expect.objectContaining({ draftGraph: expect.objectContaining({ schemaVersion: 2 }) }),
    });
  });
});

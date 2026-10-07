import { describe, expect, it, vi } from "vitest";

import { readKnowledgePolicySettings, updateKnowledgePolicySettings } from "./knowledge-policy-settings";
import { knowledgeProjectDigest } from "./knowledge-reference";

const PROJECT_ID = "project_1";
const DIGEST = knowledgeProjectDigest(PROJECT_ID);

function fixturePolicy(overrides: Record<string, unknown> = {}) {
  return {
    id: "a".repeat(32),
    projectId: PROJECT_ID,
    projectDigest: DIGEST,
    autoPublishEnabled: false,
    minimumConfidence: 0.9,
    allowedSourceTypes: [],
    allowedEntryTypes: [],
    sourceTypeOverrides: [],
    allowAutomaticDelete: false,
    allowAutomaticExpire: false,
    allowAutomaticSupersede: false,
    scheduleTimezone: "Asia/Shanghai",
    scheduleRule: null,
    fullRebuildEvery: 10,
    subscribeSpaceKnowledge: false,
    version: 1,
    updatedAt: new Date("2026-09-23T00:00:00.000Z"),
    ...overrides,
  };
}

function fixtureDb(initial: Record<string, unknown> = fixturePolicy()) {
  let row: Record<string, unknown> | null = initial;
  return {
    current: () => row,
    db: {
      knowledgePolicy: {
        findUnique: vi.fn(async () => row),
        updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          if (!row || Number(row.version) !== Number(where.version)) return { count: 0 };
          const next = { ...row };
          for (const [key, value] of Object.entries(data)) {
            next[key] = value && typeof value === "object" && "increment" in value
              ? Number(row[key] ?? 0) + Number((value as { increment: number }).increment)
              : value;
          }
          row = next;
          return { count: 1 };
        }),
        createMany: vi.fn(async () => ({ count: 0 })),
      },
    },
  };
}

describe("knowledge policy settings", () => {
  it("enables automatic publishing with explicit source and type allowlists", async () => {
    const fixture = fixtureDb();
    const assertCanWriteProject = vi.fn().mockResolvedValue({ projectId: PROJECT_ID, role: "maintainer" });

    const updated = await updateKnowledgePolicySettings({
      userId: "user_1",
      projectId: PROJECT_ID,
      expectedVersion: 1,
      autoPublishEnabled: true,
      minimumConfidence: 0.95,
      allowedSourceTypes: ["knowledge_architecture", "task_completion"],
      allowedEntryTypes: ["rule", "decision"],
      allowAutomaticSupersede: true,
    }, { assertCanWriteProject, db: fixture.db as never, now: () => new Date("2026-09-23T01:00:00.000Z") });

    expect(assertCanWriteProject).toHaveBeenCalledWith({ userId: "user_1", projectId: PROJECT_ID });
    expect(updated).toMatchObject({
      autoPublishEnabled: true,
      minimumConfidence: 0.95,
      allowedSourceTypes: ["knowledge_architecture", "task_completion"],
      allowedEntryTypes: ["rule", "decision"],
      allowAutomaticSupersede: true,
      version: 2,
    });
  });

  it("rejects enabling automatic publishing without an allowlist", async () => {
    const fixture = fixtureDb();
    const assertCanWriteProject = vi.fn();

    await expect(updateKnowledgePolicySettings({
      userId: "user_1",
      projectId: PROJECT_ID,
      expectedVersion: 1,
      autoPublishEnabled: true,
      minimumConfidence: 0.9,
      allowedSourceTypes: [],
      allowedEntryTypes: ["rule"],
    }, { assertCanWriteProject, db: fixture.db as never })).rejects.toMatchObject({ code: "validation_failed" });
    expect(assertCanWriteProject).not.toHaveBeenCalled();
  });

  it("reports a version conflict instead of overwriting a concurrent change", async () => {
    const fixture = fixtureDb(fixturePolicy({ version: 4 }));

    await expect(updateKnowledgePolicySettings({
      userId: "user_1",
      projectId: PROJECT_ID,
      expectedVersion: 1,
      autoPublishEnabled: false,
      minimumConfidence: 0.9,
      allowedSourceTypes: [],
      allowedEntryTypes: [],
    }, {
      assertCanWriteProject: vi.fn().mockResolvedValue({}),
      db: fixture.db as never,
    })).rejects.toMatchObject({
      code: "version_conflict",
      message: expect.stringContaining("current version 4"),
    });
  });

  it("reads the policy only after project read access is granted", async () => {
    const fixture = fixtureDb();
    const assertCanReadProject = vi.fn().mockResolvedValue({ projectId: PROJECT_ID, role: "viewer" });

    const policy = await readKnowledgePolicySettings(
      { userId: "user_1", projectId: PROJECT_ID },
      { assertCanReadProject, db: fixture.db as never },
    );

    expect(assertCanReadProject).toHaveBeenCalledWith({ userId: "user_1", projectId: PROJECT_ID });
    expect(policy).toMatchObject({ autoPublishEnabled: false, minimumConfidence: 0.9, version: 1 });
  });
});

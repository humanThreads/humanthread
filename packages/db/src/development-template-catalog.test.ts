import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDevelopmentTemplateDraft,
  deprecateDevelopmentTemplate,
  listDevelopmentTemplatesForSpace,
  listPublicDevelopmentTemplates,
  toggleDevelopmentTemplateMarketStar,
  setDevelopmentTemplateMarketVisibility,
  deleteDevelopmentTemplate,
  compareDevelopmentTemplateVersions,
  publishDevelopmentTemplate,
  updateDevelopmentTemplateDraft,
} from "./development-template-catalog";

const template = {
  id: "template_custom_v1", key: "space_1_delivery", version: 1, status: "draft",
  spaceId: "space_1", origin: "space", kind: "branch-development", name: "Delivery",
  description: null, createdByUserId: "user_1", sourceTemplateId: null, revision: 2,
  projectConfigSchema: { type: "object" }, taskFieldSchema: { type: "object" },
  developmentLoopVersionId: "loop_task_v2", releaseLoopVersionId: "loop_release_v3",
  triggerPolicy: {}, executionPolicy: {},
};

describe("development template catalog", () => {
  let db: ReturnType<typeof fixture>;

  beforeEach(() => { db = fixture(); });

  it("lists selected Space rows and published platform rows only", async () => {
    await listDevelopmentTemplatesForSpace({ spaceId: "space_1", statuses: ["draft", "published", "deprecated"] }, { db });
    expect(db.projectDevelopmentTemplate.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { OR: [
        { spaceId: "space_1", status: { in: ["draft", "published", "deprecated"] }, deletedAt: null },
        { origin: "platform", status: "published", deletedAt: null },
      ] },
    }));
  });

  it("lists public, non-deleted custom templates in market order without a template release state", async () => {
    await listPublicDevelopmentTemplates({ sort: "stars", actorUserId: "user_1" }, { db });
    expect(db.projectDevelopmentTemplate.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { OR: [
        { origin: "platform", status: "published", deletedAt: null },
        { origin: "space", status: { not: "deprecated" }, isPublic: true, deletedAt: null },
      ] },
      orderBy: [{ starCount: "desc" }, { publicAt: "desc" }, { id: "asc" }],
    }));
  });

  it("changes market visibility and tags with optimistic revision control", async () => {
    await setDevelopmentTemplateMarketVisibility({
      templateId: template.id,
      expectedRevision: 2,
      isPublic: true,
      industryTags: ["信息技术", "金融业"],
      publicAt: new Date("2026-09-12T00:00:00.000Z"),
    }, { db });
    expect(db.projectDevelopmentTemplate.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: template.id, origin: "space", revision: 2, deletedAt: null },
      data: expect.objectContaining({ isPublic: true, industryTags: ["信息技术", "金融业"] }),
    }));
  });

  it("soft deletes a draft and clears public visibility", async () => {
    await deleteDevelopmentTemplate({ templateId: template.id, expectedRevision: 2 }, { db });
    expect(db.projectDevelopmentTemplate.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: template.id, origin: "space", revision: 2, deletedAt: null },
      data: expect.objectContaining({ status: "deprecated", isPublic: false, deletedAt: expect.any(Date) }),
    }));
  });

  it("uses one deterministic MD5 star record per template and user", async () => {
    db.projectDevelopmentTemplate.findUnique.mockResolvedValue({ ...template, isPublic: true, deletedAt: null, starCount: 0 });
    db.developmentTemplateMarketStar.findUnique.mockResolvedValue(null);
    await toggleDevelopmentTemplateMarketStar({ templateId: template.id, userId: "user_1" }, { db });
    expect(db.developmentTemplateMarketStar.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        id: "984cb6e3a0ef37c274ebbe8b098bc4fa",
        templateDigest: "372872d2cc2075f38db417f402fd886c",
        userDigest: "3f49044c1469c6990a665f46ec6c0a41",
      }),
    }));
    expect(db.projectDevelopmentTemplate.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: template.id }, data: { starCount: 1 },
    }));
  });

  it("creates a draft with a unique key and revision one", async () => {
    await expect(createDevelopmentTemplateDraft({ ...template, id: "template_new_v1", key: "space_1_new", version: 1, actorUserId: "user_1" }, { db }))
      .resolves.toMatchObject({ status: "draft", origin: "space", revision: 1 });
  });

  it("rejects duplicate template versions", async () => {
    db.projectDevelopmentTemplate.findUnique.mockResolvedValue(template);
    await expect(createDevelopmentTemplateDraft({ ...template, actorUserId: "user_1" }, { db }))
      .rejects.toMatchObject({ code: "validation_failed" });
  });

  it("rejects a non-incrementing version for an existing template key", async () => {
    db.projectDevelopmentTemplate.findFirst.mockResolvedValue({ ...template, version: 3 });
    await expect(createDevelopmentTemplateDraft({ ...template, id: "template_custom_v2", version: 2, actorUserId: "user_1" }, { db }))
      .rejects.toMatchObject({ code: "validation_failed" });
  });

  it("updates an active custom template with the expected revision regardless of its legacy status", async () => {
    db.projectDevelopmentTemplate.updateMany.mockResolvedValue({ count: 0 });
    db.projectDevelopmentTemplate.findUnique.mockResolvedValue(template);
    await expect(updateDevelopmentTemplateDraft({ ...template, status: "published", expectedRevision: 2, actorUserId: "user_1", commandId: "update_1" }, { db }))
      .rejects.toMatchObject({ code: "version_conflict" });
    expect(db.projectDevelopmentTemplate.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: template.id, revision: 2, deletedAt: null },
    }));
  });

  it("publishes an exact draft version", async () => {
    db.projectDevelopmentTemplate.findUnique.mockResolvedValue(template);
    const first = await publishDevelopmentTemplate({ templateId: template.id, expectedRevision: 2, actorUserId: "user_1", commandId: "publish_1" }, { db });
    const retry = await publishDevelopmentTemplate({ templateId: template.id, expectedRevision: 2, actorUserId: "user_1", commandId: "publish_1" }, { db });
    expect(first).toMatchObject({ status: "published", version: 1 });
    expect(retry).toEqual(first);
    expect(db.projectDevelopmentTemplate.updateMany).toHaveBeenCalledOnce();
  });

  it("reports the current revision when publishing loses the revision race", async () => {
    db.projectDevelopmentTemplate.updateMany.mockResolvedValue({ count: 0 });
    db.projectDevelopmentTemplate.findUnique
      .mockResolvedValueOnce(template)
      .mockResolvedValueOnce({ ...template, revision: 4 });

    await expect(publishDevelopmentTemplate({
      templateId: template.id,
      expectedRevision: 2,
      actorUserId: "user_1",
      commandId: "publish_stale_1",
    }, { db })).rejects.toMatchObject({ code: "version_conflict", currentRevision: 4 });
  });

  it("resolves compare versions from the selected template ID", async () => {
    db.projectDevelopmentTemplate.findUnique
      .mockResolvedValueOnce({ ...template, id: "template_custom_v1", version: 1 })
      .mockResolvedValueOnce({ ...template, id: "template_custom_v1", version: 1 })
      .mockResolvedValueOnce({ ...template, id: "template_custom_v2", version: 2, projectConfigSchema: { type: "object", changed: true } });
    await expect(compareDevelopmentTemplateVersions({ templateId: "template_custom_v1", spaceId: "space_1", fromVersion: 1, toVersion: 2 }, { db }))
      .resolves.toMatchObject({ changedConfigKeys: ["changed"], loopVersions: { from: ["loop_task_v2", "loop_release_v3"], to: ["loop_task_v2", "loop_release_v3"] } });
    expect(db.projectDevelopmentTemplate.findUnique).toHaveBeenNthCalledWith(1, expect.objectContaining({ where: { id: "template_custom_v1" } }));
  });

  it("does not mutate a project reference while deprecating a published row", async () => {
    db.projectDevelopmentTemplate.findUnique.mockResolvedValue({ ...template, status: "published" });
    await deprecateDevelopmentTemplate({ templateId: template.id, expectedRevision: 2, actorUserId: "user_1", commandId: "deprecate_1" }, { db });
    expect(db.projectDevelopmentTemplate.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: template.id, status: "published", revision: 2 },
      data: expect.objectContaining({ status: "deprecated", isPublic: false, deletedAt: expect.any(Date), revision: { increment: 1 } }),
    }));
  });

  it("reports the current revision when deprecating loses the revision race", async () => {
    db.projectDevelopmentTemplate.updateMany.mockResolvedValue({ count: 0 });
    db.projectDevelopmentTemplate.findUnique
      .mockResolvedValueOnce({ ...template, status: "published" })
      .mockResolvedValueOnce({ ...template, status: "published", revision: 4 });

    await expect(deprecateDevelopmentTemplate({
      templateId: template.id,
      expectedRevision: 2,
      actorUserId: "user_1",
      commandId: "deprecate_stale_1",
    }, { db })).rejects.toMatchObject({ code: "version_conflict", currentRevision: 4 });
  });
});

function fixture() {
  const receipts = new Map<string, { status: string; result?: unknown }>();
  const db = {
    projectDevelopmentTemplate: {
      findMany: vi.fn().mockResolvedValue([template]),
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn(async ({ data }: any) => ({ ...data })),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      update: vi.fn().mockResolvedValue(template),
    },
    developmentTemplateMarketStar: {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    },
    commandReceipt: {
      findUnique: vi.fn(async ({ where }: any) => {
        const receipt = receipts.get(where.id);
        return receipt ? { id: where.id, status: receipt.status, result: receipt.result ?? null } : null;
      }),
      create: vi.fn(async ({ data }: any) => { receipts.set(data.id, { status: data.status }); }),
      update: vi.fn(async ({ where, data }: any) => { receipts.set(where.id, { status: data.status, result: data.result }); }),
    },
    orchestrationEvent: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
    outboxMessage: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
    $transaction: async (callback: (tx: any) => Promise<unknown>) => callback(db),
  };
  return db;
}

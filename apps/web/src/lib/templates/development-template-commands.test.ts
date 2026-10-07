import { describe, expect, it, vi } from "vitest";
import {
  copyDevelopmentTemplate,
  createDevelopmentTemplateRevisionDraft,
  deprecateDevelopmentTemplate,
  publishDevelopmentTemplate,
  updateDevelopmentTemplateDraft,
  setDevelopmentTemplateMarketVisibility,
  deleteDevelopmentTemplate,
} from "./development-template-commands";

const template = {
  id: "template_custom_v1", key: "space_1_delivery", version: 1, status: "draft", spaceId: "space_1", origin: "space", kind: "branch-development", name: "Delivery", description: null, createdByUserId: "user_1", sourceTemplateId: null, revision: 2,
  projectConfigSchema: { type: "object" }, taskFieldSchema: { type: "object" }, developmentLoopVersionId: "loop_task_v2", releaseLoopVersionId: "loop_release_v3", triggerPolicy: {}, executionPolicy: {},
};

function dependencies() {
  return {
    now: () => new Date("2026-08-04T00:00:00.000Z"),
    assertCanWriteSpace: vi.fn().mockResolvedValue({ role: "member" }),
    getTemplate: vi.fn().mockResolvedValue(template),
    listLoopVersions: vi.fn().mockResolvedValue([
      { id: "loop_task_v2", status: "published", loopDefinition: { scope: "project", origin: "space", spaceId: "space_1" } },
      { id: "loop_release_v3", status: "published", loopDefinition: { scope: "project", origin: "platform", spaceId: "space_platform" } },
    ]),
    createDraft: vi.fn().mockResolvedValue({ ...template, revision: 1 }),
    updateDraft: vi.fn().mockResolvedValue({ ...template, revision: 3 }),
    publish: vi.fn().mockResolvedValue({ ...template, status: "published", revision: 3 }),
    deprecate: vi.fn().mockResolvedValue({ ...template, status: "deprecated", revision: 3 }),
    setMarketVisibility: vi.fn().mockResolvedValue(undefined),
    deleteTemplate: vi.fn().mockResolvedValue(undefined),
    readCommandResult: vi.fn().mockResolvedValue(undefined),
  };
}

describe("development template commands", () => {
  it("creates the next editable Space template version from a published template", async () => {
    const deps = dependencies();
    deps.getTemplate.mockResolvedValue({ ...template, status: "published", version: 1 });
    await createDevelopmentTemplateRevisionDraft({ actorUserId: "user_1", commandId: "new_version_1", templateId: template.id }, deps);
    expect(deps.createDraft).toHaveBeenCalledWith(expect.objectContaining({ key: template.key, version: 2, sourceTemplateId: template.id }));
  });

  it("authorizes the Space and validates both exact project Loop versions before publish", async () => {
    const deps = dependencies();
    await expect(publishDevelopmentTemplate({ actorUserId: "user_1", commandId: "publish_1", templateId: template.id, expectedRevision: 2 }, deps))
      .resolves.toMatchObject({ status: "published", version: 1 });
    expect(deps.assertCanWriteSpace).toHaveBeenCalledWith({ userId: "user_1", spaceId: "space_1" });
    expect(deps.listLoopVersions).toHaveBeenCalledWith(["loop_task_v2", "loop_release_v3"]);
  });

  it("rejects a task-scoped or cross-Space Loop before publishing", async () => {
    const deps = dependencies();
    deps.listLoopVersions.mockResolvedValue([{ id: "loop_task_v2", status: "published", loopDefinition: { scope: "task", origin: "space", spaceId: "space_1" } }]);
    await expect(publishDevelopmentTemplate({ actorUserId: "user_1", commandId: "publish_2", templateId: template.id, expectedRevision: 2 }, deps)).rejects.toMatchObject({ code: "validation_failed" });
    expect(deps.publish).not.toHaveBeenCalled();
  });

  it("replays a completed publish command without re-reading or mutating the template", async () => {
    const deps = dependencies();
    const result = { id: template.id, status: "published", version: 1, revision: 3 };
    deps.readCommandResult.mockResolvedValue(result);
    await expect(publishDevelopmentTemplate({ actorUserId: "user_1", commandId: "publish_retry", templateId: template.id, expectedRevision: 2 }, deps)).resolves.toEqual(result);
    expect(deps.assertCanWriteSpace).toHaveBeenCalledWith({ userId: "user_1", spaceId: "space_1" });
    expect(deps.readCommandResult).toHaveBeenCalledWith("publish_retry", template.id);
    expect(deps.publish).not.toHaveBeenCalled();
  });

  it("replays completed update and deprecate commands without a second mutation", async () => {
    const deps = dependencies();
    deps.readCommandResult
      .mockResolvedValueOnce({ ...template, name: "Updated", revision: 3 })
      .mockResolvedValueOnce({ ...template, status: "deprecated", revision: 3 });

    await expect(updateDevelopmentTemplateDraft({ actorUserId: "user_1", commandId: "update_retry", templateId: template.id, expectedRevision: 2, name: "Updated" }, deps))
      .resolves.toMatchObject({ name: "Updated", revision: 3 });
    await expect(deprecateDevelopmentTemplate({ actorUserId: "user_1", commandId: "deprecate_retry", templateId: template.id, expectedRevision: 2 }, deps))
      .resolves.toMatchObject({ status: "deprecated", revision: 3 });
    expect(deps.updateDraft).not.toHaveBeenCalled();
    expect(deps.deprecate).not.toHaveBeenCalled();
  });

  it("returns a field-level validation error until both Loop references are selected", async () => {
    const deps = dependencies();
    deps.getTemplate.mockResolvedValue({ ...template, developmentLoopVersionId: null, releaseLoopVersionId: null });
    await expect(publishDevelopmentTemplate({ actorUserId: "user_1", commandId: "publish_missing", templateId: template.id, expectedRevision: 2 }, deps))
      .rejects.toMatchObject({ code: "validation_failed", issues: expect.arrayContaining([
        expect.objectContaining({ path: ["developmentLoopVersionId"] }),
        expect.objectContaining({ path: ["releaseLoopVersionId"] }),
      ]) });
  });

  it("rejects platform-owned template mutations", async () => {
    const deps = dependencies();
    deps.getTemplate.mockResolvedValue({ ...template, origin: "platform", spaceId: null });
    await expect(updateDevelopmentTemplateDraft({ actorUserId: "user_1", commandId: "update_1", templateId: template.id, expectedRevision: 2, name: "Nope" }, deps)).rejects.toMatchObject({ code: "authorization_denied" });
  });

  it("rejects a non-creator Space member from changing another member's template", async () => {
    const deps = dependencies();
    deps.getTemplate.mockResolvedValue({ ...template, createdByUserId: "user_creator" });
    await expect(updateDevelopmentTemplateDraft({ actorUserId: "user_2", commandId: "update_other", templateId: template.id, expectedRevision: 2, name: "Nope" }, deps))
      .rejects.toMatchObject({ code: "authorization_denied" });
  });

  it("allows edits to a published Space template because custom templates are mutable shortcuts", async () => {
    const deps = dependencies();
    deps.getTemplate.mockResolvedValue({ ...template, status: "published" });

    await expect(updateDevelopmentTemplateDraft({ actorUserId: "user_1", commandId: "update_published", templateId: template.id, expectedRevision: 2, name: "更新后的模板" }, deps))
      .resolves.toMatchObject({ revision: 3 });
    expect(deps.updateDraft).toHaveBeenCalledWith(expect.objectContaining({ name: "更新后的模板" }));
  });

  it("rejects secret-shaped policy and config fields before saving a draft", async () => {
    const deps = dependencies();
    await expect(updateDevelopmentTemplateDraft({
      actorUserId: "user_1", commandId: "update_secret", templateId: template.id, expectedRevision: 2, name: "Delivery",
      executionPolicy: { nested: { accessKey: "not-permitted" } },
    }, deps)).rejects.toMatchObject({ code: "validation_failed" });
    expect(deps.updateDraft).not.toHaveBeenCalled();
  });

  it("copies a template into a Space draft while preserving kind and Loop references", async () => {
    const deps = dependencies();
    await copyDevelopmentTemplate({ actorUserId: "user_1", commandId: "copy_1", templateId: template.id, spaceId: "space_1", name: "Copy" }, deps);
    expect(deps.createDraft).toHaveBeenCalledWith(expect.objectContaining({ kind: "branch-development", developmentLoopVersionId: "loop_task_v2", releaseLoopVersionId: "loop_release_v3", sourceTemplateId: template.id }));
  });

  it("allows any writable Space to copy a publicly listed custom template", async () => {
    const deps = dependencies();
    deps.getTemplate.mockResolvedValue({ ...template, spaceId: "space_source", isPublic: true, status: "published", industryTags: ["信息技术"] });
    await copyDevelopmentTemplate({ actorUserId: "user_2", commandId: "copy_public", templateId: template.id, spaceId: "space_1", name: "Public copy" }, deps);
    expect(deps.createDraft).toHaveBeenCalledWith(expect.objectContaining({ spaceId: "space_1", sourceTemplateId: template.id, industryTags: ["信息技术"] }));
  });

  it("allows the creator to公开 a custom template to the market with industry tags without a template publish step", async () => {
    const deps = dependencies();
    deps.getTemplate.mockResolvedValue({ ...template, status: "draft" });
    await setDevelopmentTemplateMarketVisibility({ actorUserId: "user_1", templateId: template.id, expectedRevision: 2, isPublic: true, industryTags: ["信息技术"] }, deps);
    expect(deps.setMarketVisibility).toHaveBeenCalledWith(expect.objectContaining({ templateId: template.id, isPublic: true, industryTags: ["信息技术"] }));
  });

  it("allows the creator to delete a custom template", async () => {
    const deps = dependencies();
    await deleteDevelopmentTemplate({ actorUserId: "user_1", templateId: template.id, expectedRevision: 2, commandId: "delete_1" }, deps);
    expect(deps.deleteTemplate).toHaveBeenCalledWith({ templateId: template.id, expectedRevision: 2 });
  });

  it("persists and copies the selected Loop group presets", async () => {
    const deps = dependencies();
    const loopGroupConfig = {
      presets: [{ key: "研发交付", taskLoopIds: ["loop_task_v2"], defaultTaskLoopId: "loop_release_v3", projectLoopIds: ["loop_release_v3"], defaultProjectLoopId: "loop_release_v3" }],
      defaultSelection: { selectedPresetKeys: ["研发交付"], defaultPresetKey: "研发交付" },
    };
    await updateDevelopmentTemplateDraft({ actorUserId: "user_1", commandId: "update_loop_group", templateId: template.id, expectedRevision: 2, name: "Delivery", loopGroupConfig }, deps);
    expect(deps.updateDraft).toHaveBeenCalledWith(expect.objectContaining({ loopGroupConfig }));

    await copyDevelopmentTemplate({ actorUserId: "user_1", commandId: "copy_loop_group", templateId: template.id, spaceId: "space_1", name: "Copy" }, {
      ...deps,
      getTemplate: vi.fn().mockResolvedValue({ ...template, loopGroupConfig }),
    });
    expect(deps.createDraft).toHaveBeenCalledWith(expect.objectContaining({ loopGroupConfig }));
  });
});

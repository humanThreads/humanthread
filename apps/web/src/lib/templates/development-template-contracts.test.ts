import { describe, expect, it } from "vitest";
import {
  copyDevelopmentTemplateRequestSchema,
  developmentTemplateApiError,
  publishDevelopmentTemplateRequestSchema,
  updateDevelopmentTemplateRequestSchema,
} from "./development-template-contracts";

describe("development template request contracts", () => {
  it("rejects unknown properties on explicit command payloads", () => {
    expect(copyDevelopmentTemplateRequestSchema.safeParse({ commandId: "copy_1", spaceId: "space_1", name: "Copy", action: "copy" }).success).toBe(false);
    expect(publishDevelopmentTemplateRequestSchema.safeParse({ commandId: "publish_1", expectedRevision: 1, name: "no" }).success).toBe(false);
  });

  it("requires an expected revision for existing draft updates", () => {
    expect(updateDevelopmentTemplateRequestSchema.safeParse({ commandId: "update_1", name: "Delivery" }).success).toBe(false);
  });

  it("accepts a loop group configuration without allowing unknown fields", () => {
    const result = updateDevelopmentTemplateRequestSchema.safeParse({
      commandId: "update_loop_group",
      expectedRevision: 1,
      name: "Delivery",
      loopGroupConfig: {
        presets: [{
          key: "研发交付",
          taskLoopIds: ["loop_task"],
          defaultTaskLoopId: "loop_release",
          projectLoopIds: ["loop_release"],
          defaultProjectLoopId: "loop_release",
        }],
        defaultSelection: { selectedPresetKeys: ["研发交付"], defaultPresetKey: "研发交付" },
      },
    });
    expect(result.success).toBe(true);
  });

  it("maps version conflicts without exposing internal errors", () => {
    expect(developmentTemplateApiError(Object.assign(new Error("Changed"), { code: "version_conflict", currentRevision: 4 }))).toMatchObject({ status: 409, body: { code: "version_conflict", currentRevision: 4 } });
    expect(developmentTemplateApiError(new Error("db table leaked"))).toEqual({ status: 500, body: { ok: false, code: "internal_error", error: "Development template request failed" } });
  });
});

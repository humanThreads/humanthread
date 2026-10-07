import { describe, expect, it, vi } from "vitest";
import {
  normalizeTaskFieldValues,
  validateProjectShortCode,
  validateTaskFieldKey,
} from "./task-business-fields";

const definition = (overrides: Record<string, unknown> = {}) => ({
  id: "field_owner",
  projectId: "project_1",
  key: "owner",
  name: "负责人",
  type: "user",
  required: true,
  options: null,
  sortOrder: 0,
  isActive: true,
  ...overrides,
});

describe("task business fields", () => {
  it("normalizes project short codes and rejects invalid values", () => {
    expect(validateProjectShortCode(" ht ")).toBe("HT");
    expect(() => validateProjectShortCode("h")).toThrow(/2-12/iu);
    expect(() => validateProjectShortCode("HT-1")).toThrow(/uppercase/iu);
  });

  it("validates field keys", () => {
    expect(validateTaskFieldKey("product_owner")).toBe("product_owner");
    expect(() => validateTaskFieldKey("Product Owner")).toThrow(/field key/iu);
  });

  it("supports typed values and Space membership for user fields", async () => {
    const isSpaceMember = vi.fn().mockResolvedValue(true);
    const values = await normalizeTaskFieldValues({
      definitions: [
        definition(),
        definition({ id: "field_priority", key: "priority", name: "优先级", type: "number", required: false }),
        definition({ id: "field_kind", key: "kind", name: "类型", type: "select", required: false, options: ["bug", "feature"] }),
      ],
      values: { owner: "user_2", priority: 2, kind: "bug" },
      isSpaceMember,
    });

    expect(values).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "owner", data: { userValue: "user_2" } }),
      expect.objectContaining({ key: "priority", data: { numberValue: 2 } }),
      expect.objectContaining({ key: "kind", data: { selectValue: "bug" } }),
    ]));
    expect(isSpaceMember).toHaveBeenCalledWith("user_2");
  });

  it("rejects missing required fields, invalid options, and non-members", async () => {
    await expect(normalizeTaskFieldValues({
      definitions: [definition()],
      values: {},
      isSpaceMember: vi.fn(),
    })).rejects.toMatchObject({ code: "validation_failed" });
    await expect(normalizeTaskFieldValues({
      definitions: [definition({ type: "select", key: "kind", options: ["bug"] })],
      values: { kind: "other" },
      isSpaceMember: vi.fn(),
    })).rejects.toMatchObject({ code: "validation_failed" });
    await expect(normalizeTaskFieldValues({
      definitions: [definition()],
      values: { owner: "user_outside" },
      isSpaceMember: vi.fn().mockResolvedValue(false),
    })).rejects.toMatchObject({ code: "validation_failed" });
  });
});

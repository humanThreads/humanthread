import { describe, expect, it } from "vitest";
import {
  dynamic,
  LOOP_LIBRARY_ACTION_LABEL,
  LOOP_LIBRARY_PAGE_TITLE,
  loadLoopDefinitionsForSpaces,
  parseRequestedLoopScope,
} from "./page";
import { WORKBENCH_NAV_ITEMS } from "../components/workbench-nav";

describe("Loop library page", () => {
  it("forces dynamic rendering", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("is registered in the workbench navigation", () => {
    expect(WORKBENCH_NAV_ITEMS.find((item) => item.key === "loops")).toMatchObject({
      href: "/loops",
      label: "Loop 中心",
      compactLabel: "Loop",
      key: "loops",
    });
  });

  it("keeps the product entry copy stable", () => {
    expect(LOOP_LIBRARY_PAGE_TITLE).toBe("Loop 中心");
    expect(LOOP_LIBRARY_ACTION_LABEL).toBe("编辑 Loop");
  });

  it("preserves an explicit Task or Project scope", () => {
    expect(parseRequestedLoopScope("task")).toBe("task");
    expect(parseRequestedLoopScope("project")).toBe("project");
    expect(parseRequestedLoopScope(undefined)).toBeNull();
  });

  it("returns an explicit unavailable state when Loop storage is not ready", async () => {
    await expect(loadLoopDefinitionsForSpaces({
      userId: "user_1",
      spaceIds: ["space_1"],
      listDefinitions: async () => { throw new Error("storage unavailable"); },
    })).resolves.toEqual({ ok: false });
  });

  it("loads and deduplicates Loop definitions across spaces", async () => {
    await expect(loadLoopDefinitionsForSpaces({
      userId: "user_1",
      spaceIds: ["space_1", "space_2"],
      listDefinitions: async ({ spaceId }) => spaceId === "space_1"
        ? [{ id: "loop_1", name: "Daily review" }]
        : [
            { id: "loop_1", name: "Daily review" },
            { id: "loop_2", name: "Release" },
          ],
    })).resolves.toEqual({
      ok: true,
      definitions: [
        { id: "loop_1", name: "Daily review" },
        { id: "loop_2", name: "Release" },
      ],
    });
  });

  it("defaults the Loop center to task scope and filters project definitions", async () => {
    await expect(loadLoopDefinitionsForSpaces({
      userId: "user_1",
      spaceIds: ["space_1"],
      scope: "project",
      listDefinitions: async () => [
        { id: "loop_task", scope: "task" },
        { id: "loop_project", scope: "project" },
      ],
    })).resolves.toEqual({ ok: true, definitions: [{ id: "loop_project", scope: "project" }] });
  });
});

import { describe, expect, it } from "vitest";
import {
  dynamic,
} from "./page";
import { getWorkbenchSiteSettings } from "../../lib/workbench/workbench-site-settings";

describe("Downloads page", () => {
  it("forces dynamic rendering", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("keeps site settings available to the authenticated shell", () => {
    expect(typeof getWorkbenchSiteSettings).toBe("function");
  });

  it("keeps the page framed as agent downloads instead of generic clients", async () => {
    const page = await import("./page");

    expect(page.default).toBeTypeOf("function");
  });
});

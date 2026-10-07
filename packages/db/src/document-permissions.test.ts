import { describe, expect, it } from "vitest";
import { effectiveDocumentPermission, permissionRank } from "./document-permissions";

describe("document permission resolution", () => {
  it("takes the highest permission from explicit file and inherited directory grants", () => {
    expect(effectiveDocumentPermission({
      base: "read",
      inherited: ["edit", "read"],
      explicit: "manage",
    })).toBe("manage");
  });

  it("does not downgrade an inherited edit grant with a read file grant", () => {
    expect(effectiveDocumentPermission({
      base: "read",
      inherited: ["edit"],
      explicit: "read",
    })).toBe("edit");
  });

  it("orders read, edit and manage", () => {
    expect(permissionRank("read")).toBeLessThan(permissionRank("edit"));
    expect(permissionRank("edit")).toBeLessThan(permissionRank("manage"));
  });
});

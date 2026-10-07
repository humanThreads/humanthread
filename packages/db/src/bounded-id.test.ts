import { describe, expect, it } from "vitest";
import { buildCompanyMembershipId, derivedPersistenceId } from "./bounded-id";

describe("derived persistence IDs", () => {
  it("uses deterministic lowercase MD5 identities for composite database keys", () => {
    const companyId = "c".repeat(64);
    const userId = "u".repeat(64);

    expect(buildCompanyMembershipId(companyId, userId)).toMatch(/^[a-f0-9]{32}$/u);
    expect(buildCompanyMembershipId(companyId, userId)).toBe(
      derivedPersistenceId(["company-member", companyId, userId]),
    );
    expect(buildCompanyMembershipId(companyId, `${userId.slice(0, -1)}v`)).not.toBe(
      buildCompanyMembershipId(companyId, userId),
    );
  });
});

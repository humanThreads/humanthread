import { describe, expect, it } from "vitest";

import {
  assertBusinessTestDatabaseTarget,
  businessTestFixtureIds,
} from "./business-test-environment.mjs";

describe("business-test database guard", () => {
  it("allows a reset only when the local environment explicitly marks the database for business testing", () => {
    expect(() => assertBusinessTestDatabaseTarget({
      databaseUrl: "mysql://tester:secret@inner-db.example.test:3306/humanthread",
      purpose: "business-test",
      allowReset: "true",
    })).not.toThrow();
  });

  it("rejects an unmarked database before any reset or fixture write", () => {
    for (const input of [
      { databaseUrl: "mysql://tester:secret@inner-db.example.test:3306/humanthread", purpose: "", allowReset: "true" },
      { databaseUrl: "mysql://tester:secret@inner-db.example.test:3306/humanthread", purpose: "business-test", allowReset: "false" },
      { databaseUrl: "not-a-database-url", purpose: "business-test", allowReset: "true" },
    ]) {
      expect(() => assertBusinessTestDatabaseTarget(input)).toThrow("business-test database");
    }
  });
});

describe("business-test fixtures", () => {
  it("uses stable 32-character IDs for users and A/B/C tasks", () => {
    const ids = businessTestFixtureIds();

    expect(Object.values(ids)).toHaveLength(5);
    expect(new Set(Object.values(ids)).size).toBe(5);
    for (const id of Object.values(ids)) expect(id).toMatch(/^[a-f0-9]{32}$/u);
  });
});

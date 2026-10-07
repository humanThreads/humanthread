import { describe, expect, it } from "vitest";

import { createWorkbenchContextIdentity } from "./context";

describe("createWorkbenchContextIdentity", () => {
  it("canonicalizes a deployment URL before it becomes cache identity", () => {
    expect(
      createWorkbenchContextIdentity({
        deploymentUrl: "https://ht.example.com/",
        sessionId: "desktop_session_1",
        spaceKey: "company:company_1",
      }),
    ).toEqual({
      deploymentKey: "https://ht.example.com",
      sessionId: "desktop_session_1",
      spaceKey: "company:company_1",
    });
  });

  it("rejects an empty identity segment instead of sharing cache state", () => {
    expect(() =>
      createWorkbenchContextIdentity({
        deploymentUrl: "https://ht.example.com",
        sessionId: " ",
        spaceKey: "personal",
      }),
    ).toThrow("sessionId is required");
  });
});

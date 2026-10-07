import { describe, expect, it } from "vitest";
import {
  createAgentBindingCode,
  verifyAgentBindingCode,
} from "./agent-binding-code";

describe("agent binding codes", () => {
  it("creates a short-lived signed code for a workbench user", () => {
    const result = createAgentBindingCode({
      userId: "user_owner",
      teamId: "team_1",
      now: new Date("2026-05-20T00:00:00.000Z"),
      secret: "test-secret",
    });

    const payload = verifyAgentBindingCode({
      code: result.code,
      now: new Date("2026-05-20T00:01:00.000Z"),
      secret: "test-secret",
    });

    expect(result.expiresAt).toEqual(new Date("2026-05-20T00:10:00.000Z"));
    expect(payload).toMatchObject({
      userId: "user_owner",
      teamId: "team_1",
    });
  });

  it("rejects expired binding codes", () => {
    const result = createAgentBindingCode({
      userId: "user_owner",
      teamId: "team_1",
      now: new Date("2026-05-20T00:00:00.000Z"),
      secret: "test-secret",
    });

    expect(() =>
      verifyAgentBindingCode({
        code: result.code,
        now: new Date("2026-05-20T00:11:00.000Z"),
        secret: "test-secret",
      }),
    ).toThrow("Agent binding code has expired");
  });
});

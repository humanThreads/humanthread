import { describe, expect, it } from "vitest";

import {
  desktopNotificationReadRequestSchema,
  desktopNotificationReadResponseSchema,
  loopNotificationIntentSchema,
} from "./notifications";

describe("desktop Notification command contracts", () => {
  it("requires a bounded idempotency key when marking a notification read", () => {
    expect(desktopNotificationReadRequestSchema.parse({
      commandId: "desktop:notification:read:command_1",
    })).toEqual({ commandId: "desktop:notification:read:command_1" });

    expect(() => desktopNotificationReadRequestSchema.parse({ commandId: "" }))
      .toThrow();
    expect(() => desktopNotificationReadRequestSchema.parse({
      commandId: "x".repeat(129),
    })).toThrow();
  });

  it("returns the notification identity and its read state", () => {
    expect(desktopNotificationReadResponseSchema.parse({
      ok: true,
      result: { notificationId: "event:event_1", isUnread: false },
    })).toEqual({
      ok: true,
      result: { notificationId: "event:event_1", isUnread: false },
    });
  });
});

describe("Loop notification transport contract", () => {
  it("accepts a bounded credential-free tiered intent", () => {
    const parsed = loopNotificationIntentSchema.parse({
      id: "loop-notification:notice_1",
      projectId: "project_1",
      loopRunId: "run_1",
      loopNodeRunId: "node_1",
      level: "critical",
      title: "Loop 重试预算已耗尽",
      description: "质量门禁已达到最大返工次数",
      eventFamily: "loop.run.exhausted",
      channels: ["in_app", "desktop"],
      approvalId: null,
      readAt: null,
      createdAt: "2026-07-31T08:00:00.000Z",
    });

    expect(parsed.level).toBe("critical");
    expect(parsed.description.length).toBeLessThanOrEqual(240);
    expect(() => loopNotificationIntentSchema.parse({
      ...parsed,
      description: "x".repeat(241),
    })).toThrow();
    expect(() => loopNotificationIntentSchema.parse({
      ...parsed,
      accessToken: "secret",
    })).toThrow();
  });
});

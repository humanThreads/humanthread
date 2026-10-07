import { describe, expect, it, vi } from "vitest";

import {
  buildInteractionNotification,
  enqueueInteractionNotifications,
  resolveInteractionNotificationRecipients,
} from "./workflow-interaction-notifications";

describe("workflow interaction notifications", () => {
  it("builds an exact message deep link and redacts credentials", () => {
    const notification = buildInteractionNotification({
      templateKey: "workflow_mention",
      interactionId: "interaction_1",
      loopRunId: "run_1",
      messageId: "message_1",
      body: "AK=LTAI5exampleSecret signed=https://oss.example/a?OSSAccessKeyId=abc&Signature=secret",
    });

    expect(notification.path).toBe("/loop-runs/run_1?interaction=interaction_1&message=message_1");
    expect(notification.description).not.toContain("LTAI5exampleSecret");
    expect(notification.description).not.toContain("Signature=secret");
  });

  it("deduplicates one mention notification per message and recipient", async () => {
    const createLoopNotificationIntentInTransaction = vi.fn().mockResolvedValue({ id: "notification_1" });
    const tx = {};
    const input = {
      projectId: "project_1",
      loopRunId: "run_1",
      loopNodeRunId: "node_1",
      interactionId: "interaction_1",
      messageId: "message_1",
      templateKey: "workflow_mention" as const,
      body: "请确认",
      recipientUserIds: ["user_2", "user_2"],
      occurredAt: new Date("2026-08-05T10:00:00.000Z"),
    };

    await enqueueInteractionNotifications(tx as never, input, { createLoopNotificationIntentInTransaction });

    expect(createLoopNotificationIntentInTransaction).toHaveBeenCalledOnce();
    expect(createLoopNotificationIntentInTransaction).toHaveBeenCalledWith(expect.objectContaining({
      recipientUserId: "user_2",
      eventType: "workflow_mention",
      dedupeKey: "workflow:interaction_1:message_1:user_2:workflow_mention",
      templateData: expect.objectContaining({
        path: "/loop-runs/run_1?interaction=interaction_1&message=message_1",
      }),
    }), tx);
  });

  it("uses stable version-scoped dedupe keys for collaboration decisions", async () => {
    const createLoopNotificationIntentInTransaction = vi.fn().mockResolvedValue({ id: "notification_1" });
    await enqueueInteractionNotifications({} as never, {
      projectId: "project_1",
      loopRunId: "run_1",
      loopNodeRunId: "node_1",
      interactionId: "interaction_1",
      templateKey: "workflow_conflict_speaker_assigned",
      body: "冲突需要二次确认",
      recipientUserIds: ["user_2"],
      occurredAt: new Date("2026-08-05T10:00:00.000Z"),
      dedupeKey: "conflict_speaker_assigned:8",
    }, { createLoopNotificationIntentInTransaction });

    expect(createLoopNotificationIntentInTransaction).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "workflow_conflict_speaker_assigned",
      title: "冲突二次确认待处理",
      dedupeKey: "workflow:interaction_1:conflict_speaker_assigned:8:user_2:workflow_conflict_speaker_assigned",
    }), expect.anything());
  });

  it("selects active requirement confirmers and excludes the actor", async () => {
    const recipients = await resolveInteractionNotificationRecipients({
      projectId: "project_1",
      taskId: "task_1",
      audience: "requirement_pending",
      actorUserId: "user_actor",
    }, { loadRecipientContext: vi.fn().mockResolvedValue({
      projectManagerUserId: "user_manager",
      projectOwnerUserId: null,
      projectMembers: [
        { userId: "user_admin", role: "maintainer", status: "active", userStatus: "active" },
        { userId: "user_removed", role: "maintainer", status: "inactive", userStatus: "active" },
      ],
      task: {
        createdById: "user_actor",
        createdByStatus: "active",
        assigneeUserId: "user_assignee",
        assigneeStatus: "active",
      },
      directUsers: [{ userId: "user_manager", userStatus: "active" }],
    }) });

    expect(recipients).toEqual(["user_assignee", "user_admin", "user_manager"]);
  });
});

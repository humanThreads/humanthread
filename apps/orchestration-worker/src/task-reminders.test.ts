import { describe, expect, it, vi } from "vitest";
import { claimDueTaskReminders, deliverDueTaskReminders } from "./task-reminders";

const reminder = {
  id: "reminder_1",
  taskId: "task_1",
  recipientUserId: "user_1",
  remindAt: new Date("2026-07-22T01:00:00.000Z"),
  attempts: 0,
};

describe("deliverDueTaskReminders", () => {
  it("atomically keeps only reminders successfully claimed by this worker", async () => {
    const claimOne = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const result = await claimDueTaskReminders({
      now: new Date("2026-07-22T02:00:00.000Z"),
      loadCandidates: vi.fn().mockResolvedValue([reminder, { ...reminder, id: "reminder_2" }]),
      claimOne,
    });
    expect(result.map((item) => item.id)).toEqual(["reminder_1"]);
    expect(claimOne).toHaveBeenCalledWith(expect.objectContaining({
      now: new Date("2026-07-22T02:00:00.000Z"),
      staleBefore: new Date("2026-07-22T01:55:00.000Z"),
    }));
  });
  it("claims due reminders, publishes once, and marks them sent", async () => {
    const publish = vi.fn().mockResolvedValue(undefined);
    const markSent = vi.fn().mockResolvedValue(undefined);
    const result = await deliverDueTaskReminders({
      now: new Date("2026-07-22T02:00:00.000Z"),
      claim: vi.fn().mockResolvedValue([reminder]),
      publish,
      markSent,
      markFailed: vi.fn(),
    });
    expect(result).toEqual({ claimed: 1, sent: 1, failed: 0 });
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      notificationId: "task-reminder:reminder_1",
      reminder,
    }));
    expect(markSent).toHaveBeenCalledWith({ reminderId: "reminder_1", sentAt: new Date("2026-07-22T02:00:00.000Z") });
  });

  it("marks retryable failures without stopping the batch", async () => {
    const markFailed = vi.fn().mockResolvedValue(undefined);
    const result = await deliverDueTaskReminders({
      now: new Date("2026-07-22T02:00:00.000Z"),
      claim: vi.fn().mockResolvedValue([reminder, { ...reminder, id: "reminder_2" }]),
      publish: vi.fn().mockRejectedValueOnce(new Error("db unavailable")).mockResolvedValueOnce(undefined),
      markSent: vi.fn(),
      markFailed,
    });
    expect(result).toEqual({ claimed: 2, sent: 1, failed: 1 });
    expect(markFailed).toHaveBeenCalledWith({ reminderId: "reminder_1", error: "db unavailable", retryAt: new Date("2026-07-22T02:02:00.000Z") });
  });

  it("uses the first retry delay when the persisted reminder has no attempt counter", async () => {
    const markFailed = vi.fn().mockResolvedValue(undefined);
    await deliverDueTaskReminders({
      now: new Date("2026-07-22T02:00:00.000Z"),
      claim: vi.fn().mockResolvedValue([{ ...reminder, attempts: undefined }]),
      publish: vi.fn().mockRejectedValue(new Error("notification unavailable")),
      markSent: vi.fn(),
      markFailed,
    });
    expect(markFailed).toHaveBeenCalledWith({
      reminderId: "reminder_1",
      error: "notification unavailable",
      retryAt: new Date("2026-07-22T02:02:00.000Z"),
    });
  });

  it("does nothing when atomic claim skips sent or rescheduled reminders", async () => {
    const publish = vi.fn();
    await expect(deliverDueTaskReminders({
      now: new Date("2026-07-22T02:00:00.000Z"), claim: vi.fn().mockResolvedValue([]), publish,
      markSent: vi.fn(), markFailed: vi.fn(),
    })).resolves.toEqual({ claimed: 0, sent: 0, failed: 0 });
    expect(publish).not.toHaveBeenCalled();
  });
});

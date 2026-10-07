import { describe, expect, it, vi } from "vitest";
import { createUserTaskReminder, removeUserTaskReminder } from "@/lib/tasks/task-commands";
import { DELETE, POST } from "./route";

vi.mock("@/lib/workbench/workbench-api-session", () => ({ resolveWorkbenchApiActor: vi.fn().mockResolvedValue({ userId: "user_session" }) }));
vi.mock("@/lib/tasks/task-commands", () => ({ createUserTaskReminder: vi.fn(), removeUserTaskReminder: vi.fn() }));

const context = { params: Promise.resolve({ taskId: "task_1" }) };

describe("Task reminder API", () => {
  it("creates a reminder for the signed actor and ignores recipientUserId", async () => {
    vi.mocked(createUserTaskReminder).mockResolvedValue({ reminderId: "reminder_1", version: 2 } as never);
    const response = await POST(new Request("http://localhost/api/tasks/task_1/reminders", {
      method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:1420" },
      body: JSON.stringify({ commandId: "cmd_1", expectedVersion: 1, recipientUserId: "attacker", remindAt: "2026-07-24T01:00:00.000Z" }),
    }), context);
    expect(response.status).toBe(201);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:1420");
    expect(createUserTaskReminder).toHaveBeenCalledWith(expect.objectContaining({
      actor: { type: "user", id: "user_session" }, remindAt: new Date("2026-07-24T01:00:00.000Z"),
    }));
  });

  it("removes only the actor's pending reminder", async () => {
    vi.mocked(removeUserTaskReminder).mockResolvedValue({ reminderId: "reminder_1", version: 2 } as never);
    expect((await DELETE(new Request("http://localhost/api/tasks/task_1/reminders", {
      method: "DELETE", headers: { "content-type": "application/json" },
      body: JSON.stringify({ commandId: "cmd_2", expectedVersion: 1, reminderId: "reminder_1" }),
    }), context)).status).toBe(200);
  });
});

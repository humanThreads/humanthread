import { describe, expect, it, vi } from "vitest";
import type { OrchestrationBackend } from "./backend";

describe("OrchestrationBackend", () => {
  it("carries stable deduplication and correlation inputs across operations", async () => {
    const backend: OrchestrationBackend = {
      claim: vi.fn(async () => ({ leaseId: "lease_1", accepted: true })),
      schedule: vi.fn(async () => ({ messageId: "message_1" })),
      signal: vi.fn(async () => ({ accepted: true })),
      timer: vi.fn(async () => ({ scheduled: true })),
      retry: vi.fn(async () => ({ scheduled: true })),
    };

    await expect(backend.schedule({
      topic: "task.ready",
      payload: { taskId: "task_1" },
      correlationId: "project_1:delivery",
      dedupeKey: "task_1:ready:1",
      availableAt: new Date("2026-07-21T00:00:00.000Z"),
    })).resolves.toEqual({ messageId: "message_1" });

    expect(backend.schedule).toHaveBeenCalledWith(expect.objectContaining({
      correlationId: "project_1:delivery",
      dedupeKey: "task_1:ready:1",
    }));
  });
});

import { describe, expect, it, vi } from "vitest";
import { getTaskDetail, listTasks } from "./read-repository";

describe("task read repository", () => {
  it("loads compact summaries without full content or raw runtime fields", async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: "task_1", title: "登录改造" }]);

    await expect(listTasks({ userId: "user_1", db: { task: { findMany } } }))
      .resolves.toEqual([{ id: "task_1", title: "登录改造" }]);
    const query = findMany.mock.calls[0]?.[0];
    expect(query.select.contentMarkdown).toBeUndefined();
    expect(query.select.agentRuns.select.leaseGeneration).toBeUndefined();
    expect(query.select.agentRuns.select.checkpoint).toBeUndefined();
    expect(query.select.agentRuns.select.providerSessionId).toBeUndefined();
    expect(JSON.stringify(query.where)).toContain('"space"');
  });

  it("loads detail through the shared accessible predicate", async () => {
    const findFirst = vi.fn().mockResolvedValue({
      id: "task_1",
      title: "登录改造",
      contentMarkdown: "## 验收",
    });

    await expect(getTaskDetail({
      userId: "user_1",
      taskId: "task_1",
      db: { task: { findFirst } },
    })).resolves.toMatchObject({ id: "task_1", contentMarkdown: "## 验收" });
    expect(findFirst.mock.calls[0]?.[0].where).toMatchObject({
      AND: expect.arrayContaining([{ id: "task_1" }]),
    });
  });

  it("returns null when no accessible task matches", async () => {
    await expect(getTaskDetail({
      userId: "user_1",
      taskId: "task_private",
      db: { task: { findFirst: vi.fn().mockResolvedValue(null) } },
    })).resolves.toBeNull();
  });
});

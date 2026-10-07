import { describe, expect, it, vi } from "vitest";

import { initializeProjectKnowledge } from "./project-knowledge-initialization";

describe("project knowledge initialization", () => {
  it("creates built-in template versions for every generation mode", async () => {
    const templates = new Map<string, Record<string, unknown>>();
    const versions = new Map<string, Record<string, unknown>>();
    const db = {
      project: {
        findUnique: vi.fn(async () => ({ id: "project_1", name: "示例项目", objective: "后续补交知识" })),
      },
      knowledgePolicy: {
        findUnique: vi.fn(async () => null),
        createMany: vi.fn(async () => ({ count: 1 })),
      },
      knowledgeTemplate: {
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) => templates.get(where.id) ?? null),
        createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
          for (const row of data) templates.set(String(row.id), row);
          return { count: data.length };
        }),
      },
      knowledgeTemplateVersion: {
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) => versions.get(where.id) ?? null),
        createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
          for (const row of data) versions.set(String(row.id), row);
          return { count: data.length };
        }),
      },
    };

    const result = await initializeProjectKnowledge(
      { projectId: "project_1", actorUserId: "user_1" },
      db as never,
    );

    expect(Object.keys(result.templateVersionIds).sort()).toEqual([
      "manual_update",
      "project_initialization",
      "scheduled_update",
      "task_completion",
    ]);
    expect(Array.from(templates.values()).map((template) => template.mode).sort()).toEqual([
      "manual_update",
      "project_initialization",
      "scheduled_update",
      "task_completion",
    ]);
    expect(versions.size).toBe(4);
  });
});

import { describe, expect, it, vi } from "vitest";

import { resolveKnowledgeSources } from "./knowledge-source-resolution";
import { knowledgeProjectDigest } from "./knowledge-reference";

function fixture() {
  const task = vi.fn(async ({ where }: { where: { id: string } }) => (
    where.id === "task_1"
      ? { id: "task_1", projectId: "project_1", archivedAt: null }
      : null
  ));
  const document = vi.fn(async ({ where }: { where: { id: string } }) => (
    where.id === "doc_1"
      ? { id: "doc_1", projectId: "project_1", deletedAt: null }
      : null
  ));
  const loopRun = vi.fn(async ({ where }: { where: { id: string } }) => (
    where.id === "run_1"
      ? { id: "run_1", projectId: "project_1", status: "completed" }
      : null
  ));
  const stores = { task: { findUnique: task }, document: { findUnique: document }, loopRun: { findUnique: loopRun } };
  return {
    task,
    document,
    loopRun,
    db: stores,
  };
}

describe("resolveKnowledgeSources", () => {
  it("resolves active platform sources instead of trusting submitted status", async () => {
    const dependencies = fixture();
    await expect(resolveKnowledgeSources({
      projectDigest: knowledgeProjectDigest("project_1"),
      references: [
        { kind: "task", sourceType: "task_completion", ref: "task:task_1", status: "active" },
        { kind: "document", sourceType: "document", ref: "doc:doc_1", status: "deleted" },
        { kind: "loop-run", sourceType: "loop_run", ref: "loop-run:run_1", status: "active" },
      ],
    }, dependencies.db as never)).resolves.toEqual([
      { kind: "task", ref: "task_1", sourceType: "task_completion", active: true, missing: false, accessible: true },
      { kind: "document", ref: "doc_1", sourceType: "document", active: true, missing: false, accessible: true },
      { kind: "loop-run", ref: "run_1", sourceType: "loop_run", active: true, missing: false, accessible: true },
    ]);
    expect(dependencies.task).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "task_1" } }));
    expect(dependencies.document).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "doc_1" } }));
  });

  it("fails closed for missing, cross-project, archived, and deleted sources", async () => {
    const dependencies = fixture();
    dependencies.task.mockImplementation(async ({ where }: { where: { id: string } }) => (
      where.id === "task_1"
        ? { id: "task_1", projectId: "project_2", archivedAt: null }
        : null
    ));
    dependencies.document.mockResolvedValue({ id: "doc_1", projectId: "project_1", deletedAt: new Date() });

    await expect(resolveKnowledgeSources({
      projectDigest: knowledgeProjectDigest("project_1"),
      references: [
        { kind: "task", ref: "task:task_1" },
        { kind: "document", ref: "doc:doc_1" },
        { kind: "task", ref: "task:missing" },
      ],
    }, dependencies.db as never)).resolves.toEqual([
      expect.objectContaining({ active: false, accessible: true, missing: false }),
      expect.objectContaining({ active: false, accessible: true, missing: false }),
      expect.objectContaining({ active: false, accessible: false, missing: true }),
    ]);
  });
});

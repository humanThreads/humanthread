import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readLoopReviewArtifact,
  saveLoopReviewArtifact,
} from "./loop-review-artifacts";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function storageRoot() {
  const root = await mkdtemp(join(tmpdir(), "loop-review-artifact-test-"));
  roots.push(root);
  return root;
}

describe("Loop review Artifacts", () => {
  it("stores only workspace-relative HTML review pages and returns a stable reference", async () => {
    const root = await storageRoot();
    const records = new Map<string, Record<string, unknown>>();
    const db = {
      artifact: {
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) => records.get(where.id) ?? null),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          records.set(String(data.id), data);
          return data;
        }),
      },
    };

    const saved = await saveLoopReviewArtifact({
      projectId: "project_1",
      taskId: "task_1",
      agentRunId: "agent_run_1",
      loopNodeRunId: "node_run_1",
      relativePath: "generated/reviews/TASK-1001-chapter-plan.html",
      content: "<!doctype html><html><body><h1>审阅页</h1></body></html>",
      now: new Date("2026-09-29T12:30:00.000Z"),
    }, { db: db as never, storageRoot: root });

    expect(saved).toMatchObject({
      artifactId: expect.stringMatching(/^[a-f0-9]{32}$/u),
      fileName: "TASK-1001-chapter-plan.html",
      mimeType: "text/html",
      relativePath: "generated/reviews/TASK-1001-chapter-plan.html",
    });
    expect(db.artifact.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: saved.artifactId,
        projectId: "project_1",
        taskId: "task_1",
        agentRunId: "agent_run_1",
        loopNodeRunId: "node_run_1",
        type: "review_html",
        mimeType: "text/html",
        metadata: expect.objectContaining({
          relativePath: "generated/reviews/TASK-1001-chapter-plan.html",
          source: "agent_review",
        }),
      }),
      select: expect.any(Object),
    });

    const stored = records.get(saved.artifactId)!;
    expect(await readFile(join(root, String(stored.storageKey)), "utf8"))
      .toContain("审阅页");
  });

  it("rejects absolute, traversing, and non-review paths before persistence", async () => {
    const root = await storageRoot();
    const create = vi.fn();

    for (const relativePath of [
      "/generated/reviews/plan.html",
      "generated/reviews/../secret.html",
      "generated/reviews/plan.txt",
      "src/plan.html",
    ]) {
      await expect(saveLoopReviewArtifact({
        projectId: "project_1",
        taskId: null,
        agentRunId: "agent_run_1",
        loopNodeRunId: "node_run_1",
        relativePath,
        content: "<html></html>",
      }, { db: { artifact: { findUnique: vi.fn(), create } } as never, storageRoot: root }))
        .rejects.toMatchObject({ code: "invalid_review_artifact_path" });
    }
    expect(create).not.toHaveBeenCalled();
  });

  it("reads the preview only after Project authorization", async () => {
    const root = await storageRoot();
    let record: Record<string, unknown> | null = null;
    const saved = await saveLoopReviewArtifact({
      projectId: "project_1",
      taskId: null,
      agentRunId: "agent_run_1",
      loopNodeRunId: "node_run_1",
      relativePath: "generated/reviews/chapter-plan.html",
      content: "<h1>fine</h1>",
    }, {
      db: {
        artifact: {
          findUnique: vi.fn().mockResolvedValue(null),
          create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
            record = data;
            return data;
          }),
        },
      } as never,
      storageRoot: root,
    });
    expect(record).not.toBeNull();

    const assertCanReadProject = vi.fn().mockResolvedValue({ projectId: "project_1" });
    const read = await readLoopReviewArtifact({
      userId: "user_1",
      artifactId: saved.artifactId,
    }, {
      db: { artifact: { findUnique: vi.fn().mockResolvedValue(record) } } as never,
      storageRoot: root,
      assertCanReadProject,
    });

    expect(assertCanReadProject).toHaveBeenCalledWith({ userId: "user_1", projectId: "project_1" });
    expect(read).toMatchObject({
      artifactId: saved.artifactId,
      fileName: "chapter-plan.html",
      mimeType: "text/html",
      href: `/api/loop-artifacts/${saved.artifactId}`,
    });
    expect(Buffer.from(read.bytes).toString("utf8")).toContain("fine");
  });
});

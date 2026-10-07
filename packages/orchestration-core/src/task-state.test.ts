import { describe, expect, it } from "vitest";
import { deriveTaskProgress, transitionTask } from "./task-state";

function task(overrides: Record<string, unknown> = {}) {
  return {
    id: "task_1",
    status: "todo" as const,
    version: 3,
    acceptanceMode: "none" as const,
    isBlocked: false,
    ...overrides,
  };
}

describe("user task state", () => {
  it("moves a normal task to in progress and completes it without acceptance", () => {
    const started = transitionTask({ task: task(), command: "start", actorType: "user" });
    expect(started).toMatchObject({ status: "in_progress", version: 4 });

    const completed = transitionTask({
      task: { ...task(), status: started.status, version: started.version },
      command: "complete",
      actorType: "user",
    });
    expect(completed).toMatchObject({ status: "completed", version: 5 });
  });

  it("requires review for human, automated, and hybrid acceptance modes", () => {
    const started = transitionTask({
      task: task({ acceptanceMode: "hybrid" }),
      command: "start",
      actorType: "user",
    });
    const review = transitionTask({
      task: { ...task({ acceptanceMode: "hybrid" }), status: started.status, version: started.version },
      command: "submit_for_review",
      actorType: "user",
    });

    expect(review).toMatchObject({ status: "in_review", version: 5 });
    expect(transitionTask({
      task: { ...task({ acceptanceMode: "hybrid" }), status: review.status, version: review.version },
      command: "accept",
      actorType: "user",
      acceptancePassed: true,
    })).toMatchObject({ status: "completed", version: 6 });
  });

  it.each(["user", "system"] as const)(
    "allows a %s actor to accept automated work only with verified evidence",
    (actorType) => {
      expect(transitionTask({
        task: task({ status: "in_review", acceptanceMode: "automated" }),
        command: "accept",
        actorType,
        acceptancePassed: true,
      })).toMatchObject({ status: "completed", version: 4 });

      expect(() => transitionTask({
        task: task({ status: "in_review", acceptanceMode: "automated" }),
        command: "accept",
        actorType,
      })).toThrowError(/task_acceptance_evidence_required/u);
    },
  );

  it.each(["agent", "worker"] as const)(
    "rejects a %s actor accepting automated work even with evidence",
    (actorType) => {
      expect(() => transitionTask({
        task: task({ status: "in_review", acceptanceMode: "automated" }),
        command: "accept",
        actorType,
        acceptancePassed: true,
      })).toThrowError(/task_actor_cannot_complete/u);
    },
  );

  it("rejects completion by Agent actors even when acceptance mode is none", () => {
    expect(() => transitionTask({
      task: task({ status: "in_progress" }),
      command: "complete",
      actorType: "agent",
    })).toThrowError(/task_actor_cannot_complete/);
  });

  it("reopens a completed task into todo and cancels active work", () => {
    expect(transitionTask({
      task: task({ status: "completed" }),
      command: "reopen",
      actorType: "user",
    })).toMatchObject({ status: "todo", version: 4 });

    expect(transitionTask({
      task: task({ status: "in_progress" }),
      command: "cancel",
      actorType: "user",
    })).toMatchObject({ status: "cancelled", version: 4 });
  });

  it("keeps blockers orthogonal to lifecycle transitions", () => {
    const result = transitionTask({
      task: task({ status: "in_progress", isBlocked: true }),
      command: "submit_for_review",
      actorType: "user",
    });

    expect(result).toMatchObject({ status: "in_review", isBlocked: true });
  });

  it("derives child progress without completing the parent", () => {
    expect(deriveTaskProgress([
      { status: "completed" },
      { status: "in_progress" },
      { status: "cancelled" },
    ])).toEqual({ completed: 1, total: 3, percent: 33, allCompleted: false });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  assertCanWriteProject,
  decideKnowledgeCandidate,
  readKnowledgeCandidateAccess,
} from "@humanthread/db";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { POST } from "./route";

vi.mock("@humanthread/db", () => ({
  assertCanWriteProject: vi.fn(),
  decideKnowledgeCandidate: vi.fn(),
  readKnowledgeCandidateAccess: vi.fn(),
}));
vi.mock("@/lib/workbench/workbench-api-session", () => ({
  resolveWorkbenchApiActor: vi.fn(),
}));

const context = { params: Promise.resolve({ candidateId: "candidate_1" }) };

function request(body: unknown) {
  return new Request("http://localhost/api/knowledge-candidates/candidate_1/decision", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/knowledge-candidates/:candidateId/decision", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveWorkbenchApiActor).mockResolvedValue({ userId: "reviewer_1", authKind: "web_session", webSessionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
    vi.mocked(readKnowledgeCandidateAccess).mockResolvedValue({ id: "candidate_1", projectId: "project_1" });
    vi.mocked(assertCanWriteProject).mockResolvedValue({ projectId: "project_1", role: "maintainer" });
  });

  it("rejects an unauthorized decision before loading or mutating candidate content", async () => {
    vi.mocked(assertCanWriteProject).mockRejectedValue(new Error("Project write access denied"));

    const response = await POST(request({
      commandId: "decision_1",
      decision: "publish",
    }), context);

    expect(response.status).toBe(403);
    expect(readKnowledgeCandidateAccess).toHaveBeenCalledWith({ candidateId: "candidate_1" });
    expect(assertCanWriteProject).toHaveBeenCalledWith({ userId: "reviewer_1", projectId: "project_1" });
    expect(decideKnowledgeCandidate).not.toHaveBeenCalled();
  });

  it("publishes an authorized candidate through the signed actor", async () => {
    vi.mocked(decideKnowledgeCandidate).mockResolvedValue({
      id: "candidate_1",
      status: "published",
      publishedDocumentId: "doc_1",
      publishedDocumentVersion: 1,
    } as never);

    const response = await POST(request({
      commandId: "decision_2",
      decision: "publish",
    }), context);

    expect(response.status).toBe(200);
    expect(decideKnowledgeCandidate).toHaveBeenCalledWith(expect.objectContaining({
      candidateId: "candidate_1",
      actorUserId: "reviewer_1",
      decision: "publish",
    }));
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      result: { status: "published", publishedDocumentId: "doc_1" },
    });
  });

  it("requires a reason for rejection before resolving the actor", async () => {
    const response = await POST(request({
      commandId: "decision_3",
      decision: "reject",
      reason: " ",
    }), context);

    expect(response.status).toBe(400);
    expect(resolveWorkbenchApiActor).not.toHaveBeenCalled();
    expect(decideKnowledgeCandidate).not.toHaveBeenCalled();
  });
});

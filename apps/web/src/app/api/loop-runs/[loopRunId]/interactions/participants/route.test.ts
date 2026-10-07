import { expect, it, vi } from "vitest";

import { listEligibleWorkflowParticipants } from "@/lib/orchestration/workflow-interaction-participants";
import { GET } from "./route";

vi.mock("@/lib/workbench/workbench-api-session", () => ({
  resolveWorkbenchApiActor: vi.fn().mockResolvedValue({ userId: "user_session" }),
}));
vi.mock("@/lib/orchestration/workflow-interaction-participants", () => ({
  listEligibleWorkflowParticipants: vi.fn(),
}));

it("lists authorized workflow participants for the LoopRun", async () => {
  vi.mocked(listEligibleWorkflowParticipants).mockResolvedValue([{
    userId: "user_2",
    displayName: "Li",
    avatarUrl: null,
    relationship: "task_assignee",
  }]);
  const response = await GET(
    new Request("http://localhost/api/loop-runs/run_1/interactions/participants?query=li"),
    { params: Promise.resolve({ loopRunId: "run_1" }) },
  );

  expect(response.status).toBe(200);
  expect(listEligibleWorkflowParticipants).toHaveBeenCalledWith({
    userId: "user_session",
    loopRunId: "run_1",
    query: "li",
  });
  await expect(response.json()).resolves.toEqual({
    ok: true,
    participants: [expect.objectContaining({ userId: "user_2" })],
  });
});

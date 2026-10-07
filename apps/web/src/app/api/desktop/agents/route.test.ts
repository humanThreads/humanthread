import { vi } from "vitest";
import { desktopAgentsResponseSchema } from "@humanthread/workbench-client";
import { readDesktopAgents } from "@/lib/desktop/desktop-read-models";
import { testDesktopReadRoute } from "../route-test-support";
import { GET } from "./route";

vi.mock("@/lib/desktop/desktop-read-models", () => ({ readDesktopAgents: vi.fn() }));

testDesktopReadRoute({
  name: "agents",
  url: "http://localhost:3000/api/desktop/agents",
  get: GET,
  read: vi.mocked(readDesktopAgents),
  schema: desktopAgentsResponseSchema,
  data: {
    canManage: false,
    profiles: [],
    workers: [],
    runs: [],
    loops: [{
      id: "loop_1",
      taskId: "task_1",
      taskTitle: "Desktop Agent compatibility",
      loopName: "Task Loop",
      scope: "task",
      parentLoopRunId: null,
      parentLoopName: null,
      status: "waiting",
      waitingReason: "worker_offline",
      version: 1,
      currentIteration: 0,
      maxIterations: 1,
      attempt: 0,
      lastHeartbeatAt: null,
      route: "/tasks/task_1",
    }],
    approvals: [],
  },
});

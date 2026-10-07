import { vi } from "vitest";
import { desktopReportsResponseSchema } from "@humanthread/workbench-client";
import { readDesktopReports } from "@/lib/desktop/desktop-read-models";
import { testDesktopReadRoute } from "../route-test-support";
import { GET } from "./route";

vi.mock("@/lib/desktop/desktop-read-models", () => ({ readDesktopReports: vi.fn() }));

testDesktopReadRoute({
  name: "reports",
  url: "http://localhost:3000/api/desktop/reports",
  get: GET,
  read: vi.mocked(readDesktopReports),
  schema: desktopReportsResponseSchema,
  data: {
    range: "30d",
    generatedAt: "2026-07-27T10:15:00.000Z",
    metrics: {
      completedTasks: 0,
      overdueTasks: 0,
      blockerMedianAgeHours: null,
      humanWaitMedianAgeHours: null,
      automationSuccess: { state: "unavailable", label: "未自动化" },
    },
    trend: { state: "insufficient", message: "数据不足" },
    projects: [],
    insights: [],
  },
});

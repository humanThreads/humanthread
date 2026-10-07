import { vi } from "vitest";
import { desktopDashboardResponseSchema } from "@humanthread/workbench-client";
import { readDesktopDashboard } from "@/lib/desktop/desktop-read-models";
import { testDesktopReadRoute } from "../route-test-support";
import { GET } from "./route";

vi.mock("@/lib/desktop/desktop-read-models", () => ({ readDesktopDashboard: vi.fn() }));

testDesktopReadRoute({
  name: "dashboard",
  url: "http://localhost:3000/api/desktop/dashboard",
  get: GET,
  read: vi.mocked(readDesktopDashboard),
  schema: desktopDashboardResponseSchema,
  data: { currentTask: null, stats: [], actionSignals: [], tasks: [], devices: [] },
});

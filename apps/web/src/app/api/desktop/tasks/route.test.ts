import { desktopTaskCollectionResponseSchema } from "@humanthread/workbench-client";
import { vi } from "vitest";

import { readDesktopTasks } from "@/lib/desktop/desktop-read-models";
import { testDesktopReadRoute } from "../route-test-support";
import { GET } from "./route";

vi.mock("@/lib/desktop/desktop-read-models", () => ({ readDesktopTasks: vi.fn() }));

testDesktopReadRoute({
  name: "tasks",
  url: "http://localhost:3000/api/desktop/tasks?space=company:company_1",
  get: GET,
  read: vi.mocked(readDesktopTasks),
  schema: desktopTaskCollectionResponseSchema,
  data: {
    collection: {
      listRows: [],
      boardGroups: [],
      calendar: { entries: [], unscheduled: [] },
      relationCounts: {},
      total: 0,
    },
  },
});

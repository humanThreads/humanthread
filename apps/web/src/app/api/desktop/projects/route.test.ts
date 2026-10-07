import { desktopProjectCollectionResponseSchema } from "@humanthread/workbench-client";
import { vi } from "vitest";

import { readDesktopProjects } from "@/lib/desktop/desktop-read-models";
import { testDesktopReadRoute } from "../route-test-support";
import { GET } from "./route";

vi.mock("@/lib/desktop/desktop-read-models", () => ({ readDesktopProjects: vi.fn() }));

testDesktopReadRoute({
  name: "projects",
  url: "http://localhost:3000/api/desktop/projects?space=company:company_1",
  get: GET,
  read: vi.mocked(readDesktopProjects),
  schema: desktopProjectCollectionResponseSchema,
  data: { projects: [] },
});

import { vi } from "vitest";
import { desktopSearchResponseSchema } from "@humanthread/workbench-client";
import { readDesktopSearch } from "@/lib/desktop/desktop-read-models";
import { testDesktopReadRoute } from "../route-test-support";
import { GET } from "./route";

vi.mock("@/lib/desktop/desktop-read-models", () => ({ readDesktopSearch: vi.fn() }));

testDesktopReadRoute({
  name: "search",
  url: "http://localhost:3000/api/desktop/search?q=desktop",
  get: GET,
  read: vi.mocked(readDesktopSearch),
  schema: desktopSearchResponseSchema,
  data: { query: "desktop", tasks: [], projects: [], documents: [], members: [], agents: [] },
});

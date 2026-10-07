import { vi } from "vitest";
import { desktopBootstrapResponseSchema } from "@humanthread/workbench-client";
import { readDesktopBootstrap } from "@/lib/desktop/desktop-read-models";
import { testDesktopReadRoute } from "../../route-test-support";
import { GET } from "./route";

vi.mock("@/lib/desktop/desktop-read-models", () => ({ readDesktopBootstrap: vi.fn() }));

testDesktopReadRoute({
  name: "bootstrap",
  url: "http://localhost:3000/api/desktop/session/bootstrap",
  get: GET,
  read: vi.mocked(readDesktopBootstrap),
  schema: desktopBootstrapResponseSchema,
  data: {
    spaces: [{ key: "personal", kind: "personal", name: "Personal" }],
    activeSpaceKey: "personal",
    currentTask: { id: "task_1", title: "Desktop API", status: "active" },
    capabilities: { nativeExecution: true },
  },
});

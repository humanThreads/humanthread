import { vi } from "vitest";
import { desktopTemplatesResponseSchema } from "@humanthread/workbench-client";
import { readDesktopTemplates } from "@/lib/desktop/desktop-read-models";
import { testDesktopReadRoute } from "../route-test-support";
import { GET } from "./route";

vi.mock("@/lib/desktop/desktop-read-models", () => ({ readDesktopTemplates: vi.fn() }));

testDesktopReadRoute({
  name: "templates",
  url: "http://localhost:3000/api/desktop/templates",
  get: GET,
  read: vi.mocked(readDesktopTemplates),
  schema: desktopTemplatesResponseSchema,
  data: { templates: [] },
});

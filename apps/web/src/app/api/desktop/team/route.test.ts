import { vi } from "vitest";
import { desktopTeamResponseSchema } from "@humanthread/workbench-client";
import { readDesktopTeam } from "@/lib/desktop/desktop-read-models";
import { testDesktopReadRoute } from "../route-test-support";
import { GET } from "./route";

vi.mock("@/lib/desktop/desktop-read-models", () => ({ readDesktopTeam: vi.fn() }));

testDesktopReadRoute({
  name: "team",
  url: "http://localhost:3000/api/desktop/team",
  get: GET,
  read: vi.mocked(readDesktopTeam),
  schema: desktopTeamResponseSchema,
  data: { team: null, members: [] },
});

import { vi } from "vitest";
import { desktopSettingsResponseSchema } from "@humanthread/workbench-client";
import { readDesktopSettings } from "@/lib/desktop/desktop-read-models";
import { testDesktopReadRoute } from "../route-test-support";
import { GET } from "./route";

vi.mock("@/lib/desktop/desktop-read-models", () => ({ readDesktopSettings: vi.fn() }));

testDesktopReadRoute({
  name: "settings",
  url: "http://localhost:3000/api/desktop/settings",
  get: GET,
  read: vi.mocked(readDesktopSettings),
  schema: desktopSettingsResponseSchema,
  data: {
    user: {
      id: "user_1",
      name: "User",
      email: "user@example.com",
      avatarUrl: null,
      status: "active",
    },
    companies: [],
    isSiteAdmin: false,
    selectedCompany: null,
  },
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { resolveWorkbenchSession } from "../../../../lib/workbench/workbench-session";
import { getWorkbenchNotificationSummary } from "../../../../lib/workbench/workbench-notification-summary";
import { getWorkbenchCompanyFilters } from "../../../../lib/workbench/workbench-companies";

vi.mock("../../../../lib/workbench/workbench-session", () => ({
  resolveWorkbenchSession: vi.fn(),
}));

vi.mock("../../../../lib/workbench/workbench-companies", () => ({
  getWorkbenchCompanyFilters: vi.fn(),
}));

vi.mock("../../../../lib/workbench/workbench-notification-summary", () => ({
  getWorkbenchNotificationSummary: vi.fn(),
}));

describe("GET /api/notifications/summary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the real unread count for the current session and selected space", async () => {
    vi.mocked(resolveWorkbenchSession).mockResolvedValue({
      loginEmail: "owner@example.com",
      selectedUserId: null,
      webSessionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      context: {
        teamId: "team_1",
        userId: "user_owner",
        projectId: "project_1",
        matterTypeId: "matter_1",
      },
    });
    vi.mocked(getWorkbenchNotificationSummary).mockResolvedValue({
      unreadCount: 5,
      todayCount: 7,
    });
    vi.mocked(getWorkbenchCompanyFilters).mockResolvedValue([
      { key: "all", label: "全部", companyId: null, ownerType: null },
      {
        key: "personal",
        label: "个人空间",
        companyId: null,
        ownerType: "personal",
      },
      {
        key: "company_1",
        label: "HumanThread Company",
        companyId: "company_1",
        ownerType: "company",
      },
    ]);

    const response = await GET(
      new Request("http://localhost:3000/api/notifications/summary", {
        headers: {
          cookie: "ht_workbench_session=session-cookie; ht_workbench_space=company_1",
        },
      }),
    );
    const body = (await response.json()) as {
      ok: boolean;
      summary: {
        unreadCount: number;
        todayCount: number;
      };
    };

    expect(response.status).toBe(200);
    expect(getWorkbenchNotificationSummary).toHaveBeenCalledWith({
      teamId: "team_1",
      userId: "user_owner",
      companyId: "company_1",
      ownerType: "company",
    });
    expect(body).toEqual({
      ok: true,
      summary: {
        unreadCount: 5,
        todayCount: 7,
      },
    });
  });

  it("rejects anonymous requests", async () => {
    vi.mocked(resolveWorkbenchSession).mockResolvedValue({
      loginEmail: null,
      selectedUserId: null,
      webSessionId: null,
      context: {
        teamId: "team_1",
        userId: "user_owner",
        projectId: "project_1",
        matterTypeId: "matter_1",
      },
    });
    vi.mocked(getWorkbenchCompanyFilters).mockResolvedValue([
      { key: "all", label: "全部", companyId: null, ownerType: null },
    ]);

    const response = await GET(
      new Request("http://localhost:3000/api/notifications/summary"),
    );
    const body = (await response.json()) as {
      ok: boolean;
      error: string;
    };

    expect(response.status).toBe(401);
    expect(body).toEqual({
      ok: false,
      error: "unauthorized",
    });
    expect(getWorkbenchNotificationSummary).not.toHaveBeenCalled();
  });
});

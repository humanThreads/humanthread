import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { getTeamOverview } from "@/lib/overviews/task-overviews";
import { resolveWorkbenchSession } from "@/lib/workbench/workbench-session";

vi.mock("@/lib/overviews/task-overviews", () => ({
  getTeamOverview: vi.fn().mockResolvedValue({
    team: {
      id: "team_1",
      name: "HumanThread Team",
    },
    members: [
      {
        user: {
          id: "user_owner",
          name: "alice",
          email: "alice@example.com",
          status: "active",
          lastSeenAt: null,
        },
        currentTask: null,
        queueLength: 0,
      },
    ],
  }),
}));

vi.mock("@/lib/workbench/workbench-session", () => ({
  resolveWorkbenchSession: vi.fn(),
}));

describe("GET /api/team", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the team overview", async () => {
    vi.mocked(resolveWorkbenchSession).mockResolvedValue({
      loginEmail: "owner@example.com",
      selectedUserId: null,
      webSessionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      context: {
        teamId: "team_from_session",
        userId: "user_owner",
        projectId: "project_1",
        matterTypeId: "matter_1",
      },
    });

    const response = await GET(
      new Request(
        "http://localhost:3000/api/team?teamId=team_leaked&companyId=company_1",
        {
          headers: {
            cookie: "ht_workbench_session=session-cookie",
          },
        },
      ),
    );
    const body = (await response.json()) as {
      ok: boolean;
      team: { id: string } | null;
      members: Array<{ user: { id: string } }>;
    };

    expect(body).toMatchObject({
      ok: true,
      team: {
        id: "team_1",
      },
      members: [
        {
          user: {
            id: "user_owner",
          },
        },
      ],
    });
    expect(resolveWorkbenchSession).toHaveBeenCalledWith({
      getCookieValue: expect.any(Function),
    });
    expect(getTeamOverview).toHaveBeenCalledWith({
      teamId: "team_from_session",
      userId: "user_owner",
      companyId: "company_1",
    });
  });

  it("rejects anonymous requests", async () => {
    vi.mocked(resolveWorkbenchSession).mockResolvedValue({
      loginEmail: null,
      selectedUserId: null,
      webSessionId: null,
      context: {
        teamId: "team_from_session",
        userId: "user_owner",
        projectId: "project_1",
        matterTypeId: "matter_1",
      },
    });

    const response = await GET(new Request("http://localhost:3000/api/team"));
    const body = (await response.json()) as {
      ok: boolean;
      error: string;
    };

    expect(response.status).toBe(401);
    expect(body).toEqual({
      ok: false,
      error: "unauthorized",
    });
    expect(getTeamOverview).not.toHaveBeenCalled();
  });
});

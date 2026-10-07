import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

vi.mock("../../../lib/workbench/workbench-session", () => ({
  resolveWorkbenchSession: vi.fn(),
}));

vi.mock("../../../lib/workbench/workbench-notification-state", () => ({
  markWorkbenchNotificationRead: vi.fn(),
}));

vi.mock("../../../lib/workbench/workbench-notifications", () => ({
  listAccessibleLoopNotificationIntents: vi.fn(),
}));

vi.mock("@humanthread/db", () => ({
  markLoopNotificationIntentRead: vi.fn(),
}));

import { resolveWorkbenchSession } from "../../../lib/workbench/workbench-session";
import { markWorkbenchNotificationRead } from "../../../lib/workbench/workbench-notification-state";
import { listAccessibleLoopNotificationIntents } from "../../../lib/workbench/workbench-notifications";
import { markLoopNotificationIntentRead } from "@humanthread/db";

describe("GET /notifications/open", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("marks the notification as read and redirects to the target page", async () => {
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
    vi.mocked(markWorkbenchNotificationRead).mockResolvedValue(undefined);

    const response = await GET(
      new Request(
        "http://localhost:3000/notifications/open?notificationId=event%3Aevent_1&redirectTo=%2Fworkflows%2Fworkflow_1",
      ),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("/workflows/workflow_1");
    expect(markWorkbenchNotificationRead).toHaveBeenCalledWith({
      userId: "user_owner",
      notificationId: "event:event_1",
    });
  });

  it("redirects anonymous users to login", async () => {
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

    const response = await GET(
      new Request(
        "http://localhost:3000/notifications/open?notificationId=event%3Aevent_1&redirectTo=%2Fworkflows%2Fworkflow_1",
      ),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "/login?redirectTo=%2Fnotifications%2Fopen%3FnotificationId%3Devent%253Aevent_1%26redirectTo%3D%252Fworkflows%252Fworkflow_1",
    );
    expect(markWorkbenchNotificationRead).not.toHaveBeenCalled();
  });

  it("marks an authorized Loop intent in its durable read model", async () => {
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
    vi.mocked(listAccessibleLoopNotificationIntents).mockResolvedValue([{
      id: "loop-notification:notice_1",
    }] as never);

    const response = await GET(new Request(
      "http://localhost:3000/notifications/open?notificationId=loop-notification%3Anotice_1&redirectTo=%2Floop-runs%2Frun_1",
    ));

    expect(response.headers.get("location")).toBe("/loop-runs/run_1");
    expect(markLoopNotificationIntentRead).toHaveBeenCalledWith({
      notificationId: "loop-notification:notice_1",
      recipientUserId: "user_owner",
    });
    expect(markWorkbenchNotificationRead).not.toHaveBeenCalled();
  });
});

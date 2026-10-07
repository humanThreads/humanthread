import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveDesktopReadContext } from "@/lib/desktop/desktop-read-models";
import { createUserTask } from "@/lib/tasks/task-commands";
import { createWorkbenchSpaceDocument } from "@/lib/workbench/workbench-documents";
import { createWorkbenchProject } from "@/lib/workbench/workbench-project-commands";
import { POST } from "./route";

vi.mock("@/lib/tasks/task-commands", () => ({ createUserTask: vi.fn() }));
vi.mock("@/lib/workbench/workbench-project-commands", () => ({ createWorkbenchProject: vi.fn() }));
vi.mock("@/lib/workbench/workbench-documents", () => ({ createWorkbenchSpaceDocument: vi.fn() }));
vi.mock("@/lib/desktop/desktop-read-models", () => ({ resolveDesktopReadContext: vi.fn() }));
vi.mock("@/lib/workbench/project-knowledge-bootstrap", () => ({
  initializeProjectKnowledgeAfterCreate: vi.fn(async () => ({ templateVersionId: "t".repeat(32) })),
}));

describe("POST /api/desktop/create", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveDesktopReadContext).mockResolvedValue({
      actor: { userId: "user_1", authKind: "desktop_token", sessionId: "session_1" },
      space: {
        id: "space_internal_1",
        key: "company:company_1",
        kind: "company",
        name: "HumanThread",
        role: "owner",
        companyId: "company_1",
      },
      spaces: [],
      workbench: { teamId: "team_1" },
    } as never);
  });

  it("resolves the public Space key before creating a task", async () => {
    vi.mocked(createUserTask).mockResolvedValue({ taskId: "task_1", version: 1 } as never);
    const response = await POST(new Request("https://host/api/desktop/create", {
      method: "POST",
      headers: {
        authorization: "Bearer access_1",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        kind: "task",
        spaceKey: "company:company_1",
        commandId: "desktop:create:1",
        title: "修复桌面登录",
      }),
    }));

    expect(response.status).toBe(201);
    expect(resolveDesktopReadContext).toHaveBeenCalledWith(expect.objectContaining({
      url: "https://host/api/desktop/create?space=company%3Acompany_1",
    }));
    expect(createUserTask).toHaveBeenCalledWith({
      actor: { type: "user", id: "user_1" },
      commandId: "desktop:create:1",
      correlationId: "desktop:create:desktop:create:1",
      payload: {
        spaceId: "space_internal_1",
        title: "修复桌面登录",
      },
    });
    expect(await response.json()).toEqual({
      ok: true,
      data: { kind: "task", result: { taskId: "task_1", version: 1 } },
    });
  });

  it("creates a project with the authenticated actor as manager", async () => {
    vi.mocked(createWorkbenchProject).mockResolvedValue({ projectId: "project_1", version: 1 });
    const response = await POST(createRequest({
      kind: "project",
      spaceKey: "company:company_1",
      name: "桌面工作台",
      objective: "让本地执行和项目上下文保持一致",
      userId: "forged_user",
      spaceId: "forged_space",
    }));

    expect(response.status).toBe(201);
    expect(createWorkbenchProject).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user_1",
      spaceId: "space_internal_1",
      name: "桌面工作台",
      objective: "让本地执行和项目上下文保持一致",
      managerUserId: "user_1",
    }));
  });

  it("generates the document path on the server", async () => {
    vi.mocked(createWorkbenchSpaceDocument).mockResolvedValue({
      documentId: "document_1",
      version: 1,
    } as never);
    const response = await POST(createRequest({
      kind: "document",
      spaceKey: "company:company_1",
      title: "桌面客户端设计",
      path: "forged/private.md",
    }));

    expect(response.status).toBe(201);
    expect(createWorkbenchSpaceDocument).toHaveBeenCalledWith({
      userId: "user_1",
      spaceId: "space_internal_1",
      title: "桌面客户端设计",
      path: expect.stringMatching(/^桌面客户端设计-[a-f0-9]{8}\.md$/u),
      contentMarkdown: "# 桌面客户端设计\n",
      source: "web",
    });
  });

  it("rejects invalid input before resolving the Space", async () => {
    const response = await POST(createRequest({
      kind: "project",
      spaceKey: "company:company_1",
      name: "桌面工作台",
      objective: "",
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      ok: false,
      code: "validation_failed",
      error: "Invalid desktop create request",
    });
    expect(resolveDesktopReadContext).not.toHaveBeenCalled();
  });

  it("maps unauthenticated and unauthorized requests without running mutations", async () => {
    vi.mocked(resolveDesktopReadContext)
      .mockRejectedValueOnce(new Error("Workbench API authentication required"))
      .mockRejectedValueOnce(new Error("Space access denied"));

    const unauthenticated = await POST(createRequest({
      kind: "task",
      spaceKey: "company:company_1",
      commandId: "desktop:create:unauthenticated",
      title: "未登录任务",
    }));
    const unauthorized = await POST(createRequest({
      kind: "document",
      spaceKey: "company:company_1",
      title: "越权文档",
    }));

    expect(unauthenticated.status).toBe(401);
    expect(unauthorized.status).toBe(403);
    expect(createUserTask).not.toHaveBeenCalled();
    expect(createWorkbenchProject).not.toHaveBeenCalled();
    expect(createWorkbenchSpaceDocument).not.toHaveBeenCalled();
  });

  it("maps structured command authorization failures to forbidden", async () => {
    vi.mocked(createUserTask).mockRejectedValue(Object.assign(
      new Error("authorization_denied: Space write denied"),
      { code: "authorization_denied" },
    ));

    const response = await POST(createRequest({
      kind: "task",
      spaceKey: "company:company_1",
      commandId: "desktop:create:forbidden",
      title: "越权任务",
    }));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      ok: false,
      code: "authorization_denied",
      error: "authorization_denied: Space write denied",
    });
  });
});

function createRequest(body: Record<string, unknown>) {
  return new Request("https://host/api/desktop/create", {
    method: "POST",
    headers: {
      authorization: "Bearer access_1",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

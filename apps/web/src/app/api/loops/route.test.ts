import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLoopDraftCommand } from "@/lib/orchestration/loop-definition-commands";
import { listLoopDefinitionsForUser } from "@/lib/orchestration/loop-product-read-model";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { GET, POST } from "./route";

vi.mock("@/lib/orchestration/loop-definition-commands", () => ({ createLoopDraftCommand: vi.fn() }));
vi.mock("@/lib/orchestration/loop-product-read-model", () => ({ listLoopDefinitionsForUser: vi.fn() }));
vi.mock("@/lib/workbench/workbench-api-session", () => ({ resolveWorkbenchApiActor: vi.fn() }));

const body = {
  commandId: "create_1",
  spaceId: "space_1",
  name: "Delivery loop",
  graph: {
    schemaVersion: 1,
    inputSchema: {},
    outputSchema: {},
    limits: { maxStages: 2, maxRepeatCount: 1 },
    nodes: [
      { key: "start", label: "Start", type: "start" },
      { key: "end", label: "End", type: "end" },
    ],
    edges: [{ id: "start-end", source: "start", target: "end", kind: "normal", outcome: "success" }],
  },
};

function request(value: unknown) {
  return new Request("http://localhost/api/loops", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  });
}

describe("POST /api/loops", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveWorkbenchApiActor).mockResolvedValue({ userId: "user_session", authKind: "web_session", webSessionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
  });

  it("creates a draft for the signed actor", async () => {
    vi.mocked(createLoopDraftCommand).mockResolvedValue({ loopDefinitionId: "loop_definition_1", draftRevision: 1 });

    const response = await POST(request(body));

    expect(response.status).toBe(201);
    expect(createLoopDraftCommand).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: "user_session",
      commandId: "create_1",
      spaceId: "space_1",
      scope: "task",
    }));
    await expect(response.json()).resolves.toEqual({
      ok: true,
      result: { loopDefinitionId: "loop_definition_1", draftRevision: 1 },
    });
  });

  it("rejects unknown request fields through a strict schema", async () => {
    const response = await POST(request({ ...body, transition: { target: "forged" } }));

    expect(response.status).toBe(400);
    expect(createLoopDraftCommand).not.toHaveBeenCalled();
  });

  it("rejects a browser-supplied Loop origin", async () => {
    const response = await POST(request({ ...body, origin: "platform" }));

    expect(response.status).toBe(400);
    expect(createLoopDraftCommand).not.toHaveBeenCalled();
  });

  it("returns 401 before invoking the command when authentication is missing", async () => {
    vi.mocked(resolveWorkbenchApiActor).mockRejectedValue(new Error("Workbench API authentication required"));

    const response = await POST(request(body));

    expect(response.status).toBe(401);
    expect(createLoopDraftCommand).not.toHaveBeenCalled();
  });

  it("authenticates before parsing an anonymous malformed body", async () => {
    vi.mocked(resolveWorkbenchApiActor).mockRejectedValue(new Error("Workbench API authentication required"));

    const response = await POST(request({ commandId: "" }));

    expect(response.status).toBe(401);
    expect(createLoopDraftCommand).not.toHaveBeenCalled();
  });
});

describe("GET /api/loops", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveWorkbenchApiActor).mockResolvedValue({ userId: "user_session", authKind: "web_session", webSessionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
  });

  it("lists definitions visible in the selected Space", async () => {
    vi.mocked(listLoopDefinitionsForUser).mockResolvedValue([{ id: "loop_visible", spaceId: "space_1" }]);

    const response = await GET(new Request("http://localhost/api/loops?spaceId=space_1"));

    expect(response.status).toBe(200);
    expect(listLoopDefinitionsForUser).toHaveBeenCalledWith({ userId: "user_session", spaceId: "space_1" });
    await expect(response.json()).resolves.toEqual({
      ok: true,
      result: [{ id: "loop_visible", spaceId: "space_1" }],
    });
  });

  it("rejects a missing Space scope", async () => {
    const response = await GET(new Request("http://localhost/api/loops"));

    expect(response.status).toBe(400);
    expect(listLoopDefinitionsForUser).not.toHaveBeenCalled();
  });
});

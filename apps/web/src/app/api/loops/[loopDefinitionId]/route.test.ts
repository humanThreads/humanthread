import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  activateLoopVersionCommand,
  archiveLoopDefinitionCommand,
  deleteLoopDefinitionCommand,
  updateLoopDraftCommand,
} from "@/lib/orchestration/loop-definition-commands";
import { readLoopDefinitionEditor } from "@/lib/orchestration/loop-product-read-model";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { DELETE, GET, PATCH, POST } from "./route";

vi.mock("@/lib/orchestration/loop-definition-commands", () => ({
  archiveLoopDefinitionCommand: vi.fn(),
  deleteLoopDefinitionCommand: vi.fn(),
  updateLoopDraftCommand: vi.fn(),
  activateLoopVersionCommand: vi.fn(),
}));
vi.mock("@/lib/orchestration/loop-product-read-model", () => ({ readLoopDefinitionEditor: vi.fn() }));
vi.mock("@/lib/workbench/workbench-api-session", () => ({ resolveWorkbenchApiActor: vi.fn() }));

const context = { params: Promise.resolve({ loopDefinitionId: "loop_definition_1" }) };

describe("PATCH /api/loops/:loopDefinitionId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveWorkbenchApiActor).mockResolvedValue({ userId: "user_session", authKind: "web_session", webSessionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
  });

  it("updates the expected draft revision for the signed actor", async () => {
    vi.mocked(updateLoopDraftCommand).mockResolvedValue({ loopDefinitionId: "loop_definition_1", draftRevision: 4 });
    const response = await PATCH(new Request("http://localhost/api/loops/loop_definition_1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        commandId: "update_1",
        expectedRevision: 3,
        name: "Updated loop",
        graph: {},
      }),
    }), context);

    expect(response.status).toBe(200);
    expect(updateLoopDraftCommand).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: "user_session",
      loopDefinitionId: "loop_definition_1",
      expectedDraftRevision: 3,
    }));
  });

  it("returns the current revision with an optimistic conflict", async () => {
    vi.mocked(updateLoopDraftCommand).mockRejectedValue(Object.assign(
      new Error("Loop definition draft changed"),
      { code: "version_conflict", currentRevision: 4 },
    ));
    const response = await PATCH(new Request("http://localhost/api/loops/loop_definition_1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        commandId: "update_stale",
        expectedRevision: 3,
        name: "Stale loop",
        graph: {},
      }),
    }), context);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: "version_conflict",
      currentRevision: 4,
    });
  });
});

describe("POST /api/loops/:loopDefinitionId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveWorkbenchApiActor).mockResolvedValue({ userId: "user_session", authKind: "web_session", webSessionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
  });

  it("activates a published historical version through the signed actor", async () => {
    vi.mocked(activateLoopVersionCommand).mockResolvedValue({
      loopDefinitionId: "loop_definition_1", activeVersionId: "loop_version_1", draftRevision: 4,
    });
    const response = await POST(new Request("http://localhost/api/loops/loop_definition_1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ commandId: "activate_1", expectedRevision: 3, activeVersionId: "loop_version_1" }),
    }), context);

    expect(response.status).toBe(200);
    expect(activateLoopVersionCommand).toHaveBeenCalledWith({
      actorUserId: "user_session", loopDefinitionId: "loop_definition_1", commandId: "activate_1",
      activeVersionId: "loop_version_1", expectedDraftRevision: 3,
    });
  });
});

describe("GET /api/loops/:loopDefinitionId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveWorkbenchApiActor).mockResolvedValue({ userId: "user_session", authKind: "web_session", webSessionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
  });

  it("returns the authorized editor read model", async () => {
    vi.mocked(readLoopDefinitionEditor).mockResolvedValue({
      definition: { id: "loop_definition_1", spaceId: "space_1", name: "Delivery Loop", draftGraph: {}, draftRevision: 3, versions: [] },
      draftRevision: 3,
      validation: { ok: true, maxTransitions: 4 },
      versions: [],
      lifecycle: {
        canArchive: true,
        canDelete: true,
        referenceCount: 0,
        references: { versions: 0, bindings: 0, runs: 0, receipts: 0, grants: 0 },
      },
      nodeCatalog: [],
      subloopOptions: [],
      platformCaps: { maxStages: 64, maxRepeatCount: 20, maxTransitions: 1024 },
    });

    const response = await GET(new Request("http://localhost/api/loops/loop_definition_1"), context);

    expect(response.status).toBe(200);
    expect(readLoopDefinitionEditor).toHaveBeenCalledWith({
      userId: "user_session",
      loopDefinitionId: "loop_definition_1",
    });
    await expect(response.json()).resolves.toMatchObject({ ok: true, result: { draftRevision: 3 } });
  });

  it("maps a missing definition to 404", async () => {
    vi.mocked(readLoopDefinitionEditor).mockResolvedValue(null);

    const response = await GET(new Request("http://localhost/api/loops/missing"), context);

    expect(response.status).toBe(404);
  });
});

describe("DELETE /api/loops/:loopDefinitionId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveWorkbenchApiActor).mockResolvedValue({ userId: "user_session", authKind: "web_session", webSessionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
  });

  it("archives through the signed actor and expected revision", async () => {
    vi.mocked(archiveLoopDefinitionCommand).mockResolvedValue({
      id: "loop_definition_1",
      status: "archived",
      draftRevision: 4,
    });
    const response = await DELETE(new Request("http://localhost/api/loops/loop_definition_1", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ commandId: "archive_1", expectedRevision: 3, mode: "archive" }),
    }), context);

    expect(response.status).toBe(200);
    expect(archiveLoopDefinitionCommand).toHaveBeenCalledWith({
      actorUserId: "user_session",
      commandId: "archive_1",
      loopDefinitionId: "loop_definition_1",
      expectedDraftRevision: 3,
    });
  });

  it("returns 400 for an invalid lifecycle mode", async () => {
    const response = await DELETE(new Request("http://localhost/api/loops/loop_definition_1", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ commandId: "purge_1", expectedRevision: 3, mode: "purge" }),
    }), context);

    expect(response.status).toBe(400);
    expect(deleteLoopDefinitionCommand).not.toHaveBeenCalled();
  });

  it.each([
    ["authorization_denied", 403],
    ["not_found", 404],
  ])("maps %s lifecycle failures to %i", async (code, status) => {
    vi.mocked(archiveLoopDefinitionCommand).mockRejectedValue(Object.assign(
      new Error(code === "authorization_denied" ? "Platform Loop definitions are read-only" : "Loop definition not found"),
      { code },
    ));
    const response = await DELETE(new Request("http://localhost/api/loops/loop_definition_1", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ commandId: `archive_${code}`, expectedRevision: 3, mode: "archive" }),
    }), context);

    expect(response.status).toBe(status);
  });

  it("maps reference conflicts to 409 and redacts internal failures", async () => {
    vi.mocked(deleteLoopDefinitionCommand).mockRejectedValueOnce(Object.assign(
      new Error("Loop definition has historical references and must be archived"),
      { code: "version_conflict" },
    ));
    const conflict = await DELETE(new Request("http://localhost/api/loops/loop_definition_1", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ commandId: "delete_1", expectedRevision: 3, mode: "delete" }),
    }), context);
    expect(conflict.status).toBe(409);

    vi.mocked(deleteLoopDefinitionCommand).mockRejectedValueOnce(new Error("database password leaked"));
    const failed = await DELETE(new Request("http://localhost/api/loops/loop_definition_1", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ commandId: "delete_2", expectedRevision: 3, mode: "delete" }),
    }), context);
    expect(failed.status).toBe(500);
    await expect(failed.json()).resolves.toEqual({ ok: false, code: "internal_error", error: "Loop request failed" });
  });
});

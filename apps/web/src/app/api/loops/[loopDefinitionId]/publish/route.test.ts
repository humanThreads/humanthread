import { beforeEach, describe, expect, it, vi } from "vitest";
import { publishLoopDefinitionCommand } from "@/lib/orchestration/loop-definition-commands";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { POST } from "./route";

vi.mock("@/lib/orchestration/loop-definition-commands", () => ({ publishLoopDefinitionCommand: vi.fn() }));
vi.mock("@/lib/workbench/workbench-api-session", () => ({ resolveWorkbenchApiActor: vi.fn() }));

const context = { params: Promise.resolve({ loopDefinitionId: "loop_definition_1" }) };

describe("POST /api/loops/:loopDefinitionId/publish", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveWorkbenchApiActor).mockResolvedValue({ userId: "user_session", authKind: "web_session", webSessionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
  });

  it("publishes the expected draft revision for the signed actor", async () => {
    vi.mocked(publishLoopDefinitionCommand).mockResolvedValue({
      loopDefinitionId: "loop_definition_1",
      versionId: "loop_version_2",
      versionNumber: 2,
      checksum: "checksum_2",
      maxTransitions: 4,
    });
    const response = await POST(new Request("http://localhost/api/loops/loop_definition_1/publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ commandId: "publish_1", expectedRevision: 3 }),
    }), context);

    expect(response.status).toBe(200);
    expect(publishLoopDefinitionCommand).toHaveBeenCalledWith({
      actorUserId: "user_session",
      loopDefinitionId: "loop_definition_1",
      commandId: "publish_1",
      expectedDraftRevision: 3,
    });
    await expect(response.json()).resolves.toMatchObject({ ok: true, result: { versionNumber: 2, maxTransitions: 4 } });
  });

  it("rejects caller-supplied graph and version numbers", async () => {
    const response = await POST(new Request("http://localhost/api/loops/loop_definition_1/publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        commandId: "publish_1",
        expectedRevision: 3,
        nextVersion: 99,
        graph: { forged: true },
      }),
    }), context);

    expect(response.status).toBe(400);
    expect(publishLoopDefinitionCommand).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

import { decideDesktopApproval } from "@/lib/desktop/desktop-agent-commands";
import { OPTIONS, POST } from "./route";

vi.mock("@/lib/desktop/desktop-agent-commands", () => ({ decideDesktopApproval: vi.fn() }));

const params = { params: Promise.resolve({ approvalId: "approval_1" }) };

describe("desktop Agent approval route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("validates command metadata and returns desktop CORS", async () => {
    vi.mocked(decideDesktopApproval).mockResolvedValue({
      resourceType: "approval", id: "approval_1", status: "approved",
    });
    const request = new Request("http://localhost/api/desktop/agents/approvals/approval_1?space=personal", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:1420" },
      body: JSON.stringify({ commandId: "desktop:agent:approval:1", decision: "approved", reason: "" }),
    });

    const response = await POST(request, params);

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:1420");
    expect(await response.json()).toEqual({
      ok: true,
      result: { resourceType: "approval", id: "approval_1", status: "approved" },
    });
    expect((await OPTIONS(request)).status).toBe(204);
  });

  it("rejects a missing command ID before calling the service", async () => {
    const response = await POST(new Request(
      "http://localhost/api/desktop/agents/approvals/approval_1?space=personal",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision: "approved", reason: "" }) },
    ), params);

    expect(response.status).toBe(400);
    expect(decideDesktopApproval).not.toHaveBeenCalled();
  });
});

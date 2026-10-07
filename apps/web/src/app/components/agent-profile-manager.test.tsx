// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentProfileManager } from "./agent-profile-manager";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const activeProfile = {
  id: "a".repeat(32),
  spaceId: "space_1",
  name: "Gelsang Codex",
  provider: "codex" as const,
  status: "active" as const,
  model: "gpt-5.6-terra",
};

describe("AgentProfileManager", () => {
  it("creates a Space Agent Profile and adds it to the list", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      result: { ...activeProfile, name: "New Codex" },
    }), { status: 201, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    render(<AgentProfileManager canManage initialProfiles={[]} spaceId="space_1" />);

    await user.click(screen.getByRole("button", { name: "新建 Profile" }));
    await user.type(screen.getByLabelText("Profile 名称"), "New Codex");
    await user.selectOptions(screen.getByLabelText("Provider"), "codex");
    await user.type(screen.getByLabelText("模型（可选）"), "gpt-5.6-terra");
    await user.click(screen.getByRole("button", { name: "创建 Profile" }));

    await waitFor(() => expect(screen.getByText("New Codex")).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith("/api/agent-profiles", expect.objectContaining({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: expect.any(String),
    }));
    const body = JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(body).toMatchObject({
      spaceId: "space_1",
      name: "New Codex",
      provider: "codex",
      model: "gpt-5.6-terra",
    });
    expect(body.commandId).toBeTruthy();
  });

  it("disables an existing profile through the API", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      result: { ...activeProfile, status: "disabled" },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    render(<AgentProfileManager canManage initialProfiles={[activeProfile]} spaceId="space_1" />);

    await user.click(screen.getByRole("button", { name: "停用 Gelsang Codex" }));

    await waitFor(() => expect(screen.getByText("disabled")).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith(`/api/agent-profiles/${activeProfile.id}`, expect.objectContaining({ method: "PATCH" }));
    const body = JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(body).toMatchObject({ status: "disabled" });
    expect(body.commandId).toBeTruthy();
  });

  it("hides management actions without Space ownership", () => {
    render(<AgentProfileManager canManage={false} initialProfiles={[activeProfile]} spaceId="space_1" />);

    expect(screen.getByText("Gelsang Codex")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "新建 Profile" })).toBeNull();
    expect(screen.queryByRole("button", { name: "停用 Gelsang Codex" })).toBeNull();
  });
});

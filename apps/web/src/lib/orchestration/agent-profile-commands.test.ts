import { describe, expect, it, vi } from "vitest";
import {
  createSpaceAgentProfile,
  setSpaceAgentProfileStatus,
  type AgentProfileCommandDependencies,
  type AgentProfileCommandRecord,
} from "./agent-profile-commands";

const profile: AgentProfileCommandRecord = {
  id: "a".repeat(32),
  spaceId: "space_1",
  name: "Gelsang Codex",
  provider: "codex",
  status: "active",
  model: "gpt-5.6-terra",
};

function dependencies(): AgentProfileCommandDependencies {
  return {
    assertCanWriteSpace: vi.fn().mockResolvedValue({ role: "owner" }),
    loadProfile: vi.fn().mockResolvedValue(null),
    createProfile: vi.fn().mockImplementation(async (input) => ({ ...profile, ...input })),
    updateProfileStatus: vi.fn().mockImplementation(async (input) => ({ ...profile, id: input.profileId, status: input.status })),
  };
}

describe("createSpaceAgentProfile", () => {
  it("creates an active profile with safe defaults and a fixed-width MD5 identifier", async () => {
    const deps = dependencies();

    const result = await createSpaceAgentProfile({
      actorUserId: "user_1",
      commandId: "create-profile-1",
      spaceId: "space_1",
      name: "  Gelsang Codex  ",
      provider: "codex",
      model: "  gpt-5.6-terra  ",
    }, deps);

    expect(deps.assertCanWriteSpace).toHaveBeenCalledWith({ userId: "user_1", spaceId: "space_1" });
    expect(deps.createProfile).toHaveBeenCalledWith({
      id: expect.stringMatching(/^[a-f0-9]{32}$/u),
      spaceId: "space_1",
      name: "Gelsang Codex",
      provider: "codex",
      status: "active",
      model: "gpt-5.6-terra",
      capabilities: ["structured_result"],
      defaultExecutionPolicy: {},
      providerConfig: {},
      createdById: "user_1",
    });
    expect(result).toMatchObject({ name: "Gelsang Codex", status: "active" });
  });

  it("returns the existing profile when the same create command is replayed", async () => {
    const deps = dependencies();
    const existing = { ...profile, id: "b".repeat(32) };
    vi.mocked(deps.loadProfile).mockResolvedValue(existing);

    await expect(createSpaceAgentProfile({
      actorUserId: "user_1",
      commandId: "create-profile-1",
      spaceId: "space_1",
      name: "Gelsang Codex",
      provider: "codex",
    }, deps)).resolves.toEqual(existing);

    expect(deps.createProfile).not.toHaveBeenCalled();
  });

  it("rejects regular members before creating a Space profile", async () => {
    const deps = dependencies();
    vi.mocked(deps.assertCanWriteSpace).mockResolvedValue({ role: "member" });

    await expect(createSpaceAgentProfile({
      actorUserId: "user_1",
      commandId: "create-profile-1",
      spaceId: "space_1",
      name: "Gelsang Codex",
      provider: "codex",
    }, deps)).rejects.toMatchObject({ code: "authorization_denied" });

    expect(deps.createProfile).not.toHaveBeenCalled();
  });
});

describe("setSpaceAgentProfileStatus", () => {
  it("checks ownership against the profile Space and disables the profile", async () => {
    const deps = dependencies();
    vi.mocked(deps.loadProfile).mockResolvedValue(profile);
    vi.mocked(deps.assertCanWriteSpace).mockResolvedValue({ role: "admin" });
    vi.mocked(deps.updateProfileStatus).mockResolvedValue({ ...profile, status: "disabled" });

    await expect(setSpaceAgentProfileStatus({
      actorUserId: "user_1",
      commandId: "disable-profile-1",
      agentProfileId: profile.id,
      status: "disabled",
    }, deps)).resolves.toMatchObject({ id: profile.id, status: "disabled" });

    expect(deps.assertCanWriteSpace).toHaveBeenCalledWith({ userId: "user_1", spaceId: "space_1" });
    expect(deps.updateProfileStatus).toHaveBeenCalledWith({ profileId: profile.id, status: "disabled" });
  });

  it("does not expose an Agent Profile from another Space", async () => {
    const deps = dependencies();
    vi.mocked(deps.loadProfile).mockResolvedValue(null);

    await expect(setSpaceAgentProfileStatus({
      actorUserId: "user_1",
      commandId: "disable-profile-1",
      agentProfileId: profile.id,
      status: "disabled",
    }, deps)).rejects.toMatchObject({ code: "not_found" });

    expect(deps.assertCanWriteSpace).not.toHaveBeenCalled();
  });
});

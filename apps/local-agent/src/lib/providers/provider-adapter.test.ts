import { describe, expect, it, vi } from "vitest";

import type { AgentProviderAdapter } from "./provider-adapter";
import { resolveProviderAdapter } from "./provider-adapter";

const adapter = {
  capabilities: () => ({ sessionResume: true, structuredResult: true, approvals: true }),
  start: vi.fn(),
  resume: vi.fn(),
  cancel: vi.fn(),
} as unknown as AgentProviderAdapter;

describe("Provider adapter registry", () => {
  it("returns the adapter registered for the configured local provider", () => {
    expect(resolveProviderAdapter({
      agentProfileId: "profile_codex",
      provider: "codex",
      runtimeProfileId: "runtime_1",
      configurationVersion: 2,
    }, {
      provider: "codex",
      command: "codex",
      environmentRefs: [],
      version: 1,
    }, { codex: adapter })).toBe(adapter);
  });

  it("uses the device's current local provider configuration when the assignment audit version is older", () => {
    expect(resolveProviderAdapter({
      agentProfileId: "profile_codex",
      provider: "codex",
      runtimeProfileId: "runtime_assignment",
      configurationVersion: 2,
    }, {
      provider: "codex",
      command: "codex",
      environmentRefs: [],
      version: 1,
    }, { codex: adapter })).toBe(adapter);
  });

  it("uses the configured provider when assignment audit fields are older", () => {
    expect(resolveProviderAdapter({
      agentProfileId: "profile_codex",
      provider: "codex",
      runtimeProfileId: "runtime_assignment",
      configurationVersion: 9,
    }, {
      runtimeProfileId: "runtime_current",
      provider: "codex",
      command: "codex",
      environmentRefs: [],
      version: 1,
    }, { codex: adapter })).toBe(adapter);
  });

  it("rejects an unregistered Claude adapter before execution", () => {
    expect(() => resolveProviderAdapter({
      agentProfileId: "profile_claude",
      provider: "claude",
      runtimeProfileId: "runtime_claude_1",
      configurationVersion: 1,
    }, {
      provider: "claude",
      command: "claude",
      environmentRefs: [],
      version: 1,
    }, { codex: adapter })).toThrow(expect.objectContaining({
      code: "runtime_configuration_stale",
    }));
  });
});

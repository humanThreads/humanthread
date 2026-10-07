import { describe, expect, it } from "vitest";

import { buildCodexDaemonProcessKey } from "./codex-app-server-binding";

describe("Codex daemon binding key", () => {
  it("keeps one stable key for the same binding and separates another credential", () => {
    const base = {
      deploymentOrigin: "http://localhost:3000",
      userId: "user_1",
      credentialRef: "credential_1",
      providerBaseUrl: "https://model.example/v1",
      executable: "codex",
      environmentRefs: ["HTTPS_PROXY", "NO_PROXY", "HTTPS_PROXY"],
    };

    expect(buildCodexDaemonProcessKey(base)).toBe(buildCodexDaemonProcessKey({ ...base }));
    expect(buildCodexDaemonProcessKey(base)).not.toBe(
      buildCodexDaemonProcessKey({ ...base, credentialRef: "credential_2" }),
    );
    expect(buildCodexDaemonProcessKey(base)).toMatch(/^codex-daemon:[a-f0-9]{64}$/u);
  });

  it("normalizes URL and environment reference ordering", () => {
    const base = {
      deploymentOrigin: "http://localhost:3000/",
      userId: "user_1",
      credentialRef: "credential_1",
      providerBaseUrl: "https://model.example/v1/",
      executable: "codex",
      environmentRefs: ["NO_PROXY", "HTTPS_PROXY"],
    };

    expect(buildCodexDaemonProcessKey(base)).toBe(buildCodexDaemonProcessKey({
      ...base,
      deploymentOrigin: "http://localhost:3000",
      providerBaseUrl: "https://model.example/v1",
      environmentRefs: ["HTTPS_PROXY", "NO_PROXY"],
    }));
  });
});

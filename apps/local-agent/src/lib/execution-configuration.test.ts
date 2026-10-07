import { describe, expect, it } from "vitest";

import {
  buildRuntimeProfileUpload,
  buildWorkspaceUpload,
  sanitizeRuntimeProbe,
} from "./execution-configuration";

describe("execution configuration upload boundary", () => {
  it("rejects a missing local workspace before building platform metadata", () => {
    expect(() => buildWorkspaceUpload(null)).toThrow("Workspace is not configured");
  });

  it("reports an unauthenticated Codex without returning command output", () => {
    const result = sanitizeRuntimeProbe({
      provider: "codex",
      exitCode: 1,
      stdout: "",
      stderr: "token=secret login required",
    });

    expect(result).toEqual({
      provider: "codex",
      status: "unauthenticated",
      semanticVersion: null,
      authentication: "unauthenticated",
      capabilities: [],
    });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("projects a ready runtime without its executable or environment references", () => {
    const upload = buildRuntimeProfileUpload({
      provider: "codex",
      command: "/Users/alice/.nvm/bin/codex",
      environmentRefs: ["CODEX_HOME"],
      version: 1,
    }, {
      provider: "codex",
      status: "ready",
      semanticVersion: "0.72.0",
      authentication: "authenticated",
      capabilities: ["structured_result", "session_resume"],
    });

    expect(upload).toEqual({
      provider: "codex",
      label: "Codex 0.72.0",
      status: "ready",
      capabilities: ["session_resume", "structured_result"],
      version: 1,
    });
    expect(JSON.stringify(upload)).not.toContain("/Users/alice");
    expect(JSON.stringify(upload)).not.toContain("CODEX_HOME");
  });
});

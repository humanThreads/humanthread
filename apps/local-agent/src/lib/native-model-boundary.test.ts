import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { createNativeLocalModelCommands } from "./native-local-model-commands";

async function read(relativePath: string): Promise<string> {
  return readFile(resolve(process.cwd(), relativePath), "utf8");
}

describe("native local model boundary", () => {
  it("registers only status-or-write credential commands and derives user paths in the main process", async () => {
    const source = await read("electron/lib/local-model.ts");
    const commands = await read("electron/commands.ts");

    expect(commands).toMatch(/get_agent_credential_status/u);
    expect(commands).toMatch(/set_agent_credential/u);
    expect(commands).toMatch(/delete_agent_credential/u);
    expect(source).toMatch(/\.humanthread/u);
    expect(source).toMatch(/"accounts"/u);
    expect(source).toMatch(/createHash\("sha256"\)/u);
    expect(source).toMatch(/openSync\(temporary, "wx"\)/u);
    expect(source).toMatch(/renameSync\(temporary, path\)/u);
    expect(source).not.toMatch(/export function getAgentCredential\s*\(/u);
    expect(source).not.toMatch(/console\.(log|error)\(.*apiKey/iu);
  });

  it("passes account context only to local native commands and validates responses", async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === "get_agent_credential_status") {
        return { credentialRef: "0123456789abcdef0123456789abcdef", kind: "openai_api_key", configured: false, updatedAt: null };
      }
      return { schemaVersion: 1, sites: [], accountDefault: null };
    });
    const commands = createNativeLocalModelCommands({ deploymentOrigin: "http://localhost:3000", userId: "user-1" }, invoke);

    await commands.getCredentialStatus("0123456789abcdef0123456789abcdef");
    expect(invoke).toHaveBeenCalledWith("get_agent_credential_status", {
      deploymentOrigin: "http://localhost:3000",
      userId: "user-1",
      credentialRef: "0123456789abcdef0123456789abcdef",
    });
    expect(JSON.stringify(invoke.mock.calls)).not.toContain("apiKey");
  });

  it("passes a one-time site credential only through the native discovery command", async () => {
    const siteId = "0123456789abcdef0123456789abcdef";
    const invoke = vi.fn(async (command: string) => {
      if (command === "test_and_refresh_model_site") {
        return {
          refreshedAt: "2026-08-15T08:00:00.000Z",
          models: [],
        };
      }
      return { schemaVersion: 1, sites: [], accountDefault: null };
    });
    const commands = createNativeLocalModelCommands({ deploymentOrigin: "http://localhost:3000", userId: "user-1" }, invoke);

    await commands.testAndRefreshSite({
      siteId,
      name: "Company models",
      adapter: "openai_compatible",
      baseUrl: "https://models.example.com/v1",
      credentialSource: "independent",
      credentialRef: "fedcba9876543210fedcba9876543210",
      status: "untested",
      lastValidatedAt: null,
    }, undefined, "one-time-key");

    expect(invoke).toHaveBeenCalledWith("test_and_refresh_model_site", {
      deploymentOrigin: "http://localhost:3000",
      userId: "user-1",
      site: expect.objectContaining({ siteId }),
      catalog: null,
      credential: "one-time-key",
    });
  });
});
